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
    res = requests.get(url, timeout=120, stream=True)
    res.raise_for_status()
    with open(dest_path, "wb") as f:
        for chunk in res.iter_content(chunk_size=1 << 16):
            f.write(chunk)
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
# หน้า "เพิ่มแคปชั่น"/โพสต์ อยู่ใน plugin แยก — resourceId ขึ้นต้นด้วยชื่อนี้แทน (Shopee 3.81.32)
PUBLISH_PLUGIN = "com.shopee.th.dfpluginshopee16"
CAPTION_MAX_CHARS = 150  # ช่องแคปชั่นโชว์ตัวนับ 0/150


def connect_device(serial=None):
    if u2 is None:
        sys.exit("❌ ยังไม่ได้ติดตั้ง uiautomator2 — รัน: pip install uiautomator2")
    d = u2.connect(serial) if serial else u2.connect()
    d.implicitly_wait(10)
    return d


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


def wait_upload_done(d, timeout=600, open_video=False):
    """หลังกด "โพสต์" แอปกลับไปหน้าฟีด แล้วโชว์แถบ "กำลังอัปโหลด... x%" → "อัปโหลดสำเร็จ" (หายเองในไม่กี่วิ)
    ข้อความพวกนี้ไม่มี resourceId — ใช้ text (คาลิเบรตกับ Shopee 3.81.32: คลิป 6MB อัปโหลดเสร็จใน ~3 วิ)
    เช็คถี่ๆ ด้วย .exists (ไม่รอ implicit wait) เพราะป้าย "อัปโหลดสำเร็จ" อยู่บนจอแค่ช่วงสั้นๆ
    open_video=True: กดป้าย "อัปโหลดสำเร็จ / คลิกที่นี่เพื่อดูวิดีโอ" ทันทีที่เห็น
    คืน True ถ้ากดป้ายเปิดวิดีโอแล้ว / False ถ้าไม่ได้กด (ป้ายหายไปก่อน หรือไม่ได้ขอให้กด)"""
    start = time.time()
    progress_seen_at = None
    while time.time() - start < timeout:
        if d(text="อัปโหลดสำเร็จ").exists:
            if open_video:
                # TextView บนป้ายไม่ clickable แต่ .click() กดตามพิกัด → ตัวป้ายรับแทน
                return d(text="คลิกที่นี่เพื่อดูวิดีโอ").click_exists(timeout=1)
            return False
        if d(textMatches=r".*(อัปโหลดไม่สำเร็จ|อัปโหลดล้มเหลว|โพสต์ไม่สำเร็จ).*").exists:
            raise RuntimeError("Shopee แจ้งว่าอัปโหลดไม่สำเร็จ")
        if d(textStartsWith="กำลังอัปโหลด").exists:
            progress_seen_at = time.time()
        elif progress_seen_at and time.time() - progress_seen_at > 10:
            return False  # แถบอัปโหลดหายไปโดยไม่มี error — ป้ายสำเร็จขึ้นแล้วหายไประหว่างรอบเช็ค
        elif not progress_seen_at and time.time() - start > 30:
            if d(resourceId=f"{PUBLISH_PLUGIN}:id/btn_post").exists:
                raise RuntimeError("กดโพสต์แล้วแอปยังค้างอยู่หน้าเพิ่มแคปชั่น")
            raise RuntimeError("กดโพสต์แล้วไม่เห็นสถานะอัปโหลดเลยภายใน 30 วิ")
        time.sleep(0.5)
    raise RuntimeError(f"อัปโหลดนานเกิน {timeout} วิ")


