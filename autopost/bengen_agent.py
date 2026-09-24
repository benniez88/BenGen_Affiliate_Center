#!/usr/bin/env python3
"""
BenGen AutoPost Agent
=====================
โปรแกรมที่รันค้างไว้บนคอม (เปิดอัตโนมัติด้วย Task Scheduler ตอน logon) ทำ 3 อย่าง:

  1. ตรวจความพร้อมของเครื่อง (มือถือต่ออยู่ไหม / จอล็อกไหม / แบต / เวอร์ชัน Shopee)
     แล้วรายงานลงชีต AutoPostStatus ทุก heartbeat_seconds — เว็บแอปแท็บ AutoPost อ่านไปแสดง
  2. ตอบคำขอ "ตรวจตอนนี้" จากเว็บแอป (เว็บเขียน checkRequestedAt → Agent ตรวจแล้วตอบกลับ)
  3. โพสต์คลิปที่ถึงเวลา (เฟส 2 — ปิดไว้ด้วย posting_enabled: false จนกว่าจะเสร็จ)

ชีต AutoPostStatus (สร้างเองครั้งเดียว):
  แถว 1 (หัวคอลัมน์): id | status | checkRequestedAt | updatedAt
  แถว 2:              host

  status = JSON ก้อนเดียว (Worker เขียนได้ครั้งละ 1 ช่อง — รวมไว้ช่องเดียวจะได้ยิง request เดียว)

รัน:  python bengen_agent.py            (รันค้าง)
      python bengen_agent.py --once     (ตรวจ + รายงาน 1 รอบแล้วจบ — ไว้ทดสอบ)
"""

import argparse
import json
import logging
import logging.handlers
import os
import random
import socket
import sys
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

import bengen_auto_post as bap

AGENT_VERSION = "1.0.0"
STATUS_SHEET = "AutoPostStatus"
STATUS_ROW_ID = "host"
SINGLE_INSTANCE_PORT = 47831  # กันเปิด Agent ซ้อน 2 ตัว (bind พอร์ตนี้ไว้ ปิดโปรแกรมแล้วปล่อยเอง)
TH_TZ = timezone(timedelta(hours=7))
CONTENT_COLUMNS_NEEDED = ("postMode", "scheduledAt", "postError", "postAttempts", "postStartedAt")

log = logging.getLogger("agent")


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


# ═══════════════════════════════════════════════════════════════
# Worker (Sheet) — ทุกคำสั่งมี timeout และไม่ทำให้ Agent ตาย
# ═══════════════════════════════════════════════════════════════

class Sheet:
    def __init__(self, url):
        self.url = url
        self.http = requests.Session()

    def read(self, sheet):
        res = self.http.get(self.url, params={"action": "read", "sheet": sheet, "_": int(time.time())}, timeout=30)
        res.raise_for_status()
        data = res.json()
        if data.get("error"):
            raise RuntimeError(data["error"])
        return data.get("rows", [])

    def set_field(self, sheet, row_id, field, value):
        res = self.http.post(
            self.url,
            json={"action": "updateStatus", "sheet": sheet, "id": row_id, "field": field, "value": value},
            timeout=30,
        )
        res.raise_for_status()
        data = res.json()
        if data.get("error") or data.get("ok") is False:
            raise RuntimeError(data.get("error") or f"เขียน {sheet}.{field} ไม่สำเร็จ")
        return data


# ═══════════════════════════════════════════════════════════════
# ตรวจความพร้อมของเครื่อง — อ่านอย่างเดียว ไม่ปลุกจอ ไม่กดอะไร
# ═══════════════════════════════════════════════════════════════

