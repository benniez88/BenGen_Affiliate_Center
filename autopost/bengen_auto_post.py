#!/usr/bin/env python3
"""
BenGen Auto Post SP
====================
โพสต์วิดีโอสินค้า (ที่เตรียมไว้ใน Google Sheets/Drive จากระบบ BenGen Affiliate)
ขึ้น Shopee Video อัตโนมัติ ผ่านการควบคุมแอป Shopee บนโทรศัพท์ Android จริง
ด้วย ADB + uiautomator2 (ไม่ต้อง root เครื่อง)

รองรับ 2 โหมดหลัก (+ --draft เป็น flag เสริมใช้ร่วมกับโหมดไหนก็ได้):
  - manual     : เลือกโพสต์ทีละรายการเอง (ระบุ --content-id)
  - scheduled  : เช็ค Sheet หารายการที่ตั้งเวลาไว้และถึงเวลาแล้ว โพสต์ให้อัตโนมัติ
                 (รันซ้ำๆ ผ่าน Task Scheduler/cron ของเครื่อง host เช่น ทุก 15 นาที)
  - --draft    : ทำทุกอย่างเหมือนโพสต์จริง แต่กด "บันทึกร่าง" แทน "โพสต์"

⚠️ สำคัญมาก — อ่านก่อนใช้งานจริง (ดูรายละเอียดเต็มใน README.md):
  1. สคริปต์นี้ควบคุมแอป Shopee ผ่าน UI (กดปุ่ม/พิมพ์ข้อความจริงบนหน้าจอ)
     ไม่ใช่ API ทางการของ Shopee — Shopee ไม่มี API แบบนี้ให้ใช้งานสาธารณะ
  2. ทุกฟังก์ชันในโซน "ควบคุมโทรศัพท์" ด้านล่างมี selector เป็น PLACEHOLDER เท่านั้น
     ต้อง "คาลิเบรต" ให้ตรงกับแอป Shopee เวอร์ชันที่ติดตั้งจริงบนเครื่องคุณก่อนใช้งานจริง
     (ไม่งั้นจะกดผิดตำแหน่ง/หา element ไม่เจอ) — วิธีคาลิเบรตอยู่ใน README.md
  3. ควรเว้นระยะเวลาระหว่างการโพสต์แต่ละครั้ง (ตั้งค่าใน config.yaml) อย่าให้โพสต์
     ถี่/ตรงเวลาเป๊ะทุกครั้งเหมือนบอท เพราะเป็นการโพสต์เข้าบัญชีจริงของคุณ
  4. ขั้นตอน "แนบสินค้า" (attach_product) เป็นส่วนที่เสี่ยงพังง่ายที่สุดเพราะ UI ของ
     Shopee เปลี่ยนบ่อย — ถ้าพังกลางทาง สคริปต์จะไม่ mark ว่าโพสต์สำเร็จ ให้เข้าไป
     เช็ค/โพสต์ต่อเองในแอปได้เลย ข้อมูลใน Sheet จะไม่เพี้ยน
"""

import argparse
import contextlib
import os
import random
import sys
import time
from datetime import datetime, timezone

import requests
import yaml

try:
    import uiautomator2 as u2
except ImportError:
    u2 = None


# ═══════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════

def load_config(path="config.yaml"):
    if not os.path.exists(path):
        sys.exit(
            f"❌ ไม่พบไฟล์ config: {path}\n"
            f"   คัดลอก config.example.yaml เป็น config.yaml แล้วกรอกค่าให้ครบก่อนครับ"
        )
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# ═══════════════════════════════════════════════════════════════
# SHEETS / DRIVE — เรียกผ่าน Cloudflare Worker ตัวเดิมที่เว็บแอป/Extension ใช้อยู่
# (action=read, markPosted, updateStatus คือ action เดิมที่ Code.gs รองรับอยู่แล้ว)
# ═══════════════════════════════════════════════════════════════

def fetch_content_rows(apps_url):
    """ดึงข้อมูลทุกแถวจาก Sheet 'Content' ผ่าน Worker (action=read) — เหมือนที่เว็บแอปใช้"""
    res = requests.get(apps_url, params={"action": "read", "sheet": "Content"}, timeout=30)
    res.raise_for_status()
    data = res.json()
    if data.get("error"):
        raise RuntimeError(data["error"])
    return data.get("rows", [])


def fetch_product_row(apps_url, product_id):
    """ดึงข้อมูลสินค้า 1 ชิ้นจาก Sheet 'Products' (เอาไว้ใช้ตอนแนบสินค้า/ลิงก์เข้าวิดีโอ)"""
    if not product_id:
        return None
    res = requests.get(apps_url, params={"action": "read", "sheet": "Products"}, timeout=30)
    res.raise_for_status()
    rows = res.json().get("rows", [])
    # Sheet ส่ง id สินค้ามาเป็นตัวเลข ส่วน productId ใน Content อาจเป็นข้อความ — เทียบเป็น str ทั้งคู่
    return next((r for r in rows if str(r.get("id")) == str(product_id)), None)


def mark_posted(apps_url, content_id):
    res = requests.post(apps_url, json={"action": "markPosted", "id": content_id}, timeout=30)
    res.raise_for_status()
    return res.json()