def goto_video_feed(d):
    """ปิด-เปิดแอป Shopee ใหม่ แล้วไปหน้าฟีด Live & Video — คืนไอคอน + (สร้างวิดีโอ) มุมขวาบน"""
    d.app_start(SHOPEE_PACKAGE, stop=True)  # ปิดแล้วเปิดใหม่ ให้เริ่มที่หน้าแรก (มีแถบเมนูล่าง) เสมอ
    video_tab = d(description="tab_bar_button_video_and_live")  # คาลิเบรตแล้ว: แท็บ "Live & Video" แถบล่าง
    if not video_tab.wait(timeout=30):  # แอปเปิดใหม่ช้า (splash + โหลดหน้าแรก)
        raise RuntimeError("เปิดแอป Shopee แล้วไม่เจอแถบเมนูล่าง")
    create_icon = d(description="click top right create icon")  # คาลิเบรตแล้ว: ไอคอน + มุมขวาบนของหน้าฟีดวิดีโอ
    # หน้าแรกช่วงเพิ่งเปิดไม่นิ่ง — ป๊อปอัปโฆษณาเด้งช้า/แถบล่างหายชั่วคราว วนเช็คจนถึงหน้าฟีดวิดีโอ
    deadline = time.time() + 45
    while not create_icon.exists:
        if time.time() > deadline:
            raise RuntimeError("ไปหน้าฟีดวิดีโอไม่สำเร็จ (ติดป๊อปอัปหรือหาแท็บ Live & Video ไม่เจอ)")
        if d(resourceId="popup_banner_image").exists:
            # ป๊อปอัปโฆษณา (ปุ่ม X ไม่มี text/desc) — ย้อนกลับเพื่อปิด
            # กดเฉพาะตอนมีป๊อปอัปจริง ไม่งั้นย้อนกลับที่หน้าแรกจะกลายเป็น "กดอีกครั้งเพื่อออก"
            d.press("back")
            time.sleep(1.5)
        elif video_tab.click_exists(timeout=1):
            time.sleep(3)  # รอฟีดวิดีโอโหลด
        else:
            time.sleep(1)
    return create_icon


def open_shopee_video_composer(d):
    """เปิดแอป Shopee แล้วไปหน้ากล้อง 'สร้างวิดีโอ' (คาลิเบรตกับ Honor 70 / Shopee 3.81.32)"""
    d.screen_on()
    time.sleep(1)
    if "isKeyguardShowing=true" in d.shell("dumpsys window | grep isKeyguardShowing").output:
        raise RuntimeError(
            "จอโทรศัพท์ล็อกอยู่ — ปลดล็อกจอก่อน และแนะนำเปิด 'Stay awake' (ตัวเลือกนักพัฒนา) ให้จอไม่ดับตอนชาร์จ"
        )
    create_icon = goto_video_feed(d)
    # หลังกดโพสต์ แอปกลับมาที่รายการเดิมในฟีด — ถ้าเป็นไลฟ์ แถบ "กำลังอัปโหลด/อัปโหลดสำเร็จ" ไม่ขึ้น
    # เลยปัดจนเจอคลิปวิดีโอ (มีปุ่มคอมเมนต์) ก่อนกดสร้าง
    for _ in range(6):
        if d(**VIDEO_COMMENT_BTN).exists:
            break
        d.swipe(0.5, 0.75, 0.5, 0.25, 0.15)
        time.sleep(2)
    else:
        raise RuntimeError("ปัดฟีดหลายรอบแล้วยังไม่เจอคลิปวิดีโอ (เจอแต่ไลฟ์)")
    create_icon.click()
    time.sleep(2)


def select_video_from_gallery(d, remote_filename_hint):
    """เลือกวิดีโอที่เพิ่ง push เข้าไปจากคลังภาพ แล้วผ่านหน้าตัดต่อไปถึงหน้า 'เพิ่มแคปชั่น'"""
    d(resourceId=f"{SHOPEE_PACKAGE}:id/ll_gallery_entrance").click()  # คาลิเบรตแล้ว: ปุ่ม "คลังภาพ" หน้ากล้อง
    time.sleep(2)
    # กดแท็บ "วิดีโอ" ก่อน กันพลาดไปเลือกรูปภาพที่ใหม่กว่าคลิปที่เพิ่ง push
    d(description="วิดีโอ", clickable=True).click()  # คาลิเบรตแล้ว
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
    time.sleep(1)