class DeviceProbe:
    def __init__(self, cfg):
        self.cfg = cfg
        self.serial = cfg.get("device_serial") or None
        self._d = None

    def _connect(self, serial):
        if self._d is not None:
            try:
                self._d.info  # ยังคุยกันได้อยู่ไหม
                return self._d
            except Exception:
                self._d = None
        d = bap.u2.connect(serial)
        d.info
        self._d = d
        return d

    def device(self):
        """คืน uiautomator2 device ที่ต่ออยู่ (ใช้ตอนโพสต์)"""
        return self._connect(self.serial)

    def check(self):
        """คืน (phone dict, problems list) — problem = {level: error|wait|warn, code, msg}"""
        cfg = self.cfg
        problems = []
        phone = {"connected": False}

        try:
            import adbutils
            infos = adbutils.adb.list()
        except Exception as e:
            problems.append({"level": "error", "code": "adb", "msg": f"เรียก ADB ไม่ได้: {e}"})
            return phone, problems

        if self.serial:
            infos = [i for i in infos if i.serial == self.serial]
        ready_devs = [i for i in infos if i.state == "device"]
        if not ready_devs:
            if any(i.state == "unauthorized" for i in infos):
                problems.append({"level": "error", "code": "unauthorized",
                                 "msg": "มือถือยังไม่อนุญาต USB debugging — กด Allow บนจอมือถือ"})
            else:
                problems.append({"level": "error", "code": "no_device",
                                 "msg": "ไม่พบมือถือ — เสียบสาย USB และเปิด USB debugging"})
            self._d = None
            return phone, problems

        serial = ready_devs[0].serial
        phone.update(connected=True, serial=serial)
        try:
            d = self._connect(serial)
            info = d.info
            phone["model"] = info.get("productName")
            phone["screenOn"] = bool(info.get("screenOn"))
        except Exception as e:
            self._d = None
            problems.append({"level": "error", "code": "u2",
                             "msg": f"ต่อ uiautomator2 ไม่ได้ ลองถอด-เสียบสายใหม่ ({type(e).__name__})"})
            return phone, problems

        def sh(cmd):
            return d.shell(cmd).output

        # จอล็อก — ตอนล็อกโพสต์ไม่ได้ แต่ไม่นับเป็นความผิดพลาด (รอจนปลดล็อก)
        phone["locked"] = "isKeyguardShowing=true" in sh("dumpsys window | grep isKeyguardShowing")
        if phone["locked"]:
            problems.append({"level": "wait", "code": "locked", "msg": "จอมือถือล็อกอยู่ — ปลดล็อกจอค้างไว้"})

        phone["stayAwake"] = sh("settings get global stay_on_while_plugged_in").strip() not in ("", "0")
        if not phone["stayAwake"]:
            problems.append({"level": "warn", "code": "stay_awake",
                             "msg": "ยังไม่เปิด Stay awake — จออาจดับแล้วล็อกก่อนถึงเวลาโพสต์"})

        battery = {}
        for line in sh("dumpsys battery").splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                battery[k.strip()] = v.strip()
        try:
            phone["battery"] = int(battery.get("level", -1))
        except ValueError:
            phone["battery"] = -1
        # status 2 = กำลังชาร์จ, 5 = เต็ม
        phone["charging"] = battery.get("status") in ("2", "5")
        low = cfg.get("battery_warn_percent", 20)
        if 0 <= phone["battery"] < low:
            level = "warn" if phone["charging"] else "error"
            problems.append({"level": level, "code": "battery",
                             "msg": f"แบตเหลือ {phone['battery']}%" + (" (กำลังชาร์จ)" if phone["charging"] else " และไม่ได้ชาร์จ")})

        version = ""
        for line in sh(f"dumpsys package {bap.SHOPEE_PACKAGE} | grep versionName").splitlines():
            if "versionName=" in line:
                version = line.split("versionName=", 1)[1].strip()
                break
        phone["shopeeVersion"] = version
        calibrated = str(cfg.get("calibrated_shopee_version") or "")
        if not version:
            problems.append({"level": "error", "code": "shopee_missing", "msg": "ไม่พบแอป Shopee ในมือถือ"})
        elif calibrated and version != calibrated:
            problems.append({"level": "error", "code": "shopee_version",
                             "msg": f"Shopee อัปเดตเป็น {version} (คาลิเบรตไว้กับ {calibrated}) — ต้องคาลิเบรตใหม่ก่อนโพสต์"})
        return phone, problems