def update_status(apps_url, content_id, field, value, sheet="Content"):
    res = requests.post(
        apps_url,
        json={"action": "updateStatus", "sheet": sheet, "id": content_id, "field": field, "value": value},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()


def download_file(url, dest_path):
    """โหลดลงไฟล์ .part ก่อนแล้วค่อยเปลี่ยนชื่อ — ไฟล์ปลายทางมีอยู่ = โหลดครบแล้วแน่นอน (ใช้กับ prefetch)"""
    res = requests.get(url, timeout=120, stream=True)
    res.raise_for_status()
    part = dest_path + ".part"
    with open(part, "wb") as f:
        for chunk in res.iter_content(chunk_size=1 << 16):
            f.write(chunk)
    os.replace(part, dest_path)
    return dest_path


# ═══════════════════════════════════════════════════════════════
# เลือกรายการที่จะโพสต์
# ═══════════════════════════════════════════════════════════════

def pick_manual_item(rows, content_id):
    row = next((r for r in rows if r.get("id") == content_id), None)
    if not row:
        raise RuntimeError(f"ไม่พบ content id: {content_id}")
    return row


def pick_due_scheduled_items(rows):
    """หารายการที่: postMode == 'scheduled', ยังไม่ postedAt, และ scheduledAt <= ตอนนี้"""
    now = datetime.now(timezone.utc)
    due = []
    for r in rows:
        if r.get("postMode") != "scheduled":
            continue
        if r.get("postedAt"):
            continue
        scheduled_at = r.get("scheduledAt")
        if not scheduled_at:
            continue
        try:
            when = datetime.fromisoformat(str(scheduled_at).replace("Z", "+00:00"))
        except ValueError:
            print(f"⚠️  ข้าม {r.get('id')}: scheduledAt รูปแบบไม่ถูกต้อง ({scheduled_at})")
            continue
        if when <= now:
            due.append(r)
    return due


# ═══════════════════════════════════════════════════════════════
# ควบคุมโทรศัพท์ผ่าน ADB / uiautomator2
# ⚠️ ฟังก์ชันโซนนี้ทั้งหมดมี selector ตัวอย่าง (PLACEHOLDER) ต้องคาลิเบรตก่อนใช้จริง
#    ดูวิธีคาลิเบรตใน README.md หัวข้อ "การคาลิเบรต"
# ═══════════════════════════════════════════════════════════════

SHOPEE_PACKAGE = "com.shopee.th"  # แพ็กเกจแอป Shopee ประเทศไทย — เช็คให้ตรงเครื่องคุณอีกที
                                   # (เช็คได้ด้วยคำสั่ง: adb shell pm list packages | grep shopee)
# หน้า "เพิ่มแคปชั่น"/โพสต์ อยู่ใน plugin แยก — resourceId ขึ้นต้นด้วยชื่อนี้แทน (Shopee 3.81.32, เช็คซ้ำกับ 3.82.58)
PUBLISH_PLUGIN = "com.shopee.th.dfpluginshopee16"
CAPTION_MAX_CHARS = 150  # ช่องแคปชั่นโชว์ตัวนับ 0/150


def connect_device(serial=None):
    if u2 is None:
        sys.exit("❌ ยังไม่ได้ติดตั้ง uiautomator2 — รัน: pip install uiautomator2")
    d = u2.connect(serial) if serial else u2.connect()
    d.implicitly_wait(10)
    return d


@contextlib.contextmanager
def do_not_disturb(d, mode="priority"):
    """เปิดโหมดห้ามรบกวนระหว่างทำงาน แล้วปิดคืนตอนจบ (ทั้งสำเร็จและพัง)
    mode "priority" = ยังรับสายโทรเข้าได้ตามที่ตั้งไว้ใน "ห้ามรบกวน" ของมือถือ / "on" = ปิดทุกอย่าง
    ถ้าผู้ใช้เปิดห้ามรบกวนไว้เองอยู่แล้ว (zen_mode ไม่ใช่ 0) จะไม่แตะ และไม่ปิดให้ตอนจบ"""
    turned_on = False
    try:
        if d.shell("settings get global zen_mode").output.strip() == "0":
            d.shell(["cmd", "notification", "set_dnd", mode])
            turned_on = True
    except Exception:
        pass
    try:
        yield
    finally:
        if turned_on:
            try:
                d.shell(["cmd", "notification", "set_dnd", "off"])
            except Exception:
                pass


def push_video_to_gallery(d, local_path):
    """ส่งไฟล์วิดีโอเข้าเครื่อง แล้วสั่ง media scan ให้ขึ้นในแกลเลอรี่"""
    remote_path = "/sdcard/DCIM/BenGenAutoPost/" + os.path.basename(local_path)
    d.push(local_path, remote_path)
    d.shell([
        "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
        "-d", f"file://{remote_path}",
    ])
    time.sleep(2)  # ให้เวลาระบบ scan ไฟล์เข้าแกลเลอรี่ก่อนเปิดแอป Shopee
    return remote_path


def remove_video_from_phone(d, remote_path):
    """ลบคลิปที่ push เข้าไปออกจากทั้งไฟล์และคลังภาพ (MediaStore) — _data เก็บเป็น /storage/emulated/0/..."""
    name = os.path.basename(remote_path)
    d.shell(["content", "delete", "--uri", "content://media/external/video/media",
             "--where", f"_data LIKE '%/BenGenAutoPost/{name}'"])
    d.shell(["rm", "-f", remote_path])


def recover_app(d):
    """ใช้เฉพาะตอนพัง "ก่อน" กดโพสต์: ปิดแอป Shopee ทิ้ง = ละทิ้งวิดีโอที่ทำค้างไว้ ให้รอบหน้าเริ่มใหม่สะอาด
    ห้ามเรียกหลังกดโพสต์แล้ว — อาจฆ่าการอัปโหลดที่กำลังทำอยู่"""
    d.app_stop(SHOPEE_PACKAGE)
    time.sleep(2)


UPLOAD_OPENED = "opened"  # เห็นป้าย "อัปโหลดสำเร็จ" และกดเข้าดูคลิปแล้ว
UPLOAD_DONE = "done"      # อัปโหลดเสร็จ แต่ไม่ได้กดป้าย (ป้ายหายไปก่อน หรือไม่ได้ขอให้กด)
UPLOAD_UNSEEN = "unseen"  # ไม่เห็นแถบอัปโหลดเลย — ยังไม่รู้ว่าขึ้นแล้วไหม ต้องไปเช็คในหน้าโปรไฟล์


def wait_upload_done(d, timeout=600, open_video=False, unseen_after=20):
    """หลังกด "โพสต์" แอปกลับไปหน้าฟีด แล้วโชว์แถบ "กำลังอัปโหลด... x%" → "อัปโหลดสำเร็จ" (หายเองในไม่กี่วิ)
    ข้อความพวกนี้ไม่มี resourceId — ใช้ text (คาลิเบรตกับ Shopee 3.81.32–3.82.58: ปกติอัปโหลดเสร็จใน <10 วิ)
    เช็คถี่ๆ ด้วย .exists (ไม่รอ implicit wait) เพราะป้าย "อัปโหลดสำเร็จ" อยู่บนจอแค่ช่วงสั้นๆ
    open_video=True: กดป้าย "อัปโหลดสำเร็จ / คลิกที่นี่เพื่อดูวิดีโอ" ทันทีที่เห็น
    คืน UPLOAD_OPENED / UPLOAD_DONE / UPLOAD_UNSEEN (ไม่เห็นแถบภายใน unseen_after วิ)"""
    start = time.time()
    progress_seen_at = None
    while time.time() - start < timeout:
        if d(text="อัปโหลดสำเร็จ").exists:
            # TextView บนป้ายไม่ clickable แต่ .click() กดตามพิกัด → ตัวป้ายรับแทน
            if open_video and d(text="คลิกที่นี่เพื่อดูวิดีโอ").click_exists(timeout=1):
                return UPLOAD_OPENED
            return UPLOAD_DONE
        if d(textMatches=r".*(อัปโหลดไม่สำเร็จ|อัปโหลดล้มเหลว|โพสต์ไม่สำเร็จ).*").exists:
            raise RuntimeError("Shopee แจ้งว่าอัปโหลดไม่สำเร็จ")
        if d(textStartsWith="กำลังอัปโหลด").exists:
            progress_seen_at = time.time()
        elif progress_seen_at and time.time() - progress_seen_at > 10:
            return UPLOAD_DONE  # แถบอัปโหลดหายไปโดยไม่มี error — ป้ายสำเร็จขึ้นแล้วหายไประหว่างรอบเช็ค
        elif not progress_seen_at and time.time() - start > unseen_after:
            if d(resourceId=f"{PUBLISH_PLUGIN}:id/btn_post").exists:
                raise RuntimeError("กดโพสต์แล้วแอปยังค้างอยู่หน้าเพิ่มแคปชั่น")
            return UPLOAD_UNSEEN
        time.sleep(0.5)
    raise RuntimeError(f"อัปโหลดนานเกิน {timeout} วิ")


VIDEO_TAB = {"description": "tab_bar_button_video_and_live"}  # คาลิเบรตแล้ว: แท็บ "Live & Video" แถบล่าง
CREATE_ICON = {"description": "click top right create icon"}  # คาลิเบรตแล้ว: ไอคอน + มุมขวาบนของหน้าฟีดวิดีโอ
ME_ICON = {"description": "click me page icon"}               # คาลิเบรตแล้ว: ไอคอนคนมุมซ้ายบนของฟีด → หน้าโปรไฟล์


def goto_video_feed(d, launches=2):
    """ปิด-เปิดแอป Shopee ใหม่ แล้วไปหน้าฟีด Live & Video — คืนไอคอน + (สร้างวิดีโอ) มุมขวาบน
    กดแท็บแล้วรอปุ่ม + ไม่เกิน 10 วิ (เจอก่อนก็ไปต่อเลย) ไม่เจอลองกดแท็บ + รออีก 10 วิ
    ครบ 2 รอบยังไม่เจอ = ปิดแอปแล้วเริ่มใหม่ (สูงสุด launches รอบ)"""
    video_tab = d(**VIDEO_TAB)
    create_icon = d(**CREATE_ICON)
    for _ in range(launches):
        d.app_start(SHOPEE_PACKAGE, stop=True)  # ปิดแล้วเปิดใหม่ ให้เริ่มที่หน้าแรก (มีแถบเมนูล่าง) เสมอ
        if not video_tab.wait(timeout=30):  # แอปเปิดใหม่ช้า (splash + โหลดหน้าแรก)
            continue
        for _ in range(2):
            if d(resourceId="popup_banner_image").exists:
                # ป๊อปอัปโฆษณา (ปุ่ม X ไม่มี text/desc) — ย้อนกลับเพื่อปิด
                # กดเฉพาะตอนมีป๊อปอัปจริง ไม่งั้นย้อนกลับที่หน้าแรกจะกลายเป็น "กดอีกครั้งเพื่อออก"
                d.press("back")
                time.sleep(1.5)
            video_tab.click_exists(timeout=1)
            if create_icon.wait(timeout=10):
                return create_icon
    raise RuntimeError("ไปหน้าฟีดวิดีโอไม่สำเร็จ (เปิดแอปใหม่ 2 รอบแล้วยังไม่เจอปุ่ม +)")


def open_shopee_video_composer(d):
    """เปิดแอป Shopee แล้วไปหน้ากล้อง 'สร้างวิดีโอ' (คาลิเบรตกับ Honor 70 / Shopee 3.82.58)"""
    d.screen_on()
    time.sleep(1)
    if "isKeyguardShowing=true" in d.shell("dumpsys window | grep isKeyguardShowing").output:
        raise RuntimeError(
            "จอโทรศัพท์ล็อกอยู่ — ปลดล็อกจอก่อน และแนะนำเปิด 'Stay awake' (ตัวเลือกนักพัฒนา) ให้จอไม่ดับตอนชาร์จ"
        )
    create_icon = goto_video_feed(d)
    # กดปุ่ม + ได้เลย ไม่ต้องสนว่าฟีดเป็นไลฟ์หรือคลิป (ถ้าหลังโพสต์ไม่เห็นแถบอัปโหลด จะไปเช็คในหน้าโปรไฟล์แทน)
    # เน็ตช้า หน้าฟีดยังโหลดไม่เสร็จ กดแล้วอาจไม่ติด — เช็คว่าเข้าหน้ากล้องจริง (มีปุ่มคลังภาพ) ไม่งั้นรอแล้วกดใหม่
    gallery_btn = d(resourceId=f"{SHOPEE_PACKAGE}:id/ll_gallery_entrance")
    for _ in range(3):
        create_icon.click_exists(timeout=10)
        if gallery_btn.wait(timeout=10):
            return
    raise RuntimeError("กดปุ่ม + แล้วไม่เข้าหน้าสร้างวิดีโอ (ลอง 3 รอบ)")


def select_video_from_gallery(d, remote_filename_hint):
    """เลือกวิดีโอที่เพิ่ง push เข้าไปจากคลังภาพ แล้วผ่านหน้าตัดต่อไปถึงหน้า 'เพิ่มแคปชั่น'"""
    # หน้าคลังภาพบางครั้งโหลดช้า (เคยพังเพราะหาแท็บ "วิดีโอ" ไม่เจอ) — รอหัวข้อ "คลังภาพ" ถ้าไม่ขึ้นกดปุ่มซ้ำ
    video_tab = d(description="วิดีโอ", clickable=True)
    for _ in range(3):
        d(resourceId=f"{SHOPEE_PACKAGE}:id/ll_gallery_entrance").click_exists(timeout=10)  # คาลิเบรตแล้ว: ปุ่ม "คลังภาพ" หน้ากล้อง
        if video_tab.wait(timeout=15):
            break
    else:
        raise RuntimeError("กดปุ่มคลังภาพแล้วหน้าคลังภาพไม่ขึ้น")
    time.sleep(1)
    # กดแท็บ "วิดีโอ" ก่อน กันพลาดไปเลือกรูปภาพที่ใหม่กว่าคลิปที่เพิ่ง push
    video_tab.click()  # คาลิเบรตแล้ว
    time.sleep(1)
    # Shopee ไม่โชว์ชื่อไฟล์ — เลือกช่องแรก (ใหม่สุด) ซึ่งคือคลิปที่เพิ่ง push เข้าไป
    d(resourceId=f"{SHOPEE_PACKAGE}:id/ll_check", instance=0).click()  # คาลิเบรตแล้ว: วงกลมเลือกของช่องแรก
    time.sleep(1)
    # พอเลือกคลิปแล้ว แถบล่างเปลี่ยนเป็น "1 เลือกแล้ว" + ปุ่ม "ถัดไป (1)" (id tv_pick_top_next)
    if not d(text="1 เลือกแล้ว").wait(timeout=5):
        raise RuntimeError("กดเลือกคลิปแล้วแต่แอปไม่ขึ้น '1 เลือกแล้ว'")
    d(resourceIdMatches=rf"{SHOPEE_PACKAGE}:id/tv_pick(_top)?_next").click()  # คาลิเบรตแล้ว: ปุ่ม "ถัดไป (1)"
    time.sleep(3)
    # หน้าตัดต่อวิดีโอ (ตัด/ข้อความ/สติ๊กเกอร์) — ไม่แก้อะไร กด "ถัดไป" ผ่านไปเลย
    d(resourceId=f"{SHOPEE_PACKAGE}:id/tv_compress").click()  # คาลิเบรตแล้ว
    time.sleep(3)  # รอแอปประมวลผล/บีบอัดวิดีโอ


def fill_caption(d, caption_text):
    """พิมพ์แคปชั่นลงช่องข้อความของวิดีโอ (หน้า "เพิ่มแคปชั่น")"""
    caption_field = d(resourceId=f"{PUBLISH_PLUGIN}:id/et_caption")  # คาลิเบรตแล้ว
    caption_field.click()
    caption_field.set_text(caption_text[:CAPTION_MAX_CHARS])
    # แป้นพิมพ์ที่ค้างอยู่ทำให้แตะ "เพิ่มสินค้า" ครั้งแรกแค่ปิดแป้นพิมพ์ แล้วเสียเวลารอหน้าสินค้าเปล่าๆ 20 วิ
    # เลยปิดแป้นพิมพ์ให้เสร็จตรงนี้ก่อน
    time.sleep(3)
    hide_keyboard(d)
    # ปิดแป้นพิมพ์แล้วยังมีชั้นสีดำค้างบังอยู่ (Shopee 3.82.58) — แตะ "เพิ่มสินค้า" ไม่ติด
    # แตะที่ว่างสีขาวใต้แถว "แชร์อัตโนมัติไปยัง" 1 ที (ไม่โดนสวิตช์/ปุ่ม) ให้ชั้นนั้นหายก่อน
    d.click(0.5, 0.8)
    time.sleep(1)


def _keyboard_shown(d):
    if "mInputShown=true" in d.shell("dumpsys input_method").output:
        return True
    return d(packageName="com.google.android.inputmethod.latin").exists  # Gboard (เห็นใน UI dump ตอนแป้นเปิด)


def hide_keyboard(d):
    """ปิดแป้นพิมพ์ด้วยปุ่มย้อนกลับ (กดเฉพาะตอนแป้นเปิดอยู่จริง — ไม่งั้นย้อนกลับจะออกจากหน้าแคปชั่น)
    รอบแรกไม่ได้ รอ 5 วิแล้วลองใหม่ — ยังไม่ได้ก็ไปต่อ (ขั้นแนบสินค้ากดซ้ำเผื่อไว้อยู่แล้ว)"""
    for attempt in range(2):
        if attempt:
            time.sleep(5)
        if not _keyboard_shown(d):
            return
        d.press("back")
        time.sleep(1)


class ProductNotAllowed(RuntimeError):
    """Shopee ไม่ยอมให้แนบสินค้านี้ในวิดีโอ (สินค้าถูกยกเว้น) — ลองใหม่กี่รอบก็ไม่ผ่าน"""


def attach_product(d, product_row):
    """
    แนบสินค้าด้วย "กรอกลิงก์สินค้า" (แม่นกว่าค้นหาด้วยชื่อ — ได้สินค้าตัวที่ถูกต้องแน่นอน)
    หน้าเพิ่มสินค้าเป็น React Native ไม่มี resourceId — ใช้ข้อความบนจอแทน
    """
    # ลองลิงก์สินค้าก่อน ถ้าวางแล้วไม่มีสินค้าขึ้น (ลิงก์ผิด/รูปแบบแปลก) ค่อยลอง affiliateLink — ใช้ได้เหมือนกัน
    links = []
    for key in ("productUrl", "affiliateLink"):
        url = str(product_row.get(key) or "").strip()
        if url and url not in links:
            links.append(url)
    if not links:
        raise RuntimeError(f"สินค้า {product_row.get('id')} ไม่มีทั้ง productUrl และ affiliateLink — แนบสินค้าไม่ได้")

    # หลังพิมพ์แคปชั่น แป้นพิมพ์ยังเปิดค้าง — แตะครั้งแรกมักแค่ปิดแป้นพิมพ์ เลยลองซ้ำได้
    # รอข้อความที่มีเฉพาะหน้าเพิ่มสินค้า (หน้าแคปชั่นก็มีหัวข้อ "เพิ่มสินค้า" — ใช้คำนั้นเช็คไม่ได้)
    # บางครั้งหน้านี้โหลดช้า (เคยพังเพราะรอ 8 วิไม่พอ) — รอรอบละ 20 วิ สูงสุด 4 รอบ
    product_page = d(text="ร้านค้าของฉัน")
    for _ in range(4):
        if not product_page.exists:  # กดรอบก่อนติดแล้วแต่หน้าโหลดช้า — อย่ากดซ้ำ
            d(resourceId=f"{PUBLISH_PLUGIN}:id/ll_add_product_symbol").click_exists(timeout=5)  # คาลิเบรตแล้ว: "แตะเพื่อเพิ่มสินค้า"
        if product_page.wait(timeout=20):
            break
    else:
        raise RuntimeError("ไม่เจอหน้า 'เพิ่มสินค้า'")
    time.sleep(5)  # เน็ตช้า รายการสินค้ายังโหลดไม่เสร็จ กดไอคอนเร็วไปจะไม่ติด
    link_box = d(className="android.widget.EditText")
    link_page = d(text="กรอกลิงก์สินค้า")
    for _ in range(2):
        if not link_page.exists:  # อยู่หน้ากรอกลิงก์แล้วห้ามกดตำแหน่งเดิมซ้ำ
            d.click(0.922, 0.065)  # ไอคอน 🔗 มุมขวาบน — ไม่มี text/desc ต้องกดตามตำแหน่ง (จอ 1080x2400)
        if link_page.wait(timeout=10) and link_box.wait(timeout=10):
            break
        time.sleep(5)
    else:
        raise RuntimeError("กดไอคอน 🔗 แล้วไม่เจอช่องกรอกลิงก์สินค้า")

    # ใส่ลิงก์ลงช่องตรงๆ (ทาง clipboard + "วางลิงก์" ไม่ติดเมื่อสั่งจากสคริปต์)
    # พอช่องมีข้อความ ปุ่ม "วางลิงก์" จะเปลี่ยนเป็น "นำเข้า"
    for i, url in enumerate(links):
        link_box.click()
        time.sleep(1)
        link_box.set_text(url)  # set_text ล้างข้อความเดิมก่อน — รอบสองจะทับลิงก์ที่ไม่ได้ผล
        if not d(text="นำเข้า").wait(timeout=5):
            raise RuntimeError("ใส่ลิงก์แล้วไม่มีปุ่ม 'นำเข้า'")
        d.toast.reset()
        d(text="นำเข้า").click()
        if d(textContains="ค่าคอม").wait(timeout=15):  # รอสินค้าโผล่ในส่วน "รายการสินค้า"
            break
        # นำเข้าไม่ได้ Shopee จะเด้ง toast บอกเหตุผล เช่น "นำเข้าไม่สำเร็จ เนื่องจากมีลิงก์สินค้าที่ถูกยกเว้น"
        toast = d.toast.get_message(3, 20, "") or ""
        if "ยกเว้น" in toast:
            # ตัวสินค้าถูกยกเว้น ลิงก์ไหนก็ไม่ผ่าน (affiliateLink พาไปสินค้าชิ้นเดิม) — ไม่ต้องลองต่อ
            raise ProductNotAllowed(f"Shopee ไม่ให้แนบสินค้านี้: {toast}")
    else:
        raise RuntimeError("นำเข้าลิงก์แล้วไม่มีสินค้าขึ้น: " + " | ".join(u[:80] for u in links))
    time.sleep(1)
    d(text="เลือกทั้งหมด").click()
    # พอเลือกแล้ว ปุ่มเปลี่ยนจาก "เพิ่ม" เป็น "เพิ่ม(1)" — ใช้เป็นตัวยืนยันว่าเลือกติดด้วย
    add_btn = d(textMatches=r"เพิ่ม\s*\(\d+\)")
    if not add_btn.wait(timeout=5):
        raise RuntimeError("กด 'เลือกทั้งหมด' แล้วปุ่มไม่เปลี่ยนเป็น 'เพิ่ม(1)'")
    add_btn.click()
    # กด "เพิ่ม" แล้วแอปพากลับหน้า "เพิ่มแคปชั่น" ทันที — เช็คว่ามีการ์ดสินค้าติดมาจริง
    if not d(resourceId=f"{PUBLISH_PLUGIN}:id/rl_product_item").wait(timeout=10):
        raise RuntimeError("กลับมาหน้าแคปชั่นแล้วแต่ไม่เห็นสินค้าที่แนบ")
    time.sleep(1)


def _toggle_is_on(d, el):
    """สวิตช์ในหน้าแคปชั่นเป็น View วาดเอง (attribute checked=false ตลอด) — ดูจากสีแทน:
    เปิด = พื้นเขียว (เช่น 84,194,69) / ปิด = พื้นเทา (224,224,224)"""
    b = el.info["bounds"]
    x = (b["left"] + b["right"]) // 2
    y = (b["top"] + b["bottom"]) // 2
    r, g, bl = d.screenshot().getpixel((x, y))[:3]
    return g > r + 60 and g > bl + 60


def enable_ai_label(d):
    """เปิดสวิตช์ "ครีเอเตอร์เพิ่มป้ายกำกับ AI ไปยังเนื้อหานี้" (วิดีโอใช้เสียง/สคริปต์ที่ AI สร้าง)"""
    toggle = d(resourceId=f"{PUBLISH_PLUGIN}:id/ai_generated_toggle")  # คาลิเบรตแล้ว
    if not toggle.wait(timeout=5):
        raise RuntimeError("ไม่เจอสวิตช์ป้ายกำกับ AI")
    if _toggle_is_on(d, toggle):
        return
    toggle.click()
    time.sleep(1)
    if not _toggle_is_on(d, toggle):
        raise RuntimeError("กดสวิตช์ป้ายกำกับ AI แล้วยังไม่เปิด")


def mp4_duration_seconds(path):
    """อ่านความยาวคลิปจาก atom 'mvhd' ในไฟล์ mp4 (ไม่ต้องลง ffprobe) — อ่านไม่ได้คืน None"""
    import struct
    try:
        with open(path, "rb") as f:
            data = f.read()
        i = data.find(b"mvhd")
        if i < 0:
            return None
        version = data[i + 4]
        if version == 1:
            timescale, duration = struct.unpack(">IQ", data[i + 24:i + 36])
        else:
            timescale, duration = struct.unpack(">II", data[i + 16:i + 24])
        return duration / timescale if timescale else None
    except Exception:
        return None


# ── หลังโพสต์: ดูคลิปตัวเอง + กดหัวใจ + คอมเมนต์ CTA ──
# คาลิเบรตจากหน้าฟีดวิดีโอ + แผงคอมเมนต์ (Shopee 3.81.32, เช็คซ้ำกับ 3.82.58) — หน้าคลิปตัวเองใช้ player ตัวเดียวกัน
# แผงคอมเมนต์เป็น React Native ไม่มี resourceId — ใช้ content-desc
VIDEO_LIKE_BTN = {"resourceId": "like btn"}
VIDEO_COMMENT_BTN = {"description": "click video comment_icon"}
COMMENT_PANEL_CLOSE = {"description": "close the comment panels"}  # ใช้เช็คว่าแผงยังเปิดอยู่
COMMENT_BAR = {"description": "click to add a comment"}           # แถบ "เพิ่มคอมเมนต์..." (แตะแล้วช่องพิมพ์ถึงโผล่)
COMMENT_INPUT = {"description": "click to comment now"}           # EditText ตอนแป้นพิมพ์เปิด
COMMENT_SEND = {"description": "send comment now"}                # ปุ่มส่ง (ห้ามใช้ปุ่ม "ส่ง" ของแป้นพิมพ์)
COMMENT_LIKE = {"description": "click comment like"}              # หัวใจขวาสุดของแต่ละคอมเมนต์


def _video_page_ready(d, timeout=15):
    return d(**VIDEO_COMMENT_BTN).wait(timeout=timeout)


def like_video(d):
    d(**VIDEO_LIKE_BTN).click()
    time.sleep(1.5)


def post_comment(d, text):
    """เปิดแผงคอมเมนต์ พิมพ์ข้อความ แล้วส่ง — คืน UiObject ของคอมเมนต์ที่ขึ้นในรายการ"""
    d(**VIDEO_COMMENT_BTN).click()
    box = d(**COMMENT_INPUT)
    # ปกติแผงเปิดมาพร้อมแถบ "เพิ่มคอมเมนต์..." แต่บางครั้งเปิดช่องพิมพ์ให้เลย
    deadline = time.time() + 10
    while not box.exists:
        if time.time() > deadline:
            raise RuntimeError("กดปุ่มคอมเมนต์แล้วไม่เจอช่องพิมพ์")
        if d(**COMMENT_BAR).click_exists(timeout=1):
            box.wait(timeout=5)
        else:
            time.sleep(1)
    box.set_text(text)
    time.sleep(1)
    d(**COMMENT_SEND).click()  # ImageView ไม่ clickable แต่กดตามพิกัดได้
    # คอมเมนต์ใหม่ขึ้นในรายการเป็น TextView (ช่องพิมพ์เป็น EditText — ถูกล้างทันทีหลังส่ง
    # เลยห้ามไปอ่าน node ของช่องพิมพ์ เคยพังเพราะ node หายระหว่างอ่าน)
    posted = d(textContains=text[:15], className="android.widget.TextView")
    if not posted.wait(timeout=10):
        raise RuntimeError("กดส่งคอมเมนต์แล้วไม่เห็นคอมเมนต์ขึ้นในรายการ")
    # ป้าย "เขียนคอมเมนต์แล้ว" บังกลางจอแป๊บนึง — รอให้หายก่อนกดอย่างอื่น
    d(text="เขียนคอมเมนต์แล้ว").wait_gone(timeout=5)
    return posted


def like_comment(d, comment_node):
    """กดหัวใจของคอมเมนต์ตัวเอง — หัวใจอยู่ขวาสุด ระดับเดียวกับชื่อผู้คอมเมนต์ (เหนือข้อความ ~80px)
    เลือกหัวใจตัวที่อยู่เหนือข้อความคอมเมนต์และใกล้ที่สุด"""
    top = comment_node.info["bounds"]["top"]
    best, best_gap = None, None
    likes = d(**COMMENT_LIKE)
    for i in range(likes.count):
        gap = top - likes[i].info["bounds"]["top"]
        if 0 <= gap <= 200 and (best_gap is None or gap < best_gap):
            best, best_gap = likes[i], gap
    if best is None:
        raise RuntimeError("ไม่เจอปุ่มหัวใจของคอมเมนต์ตัวเอง")
    best.click()
    time.sleep(1.5)


def close_comment_panel(d):
    """แตะพื้นที่ว่างด้านบน (ข้างวิดีโอที่ย่ออยู่ เลี่ยงแท็บบนสุด)
    ถ้าแป้นพิมพ์ยังเปิด แตะแรกแค่ปิดแป้นพิมพ์ — แตะซ้ำจนแผงปิด (แตะเกินจะไปหยุดวิดีโอ เลยเช็คทุกครั้ง)"""
    for _ in range(3):
        d.click(0.3, 0.2)
        time.sleep(1.5)
        if not d(**COMMENT_PANEL_CLOSE).exists:
            return
    raise RuntimeError("แตะพื้นที่ว่างแล้วแผงคอมเมนต์ยังไม่ปิด")


def _norm(s):
    return " ".join(str(s or "").split())


def _goto_profile_in_app(d):
    """ไปหน้าโปรไฟล์โดยไม่ปิดแอป (หลังกดโพสต์อาจยังอัปโหลดอยู่ — ปิดแอปตอนนี้อาจตัดการอัปโหลด)
    อยู่หน้าโปรไฟล์อยู่แล้ว → ย้อนกลับฟีดก่อน (ให้ตารางคลิปโหลดใหม่) / อยู่ที่อื่น → กดแท็บ Live & Video"""
    me = d(**ME_ICON)
    for _ in range(3):
        if me.exists:
            me.click()
            return True
        if not d(description="click to get back").click_exists(timeout=1):  # ปุ่มย้อนกลับหน้าโปรไฟล์/หน้าคลิป
            d(**VIDEO_TAB).click_exists(timeout=1)
        me.wait(timeout=10)
    return False


def open_latest_own_video(d, product_name, attempts=3, restart=False):
    """ฟีดวิดีโอ → ไอคอนโปรไฟล์มุมซ้ายบน → ตารางคลิป → ช่องแรกที่ไม่ได้ปักหมุด (= คลิปใหม่สุด)
    แล้วเช็คชื่อสินค้าที่แนบว่าตรงกับคลิปที่เพิ่งโพสต์ (กันไปกดหัวใจ/คอมเมนต์ผิดคลิป)
    ใช้ทั้งตอนกดป้าย "อัปโหลดสำเร็จ" ไม่ทัน และตอนไม่เห็นแถบอัปโหลดเลย (ใช้ยืนยันว่าคลิปขึ้นแล้ว)
    restart=False: ไม่ปิดแอป ไปหน้าโปรไฟล์จากในแอป / True: ไปไม่ได้ค่อยปิด-เปิดแอปใหม่ (ใช้ตอนรู้ว่าอัปโหลดเสร็จแล้ว)
    คลิปอาจยังไม่ขึ้นในโปรไฟล์ทันที เลยลองซ้ำได้ — คืน True ถ้าเปิดคลิปที่ถูกต้องได้"""
    want = _norm(product_name)[:25]
    for i in range(attempts):
        if i:
            time.sleep(15)
        if not _goto_profile_in_app(d):
            if not restart:
                continue
            goto_video_feed(d)
            d(**ME_ICON).click()
        cells = d(descriptionMatches=r"click video \d+")
        if not cells.wait(timeout=15):
            continue
        time.sleep(1)
        pins = d(text="ปักหมุด")
        pin_boxes = [pins[j].info["bounds"] for j in range(pins.count)]
        target = None
        for j in range(cells.count):
            b = cells[j].info["bounds"]
            if not any(b["left"] <= p["left"] <= b["right"] and b["top"] <= p["top"] <= b["bottom"] for p in pin_boxes):
                target = cells[j]
                break
        if target is None:
            continue
        target.click()
        if not _video_page_ready(d):
            continue
        anchor = d(description="click video product icon").child(className="android.widget.TextView")
        names = [_norm(anchor[j].get_text()) for j in range(anchor.count)]
        if not want or any(want in n for n in names):
            return True
    return False


def engage_own_video(d, comment_text, video_seconds=None, watch_seconds=5):
    """ทำต่อจากตอนเปิดคลิปตัวเองแล้ว: ดูคลิป watch_seconds วิ → กดหัวใจ → คอมเมนต์ CTA
    → กดหัวใจคอมเมนต์ตัวเอง → ปิดแผงคอมเมนต์ ดูจนจบคลิป → ปิดแอป Shopee"""
    opened_at = time.time()
    if not _video_page_ready(d):
        raise RuntimeError("กดป้ายอัปโหลดสำเร็จแล้วไม่เข้าหน้าวิดีโอ")
    time.sleep(max(0, opened_at + watch_seconds - time.time()))
    like_video(d)
    if comment_text:
        node = post_comment(d, comment_text)
        like_comment(d, node)
        close_comment_panel(d)
    if video_seconds:
        # ดูให้จบรอบแรก — คลิปวนเล่นเองตอนเปิดแผงคอมเมนต์อยู่ ถ้าเกินความยาวแล้วก็ดูต่อแค่นิดเดียว
        remaining = video_seconds - (time.time() - opened_at)
        time.sleep(max(3, remaining + 2))
    d.app_stop(SHOPEE_PACKAGE)


def finalize_post(d, draft=False):
    """ปุ่มสุดท้ายในหน้า "เพิ่มแคปชั่น" — 'โพสต์' หรือ 'แบบร่าง'"""
    if draft:
        d(resourceId=f"{PUBLISH_PLUGIN}:id/tv_drafts_box").click()  # คาลิเบรตแล้ว: ปุ่ม "แบบร่าง"
    else:
        d(resourceId=f"{PUBLISH_PLUGIN}:id/btn_post").click()       # คาลิเบรตแล้ว: ปุ่ม "โพสต์"


# ═══════════════════════════════════════════════════════════════
# ขั้นตอนหลัก: โพสต์ 1 รายการ
# ═══════════════════════════════════════════════════════════════

def post_one_item(cfg, d, content_row, draft=False, dry_run=False):
    content_id = content_row["id"]
    caption = content_row.get("caption") or content_row.get("hook") or ""
    mp4_url = content_row.get("mp4DriveUrl")

    if not mp4_url:
        print(f"⚠️  {content_id}: ยังไม่มีไฟล์วิดีโอ (mp4DriveUrl ว่าง) — ข้าม")
        return False

    print(f"▶️  กำลังโพสต์ content id={content_id} ...")

    local_path = os.path.join(cfg["temp_dir"], f"{content_id}.mp4")
    download_file(mp4_url, local_path)
    print(f"   ดาวน์โหลดวิดีโอแล้ว: {local_path}")

    if dry_run:
        print("   [dry-run] ข้ามขั้นตอนควบคุมโทรศัพท์จริง")
        return True

    remote_path = push_video_to_gallery(d, local_path)
    print(f"   ส่งวิดีโอเข้าเครื่องแล้ว: {remote_path}")

    open_shopee_video_composer(d)
    select_video_from_gallery(d, os.path.basename(remote_path))
    fill_caption(d, caption)

    product_row = fetch_product_row(cfg["apps_url"], content_row.get("productId"))
    if product_row:
        attach_product(d, product_row)
    else:
        print("   ⚠️ ไม่พบข้อมูลสินค้า — ข้ามขั้นตอนแนบสินค้า")

    if cfg.get("ai_label", True):
        enable_ai_label(d)

    finalize_post(d, draft=draft)

    if draft:
        update_status(cfg["apps_url"], content_id, "postMode", "draft_saved")
        print("   💾 บันทึกร่างเรียบร้อย")
    else:
        mark_posted(cfg["apps_url"], content_id)
        print("   ✅ โพสต์เรียบร้อย บันทึกสถานะแล้ว")

    os.remove(local_path)
    return True


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="BenGen Auto Post SP — โพสต์วิดีโอขึ้น Shopee Video อัตโนมัติ")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--mode", choices=["manual", "scheduled"], required=True)
    parser.add_argument("--content-id", help="ใช้กับ --mode manual เท่านั้น")
    parser.add_argument("--draft", action="store_true", help="บันทึกเป็นร่างแทนการโพสต์จริง")
    parser.add_argument("--device", help="ระบุ serial ของโทรศัพท์ (ถ้าต่ออยู่เครื่องเดียวไม่ต้องใส่)")
    parser.add_argument("--dry-run", action="store_true", help="ทดสอบดึงข้อมูล/ดาวน์โหลด โดยไม่ยุ่งกับโทรศัพท์จริง")
    args = parser.parse_args()

    cfg = load_config(args.config)
    os.makedirs(cfg["temp_dir"], exist_ok=True)

    rows = fetch_content_rows(cfg["apps_url"])

    if args.mode == "manual":
        if not args.content_id:
            sys.exit("❌ โหมด manual ต้องระบุ --content-id ด้วยครับ")
        targets = [pick_manual_item(rows, args.content_id)]
    else:
        targets = pick_due_scheduled_items(rows)
        if not targets:
            print("ℹ️  ยังไม่มีรายการที่ถึงเวลาโพสต์ตอนนี้")
            return

    d = None
    if not args.dry_run:
        d = connect_device(args.device)

    for i, row in enumerate(targets):
        post_one_item(cfg, d, row, draft=args.draft, dry_run=args.dry_run)
        if i < len(targets) - 1:
            wait_s = random.randint(cfg.get("min_gap_seconds", 120), cfg.get("max_gap_seconds", 300))
            print(f"   ⏳ เว้นระยะ {wait_s} วิ ก่อนโพสต์รายการถัดไป (กันดูเป็นแพทเทิร์นบอท)...")
            time.sleep(wait_s)


if __name__ == "__main__":
    main()