def attach_product(d, product_row):
    """
    แนบสินค้าด้วย "กรอกลิงก์สินค้า" (แม่นกว่าค้นหาด้วยชื่อ — ได้สินค้าตัวที่ถูกต้องแน่นอน)
    หน้าเพิ่มสินค้าเป็น React Native ไม่มี resourceId — ใช้ข้อความบนจอแทน
    """
    product_url = product_row.get("productUrl") or product_row.get("affiliateLink")
    if not product_url:
        raise RuntimeError(f"สินค้า {product_row.get('id')} ไม่มี productUrl — แนบสินค้าไม่ได้")

    # หลังพิมพ์แคปชั่น แป้นพิมพ์ยังเปิดค้าง — แตะครั้งแรกมักแค่ปิดแป้นพิมพ์ เลยลองซ้ำได้
    # รอข้อความที่มีเฉพาะหน้าเพิ่มสินค้า (หน้าแคปชั่นก็มีหัวข้อ "เพิ่มสินค้า" — ใช้คำนั้นเช็คไม่ได้)
    # บางครั้งหน้านี้โหลดช้า (เคยพังเพราะรอ 8 วิไม่พอ) — รอรอบละ 20 วิ สูงสุด 4 รอบ
    product_page = d(text="ร้านค้าของฉัน")
    for _ in range(4):
        d(resourceId=f"{PUBLISH_PLUGIN}:id/ll_add_product_symbol").click_exists(timeout=5)  # คาลิเบรตแล้ว: "แตะเพื่อเพิ่มสินค้า"
        if product_page.wait(timeout=20):
            break
    else:
        raise RuntimeError("ไม่เจอหน้า 'เพิ่มสินค้า'")
    time.sleep(2)  # รอรายการสินค้าโหลดก่อนกดไอคอน
    d.click(0.922, 0.065)  # ไอคอน 🔗 มุมขวาบน — ไม่มี text/desc ต้องกดตามตำแหน่ง (จอ 1080x2400)
    if not d(text="กรอกลิงก์สินค้า").wait(timeout=10):
        raise RuntimeError("กดไอคอน 🔗 แล้วไม่เจอหน้า 'กรอกลิงก์สินค้า'")

    # ใส่ลิงก์ลงช่องตรงๆ (ทาง clipboard + "วางลิงก์" ไม่ติดเมื่อสั่งจากสคริปต์)
    # พอช่องมีข้อความ ปุ่ม "วางลิงก์" จะเปลี่ยนเป็น "นำเข้า"
    link_box = d(className="android.widget.EditText")
    link_box.click()
    time.sleep(1)
    link_box.set_text(product_url)
    if not d(text="นำเข้า").wait(timeout=5):
        raise RuntimeError("ใส่ลิงก์แล้วไม่มีปุ่ม 'นำเข้า'")
    d(text="นำเข้า").click()
    if not d(textContains="ค่าคอม").wait(timeout=15):  # รอสินค้าโผล่ในส่วน "รายการสินค้า"
        raise RuntimeError(f"นำเข้าลิงก์แล้วไม่มีสินค้าขึ้น: {product_url}")
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
# คาลิเบรตจากหน้าฟีดวิดีโอ + แผงคอมเมนต์ (Shopee 3.81.32) — หน้าคลิปตัวเองใช้ player ตัวเดียวกัน
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
    # คอมเมนต์ใหม่ขึ้นบนสุดของรายการ — เช็คจากข้อความต้นๆ (Shopee อาจตัดข้อความยาว)
    posted = d(textContains=text[:15])
    deadline = time.time() + 10
    while time.time() < deadline:
        # ข้อความเดียวกันยังค้างในช่องพิมพ์ = ยังไม่ส่ง ต้องเจอ TextView ที่ไม่ใช่ EditText
        for i in range(posted.count):
            node = posted[i]
            if node.info.get("className") != "android.widget.EditText":
                return node
        time.sleep(1)
    raise RuntimeError("กดส่งคอมเมนต์แล้วไม่เห็นคอมเมนต์ขึ้นในรายการ")


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


def open_latest_own_video(d, product_name, attempts=3):
    """ทางสำรองเมื่อกดป้าย "อัปโหลดสำเร็จ" ไม่ทัน: ฟีดวิดีโอ → ไอคอนโปรไฟล์มุมซ้ายบน → ตารางคลิป
    → ช่องแรกที่ไม่ได้ปักหมุด (= คลิปใหม่สุด) แล้วเช็คชื่อสินค้าที่แนบว่าตรงกับคลิปที่เพิ่งโพสต์
    คลิปอาจยังไม่ขึ้นในโปรไฟล์ทันที เลยลองซ้ำได้ — คืน True ถ้าเปิดคลิปที่ถูกต้องได้"""
    want = _norm(product_name)[:25]
    for i in range(attempts):
        if i:
            time.sleep(15)
        goto_video_feed(d)
        d(description="click me page icon").click()  # คาลิเบรตแล้ว: ไอคอนคนมุมซ้ายบนของฟีด
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


def engage_own_video(d, comment_text, video_seconds=None, watch_seconds=40):
    """ทำต่อจาก wait_upload_done(open_video=True): ดูคลิป ~40 วิ → กดหัวใจ → คอมเมนต์ CTA
    → กดหัวใจคอมเมนต์ตัวเอง → ปิดแผงคอมเมนต์ ดูจนจบคลิป → ปิดแอป Shopee"""
    opened_at = time.time()
    if not _video_page_ready(d):
        raise RuntimeError("กดป้ายอัปโหลดสำเร็จแล้วไม่เข้าหน้าวิดีโอ")
    time.sleep(max(0, opened_at + watch_seconds + random.uniform(0, 5) - time.time()))
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