# ═══════════════════════════════════════════════════════════════
# Agent
# ═══════════════════════════════════════════════════════════════

class Agent:
    def __init__(self, cfg):
        self.cfg = cfg
        self.sheet = Sheet(cfg["apps_url"])
        self.probe = DeviceProbe(cfg)
        self.lock = threading.Lock()   # กัน status thread กับงานโพสต์แย่งกันใช้มือถือ
        self.state = "starting"
        self.current_content_id = ""
        self.last_error = ""
        self.last_health = {"phone": {"connected": False}, "problems": []}
        self.last_health_at = None
        self.queue = {}                # ข้อมูลคิวจาก Content ล่าสุด (postedToday, dueCount ...)
        self.answered_request = None
        # สวิตช์ "หยุดโพสต์อัตโนมัติ" จากเว็บ (AutoPostStatus.postingPaused)
        # เริ่มที่ True ไว้ก่อน (ปลอดภัย) — ยังไม่โพสต์จนกว่าจะอ่านค่าจริงจากชีตได้ครั้งแรก
        self.paused_by_user = True
        self.last_fail_at = {}         # content id → เวลาที่พังล่าสุด (ไว้เว้นช่วงก่อนลองใหม่)
        self.next_post_after = None    # เว้นช่วงแบบสุ่มระหว่างคลิป
        self.started_at = utc_now_iso()
        self.stop = threading.Event()

    # ── ตรวจเครื่อง ──
    def run_health(self):
        if not self.lock.acquire(blocking=False):
            return False  # กำลังโพสต์อยู่ ใช้ผลตรวจล่าสุดแทน
        try:
            phone, problems = self.probe.check()
        except Exception as e:
            phone, problems = {"connected": False}, [{"level": "error", "code": "probe", "msg": f"ตรวจเครื่องไม่สำเร็จ: {e}"}]
        finally:
            self.lock.release()
        before = {p["code"] for p in self.last_health["problems"]}
        after = {p["code"] for p in problems}
        if before != after:  # บันทึกเฉพาะตอนสถานะเปลี่ยน ไว้ย้อนดูว่าเครื่องหลุด/กลับมาตอนไหน
            msgs = "; ".join(p["msg"] for p in problems) or "พร้อมโพสต์"
            log.info("สถานะเครื่องเปลี่ยน: %s", msgs)
        self.last_health = {"phone": phone, "problems": problems}
        self.last_health_at = utc_now_iso()
        return True

    def ready(self):
        return not any(p["level"] in ("error", "wait") for p in self.last_health["problems"])

    def build_status(self, answered=None):
        problems = list(self.last_health["problems"])
        if self.queue.get("missingColumns"):
            problems.append({"level": "warn", "code": "columns",
                             "msg": "ชีต Content ยังไม่มีคอลัมน์: " + ", ".join(self.queue["missingColumns"])})
        state = self.state
        # posting = กำลังโพสต์ / stopped = หยุดโพสต์ (สวิตช์เว็บหรือ config) / waiting = เครื่องไม่พร้อม / idle = พร้อม
        if state not in ("posting", "starting"):
            if self.paused_by_user or not self.cfg.get("posting_enabled", False):
                state = "stopped"
            else:
                state = "idle" if self.ready() else "waiting"
        return {
            "agentVersion": AGENT_VERSION,
            "host": socket.gethostname(),
            "startedAt": self.started_at,
            "lastSeen": utc_now_iso(),
            "lastCheckAt": self.last_health_at,
            "state": state,
            "ready": self.ready(),
            "postingEnabled": bool(self.cfg.get("posting_enabled", False)),   # สวิตช์หลักบนคอม (config.yaml)
            "postingPaused": self.paused_by_user,                             # สวิตช์จากเว็บ
            "phone": self.last_health["phone"],
            "calibratedVersion": str(self.cfg.get("calibrated_shopee_version") or ""),
            "problems": problems,
            "currentContentId": self.current_content_id,
            "lastError": self.last_error,
            "queue": {k: v for k, v in self.queue.items() if k != "missingColumns"},
            "limits": {
                "dailyLimit": self.cfg.get("daily_limit", 70),
                "overdueMaxMinutes": self.cfg.get("overdue_max_minutes", 120),
                "retryMax": self.cfg.get("retry_max", 2),
                "retryDelayMinutes": self.cfg.get("retry_delay_minutes", 10),
                "heartbeatSeconds": self.cfg.get("heartbeat_seconds", 30),
            },
            "checkAnsweredFor": answered if answered is not None else self.answered_request,
        }

    def publish_status(self, answered=None):
        status = self.build_status(answered)
        self.sheet.set_field(STATUS_SHEET, STATUS_ROW_ID, "status", json.dumps(status, ensure_ascii=False))
        return status

    # ── status thread: heartbeat + ตอบคำขอตรวจ ──
    def status_loop(self):
        heartbeat = self.cfg.get("heartbeat_seconds", 30)
        poll = self.cfg.get("poll_seconds", 15)
        last_beat = 0.0
        while not self.stop.is_set():
            try:
                request = None
                try:
                    rows = self.sheet.read(STATUS_SHEET)
                    row = next((r for r in rows if str(r.get("id")) == STATUS_ROW_ID), None)
                    if row is None:
                        log.error("ชีต %s ไม่มีแถว id=%s", STATUS_SHEET, STATUS_ROW_ID)
                    else:
                        request = str(row.get("checkRequestedAt") or "") or None
                        paused = str(row.get("postingPaused") or "").strip().lower() in ("true", "1", "yes")
                        if paused != self.paused_by_user:
                            log.info("สวิตช์จากเว็บ: %s", "หยุดโพสต์อัตโนมัติ" if paused else "เปิดโพสต์อัตโนมัติ")
                            self.paused_by_user = paused
                            last_beat = 0.0  # รายงานสถานะใหม่ทันที
                except Exception as e:
                    log.warning("อ่าน %s ไม่ได้: %s", STATUS_SHEET, e)

                if request and request != self.answered_request:
                    log.info("ได้รับคำขอตรวจจากเว็บ: %s", request)
                    self.run_health()
                    self.publish_status(answered=request)
                    self.answered_request = request
                    last_beat = time.time()
                elif time.time() - last_beat >= heartbeat:
                    self.run_health()
                    self.publish_status()
                    last_beat = time.time()
            except Exception as e:
                log.warning("status loop: %s", e)
            self.stop.wait(poll)

    # ── อ่านคิวจาก Content ──
    def classify(self, r, now):
        """สถานะของคลิปที่ตั้งเวลาไว้ (None = ไม่เกี่ยวกับคิว)"""
        if r.get("postedAt"):
            return "posted"
        when = parse_iso(r.get("scheduledAt"))
        if r.get("postMode") != "scheduled" or not when:
            return None
        if r.get("postStartedAt"):
            return "needs_check"   # จองไว้แล้วแต่ไม่มี postedAt = Agent ตาย/พังกลางทาง — ห้ามโพสต์ซ้ำเอง
        attempts = int(r.get("postAttempts") or 0)
        if attempts > self.cfg.get("retry_max", 2):
            return "failed"
        if when > now:
            return "scheduled"
        if now - when > timedelta(minutes=self.cfg.get("overdue_max_minutes", 120)):
            return "overdue"
        last_fail = self.last_fail_at.get(str(r.get("id")))
        if attempts and last_fail and now - last_fail < timedelta(minutes=self.cfg.get("retry_delay_minutes", 10)):
            return "retry_wait"
        return "due"

    def refresh_queue(self):
        rows = self.sheet.read("Content")
        cols = set(rows[0].keys()) if rows else set()
        today_th = datetime.now(TH_TZ).date()
        now = datetime.now(timezone.utc)
        counts = {k: 0 for k in ("scheduled", "due", "retry_wait", "overdue", "needs_check", "failed")}
        posted_today = 0
        due_rows = []
        for r in rows:
            group = self.classify(r, now)
            if group == "posted":
                posted = parse_iso(r.get("postedAt"))
                if posted and posted.astimezone(TH_TZ).date() == today_th:
                    posted_today += 1
            elif group:
                counts[group] += 1
                if group == "due":
                    due_rows.append(r)
        due_rows.sort(key=lambda r: parse_iso(r.get("scheduledAt")))
        self.queue = {
            "postedToday": posted_today,
            **counts,
            "missingColumns": [c for c in CONTENT_COLUMNS_NEEDED if c not in cols],
            "nextPostAfter": self.next_post_after.isoformat(timespec="seconds").replace("+00:00", "Z")
                             if self.next_post_after else None,
            "checkedAt": utc_now_iso(),
        }
        return rows, due_rows

    # ── โพสต์ 1 คลิป ──
    def write(self, content_id, field, value):
        """เขียน Content ลอง 3 ครั้ง — ข้อมูลสถานะคลิปห้ามหาย"""
        for i in range(3):
            try:
                return self.sheet.set_field("Content", content_id, field, value)
            except Exception as e:
                if i == 2:
                    raise
                log.warning("เขียน %s.%s ไม่สำเร็จ (%s) — ลองใหม่", content_id, field, e)
                time.sleep(5)

    def post_item(self, row):
        """คืน True ถ้าโพสต์สำเร็จ / False ถ้าไม่ได้โพสต์ (เครื่องไม่พร้อม หรือพังแบบปลอดภัย)"""
        cfg = self.cfg
        cid = str(row["id"])
        caption = row.get("caption") or row.get("hook") or ""
        with self.lock:
            # 1) เช็คเครื่องก่อน — ไม่พร้อม = ยังไม่เริ่ม ไม่นับเป็นความผิดพลาด
            phone, problems = self.probe.check()
            self.last_health = {"phone": phone, "problems": problems}
            self.last_health_at = utc_now_iso()
            if not self.ready():
                log.info("ยังไม่โพสต์ %s — เครื่องไม่พร้อม: %s", cid, "; ".join(p["msg"] for p in problems))
                return False

            # 2) อ่านแถวล่าสุดอีกรอบ กันเว็บยกเลิก/อีกเครื่องจองไปแล้วระหว่างรอ
            fresh = next((r for r in self.sheet.read("Content") if str(r.get("id")) == cid), None)
            if not fresh or self.classify(fresh, datetime.now(timezone.utc)) != "due":
                log.info("ข้าม %s — สถานะเปลี่ยนไปแล้ว", cid)
                return False

            # 3) จองคลิป — ตั้งแต่นี้ถ้า Agent ตาย คลิปจะไปอยู่กลุ่ม "ต้องตรวจสอบ" ไม่โพสต์ซ้ำเอง
            self.state, self.current_content_id = "posting", cid
            self.write(cid, "postStartedAt", utc_now_iso())
            log.info("▶ เริ่มโพสต์ %s (%s)", cid, (row.get("productName") or "")[:40])

            local_path = os.path.join(cfg["temp_dir"], f"{cid}.mp4")
            remote_path = None
            d = None
            submitted = False
            try:
                os.makedirs(cfg["temp_dir"], exist_ok=True)
                bap.download_file(row["mp4DriveUrl"], local_path)
                d = self.probe.device()
                d.implicitly_wait(10)
                remote_path = bap.push_video_to_gallery(d, local_path)
                bap.open_shopee_video_composer(d)
                bap.select_video_from_gallery(d, os.path.basename(remote_path))
                bap.fill_caption(d, caption)
                product = bap.fetch_product_row(cfg["apps_url"], row.get("productId"))
                if not product:
                    raise RuntimeError(f"ไม่พบสินค้า productId={row.get('productId')} ในชีต Products")
                bap.attach_product(d, product)
                if cfg.get("ai_label", True):
                    bap.enable_ai_label(d)

                # 4) กดโพสต์ — จุดที่ย้อนกลับไม่ได้
                submitted = True
                bap.finalize_post(d)
                bap.wait_upload_done(d)
                log.info("อัปโหลดเสร็จ %s", cid)
                if cfg.get("capture_after_post"):
                    self.capture_after_post(d, cid)
            except Exception as e:
                msg = f"{type(e).__name__}: {e}"[:300]
                self.last_error = f"{cid}: {msg}"
                if submitted:
                    # หลังกดโพสต์ไม่รู้ว่าขึ้นไปแล้วหรือยัง — ทิ้ง postStartedAt ไว้ = กลุ่ม "ต้องตรวจสอบ"
                    log.error("✖ %s พังหลังกดโพสต์ — ต้องตรวจสอบในแอป: %s", cid, msg)
                    self.write(cid, "postError", "พังหลังกดโพสต์ ต้องเช็คในแอปว่าคลิปขึ้นแล้วหรือยัง: " + msg)
                else:
                    attempts = int(fresh.get("postAttempts") or 0) + 1
                    log.error("✖ %s พังก่อนกดโพสต์ (ครั้งที่ %d): %s", cid, attempts, msg)
                    try:
                        if d is not None:
                            bap.recover_app(d)
                    except Exception as re_err:
                        log.warning("กู้แอปไม่สำเร็จ: %s", re_err)
                    self.write(cid, "postAttempts", str(attempts))
                    self.write(cid, "postError", msg)
                    self.write(cid, "postStartedAt", "")  # ปลดจอง — ปลอดภัยเพราะยังไม่ได้กดโพสต์
                    self.last_fail_at[cid] = datetime.now(timezone.utc)
                return False
            finally:
                self.state, self.current_content_id = "idle", ""
                if remote_path and d is not None and not submitted:
                    try:
                        bap.remove_video_from_phone(d, remote_path)
                    except Exception:
                        pass

            # 5) สำเร็จ — บันทึก postedAt (ถ้าบันทึกไม่ได้ postStartedAt ยังอยู่ = ต้องตรวจสอบ ไม่โพสต์ซ้ำ)
            try:
                for i in range(3):
                    try:
                        bap.mark_posted(cfg["apps_url"], cid)
                        break
                    except Exception:
                        if i == 2:
                            raise
                        time.sleep(5)
                self.write(cid, "postError", "")
            except Exception as e:
                log.error("✖ %s โพสต์แล้วแต่บันทึก postedAt ไม่สำเร็จ: %s", cid, e)
                self.last_error = f"{cid}: บันทึก postedAt ไม่สำเร็จ"
                try:
                    self.write(cid, "postError", "โพสต์ขึ้นแล้ว แต่บันทึกสถานะไม่สำเร็จ — กด 'โพสต์แล้ว' ในเว็บ")
                except Exception:
                    pass
                return True
            log.info("✔ โพสต์สำเร็จ %s", cid)
            self.last_error = ""
            time.sleep(15)  # เผื่อเวลาอัปโหลดก่อนลบคลิปต้นฉบับในมือถือ
            for cleanup in (lambda: bap.remove_video_from_phone(d, remote_path), lambda: os.remove(local_path)):
                try:
                    cleanup()
                except Exception:
                    pass
            return True

    # ── main loop ──
    def run(self):
        t = threading.Thread(target=self.status_loop, name="status", daemon=True)
        t.start()
        queue_every = self.cfg.get("queue_seconds", 60)
        while not self.stop.is_set():
            wait = queue_every
            try:
                _, due_rows = self.refresh_queue()
                if self.state == "starting":
                    self.state = "idle"
                if self.queue.get("missingColumns"):
                    log.warning("Content ยังไม่มีคอลัมน์: %s — ยังไม่โพสต์", self.queue["missingColumns"])
                elif self.cfg.get("posting_enabled", False) and not self.paused_by_user and due_rows:
                    if self.maybe_post(due_rows[0]):
                        wait = 5  # เพิ่งโพสต์ — กลับมาดูคิวเร็วๆ (เว้นช่วงคุมด้วย next_post_after)
            except Exception as e:
                log.warning("รอบคิวผิดพลาด: %s", e)
            self.stop.wait(wait)

    def capture_after_post(self, d, cid):
        """เก็บภาพหน้าจอ + UI hierarchy หลังกดโพสต์ ไว้คาลิเบรตขั้น "รอให้อัปโหลดเสร็จ" (อ่านอย่างเดียว)"""
        out = os.path.join("logs", "after_post", cid)
        os.makedirs(out, exist_ok=True)
        t0 = time.time()
        for sec in (1, 3, 6, 10, 15, 25, 40, 60):
            time.sleep(max(0, t0 + sec - time.time()))
            try:
                d.screenshot(os.path.join(out, f"{sec:02d}s.png"))
                with open(os.path.join(out, f"{sec:02d}s.xml"), "w", encoding="utf-8") as f:
                    f.write(d.dump_hierarchy())
            except Exception as e:
                log.warning("เก็บภาพหลังโพสต์ไม่สำเร็จ (%ss): %s", sec, e)
        log.info("เก็บภาพหลังกดโพสต์ไว้ที่ %s", out)

    def maybe_post(self, row):
        now = datetime.now(timezone.utc)
        if self.queue.get("postedToday", 0) >= self.cfg.get("daily_limit", 70):
            return False
        if self.next_post_after and now < self.next_post_after:
            return False
        posted = self.post_item(row)
        if posted:
            gap = random.randint(self.cfg.get("min_gap_seconds", 120), self.cfg.get("max_gap_seconds", 300))
            self.next_post_after = datetime.now(timezone.utc) + timedelta(seconds=gap)
            log.info("เว้นช่วง %d วิ ก่อนคลิปถัดไป", gap)
        return posted


# ═══════════════════════════════════════════════════════════════
# setup
# ═══════════════════════════════════════════════════════════════

def setup_logging(base_dir):
    os.makedirs(os.path.join(base_dir, "logs"), exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(threadName)s] %(message)s")
    fh = logging.handlers.RotatingFileHandler(
        os.path.join(base_dir, "logs", "agent.log"), maxBytes=1_000_000, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(fh)
    if sys.stdout is not None:  # รันผ่าน pythonw (Task Scheduler) ไม่มีคอนโซล — เขียนลงไฟล์อย่างเดียว
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        root.addHandler(sh)
    # uiautomator2/adbutils พ่น debug เยอะมาก
    for noisy in ("uiautomator2", "adbutils", "urllib3", "PIL"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def single_instance():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", SINGLE_INSTANCE_PORT))
    except OSError:
        return None
    return s  # ต้องเก็บ reference ไว้ตลอดอายุโปรแกรม


def main():
    parser = argparse.ArgumentParser(description="BenGen AutoPost Agent")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--once", action="store_true", help="ตรวจ + รายงาน 1 รอบแล้วจบ")
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)
    if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    setup_logging(base_dir)
    cfg = bap.load_config(args.config)

    adb_dir = cfg.get("adb_dir")
    if adb_dir and os.path.isdir(adb_dir):
        os.environ["PATH"] = adb_dir + os.pathsep + os.environ.get("PATH", "")

    agent = Agent(cfg)
    if args.once:
        agent.refresh_queue()
        agent.state = "idle"
        agent.run_health()
        status = agent.publish_status()
        print(json.dumps(status, ensure_ascii=False, indent=1))
        return

    guard = single_instance()
    if guard is None:
        log.error("มี Agent อีกตัวรันอยู่แล้ว — ปิดตัวนี้")
        sys.exit(1)
    log.info("Agent %s เริ่มทำงาน (posting_enabled=%s)", AGENT_VERSION, cfg.get("posting_enabled", False))
    try:
        agent.run()
    except KeyboardInterrupt:
        log.info("หยุดโดยผู้ใช้")
    finally:
        agent.stop.set()


if __name__ == "__main__":
    main()
