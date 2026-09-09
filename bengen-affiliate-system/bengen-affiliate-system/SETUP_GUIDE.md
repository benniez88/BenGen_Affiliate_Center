# BenGen Affiliate System — Complete Setup Guide

## ภาพรวมระบบ

```
affiliate.shopee.co.th
    ↓ (Chrome Extension Side Panel)
Google Sheets + Google Drive
    ↓ (n8n Workflow A)
Gemini สร้าง Content
    ↓ (ElevenLabs Web - Manual)
Download MP3 → Upload Drive
    ↓ (n8n Workflow C auto-detect)
n8n Workflow B trigger
    ↓ (Video Template)
Export MP4 → Upload Drive
    ↓ (Android - Manual)
โพสต์ Shopee Video
```

---

## ไฟล์ทั้งหมด

| ไฟล์ | หน้าที่ |
|---|---|
| `bengen-extension.zip` | Chrome Extension (Side Panel) |
| `Code.gs` | Google Apps Script Backend |
| `n8n-workflows/workflow-a-*.json` | n8n: Auto Content Generator |
| `n8n-workflows/workflow-b-*.json` | n8n: Video Builder Trigger |
| `n8n-workflows/workflow-c-*.json` | n8n: MP3 Upload Watcher |
| `bengen-template-v3.html` | Video Template + Drive Upload |

---

## ลำดับการติดตั้ง

### Step 1: Apps Script
1. เปิด Google Sheets ใหม่
2. Extensions → Apps Script → วาง Code.gs ทั้งหมด
3. Deploy → New Deployment → Web App
   - Execute as: **Me**
   - Access: **Anyone**
4. Copy Deployment URL

### Step 2: Chrome Extension
1. แตกไฟล์ `bengen-extension.zip`
2. Chrome → `chrome://extensions` → Developer Mode ON
3. Load unpacked → เลือกโฟลเดอร์ `bengen-extension/`
4. กดไอคอน Extension → ⚙️ Settings
5. ใส่ Gemini API Key + Apps Script URL → Save

### Step 3: n8n Variables
ไปที่ Settings → Variables → เพิ่ม:
- `APPS_SCRIPT_URL` = URL จาก Step 1
- `GEMINI_API_KEY` = Gemini API Key
- `DRIVE_ROOT_FOLDER_ID` = (ได้หลัง saveProduct ครั้งแรก)

### Step 4: n8n Credentials
- Google Sheets OAuth2
- Google Drive OAuth2

### Step 5: Import n8n Workflows
Import workflow-a, b, c → ตั้ง credentials → Activate

### Step 6: Video Template
เปิด `bengen-template-v3.html` ใน Browser → ใส่ Apps Script URL

---

## การใช้งานประจำวัน

1. เปิด `affiliate.shopee.co.th` → เลือกสินค้า
2. กดไอคอน Extension → กด "ดึงข้อมูลสินค้า"
3. กรอก Commission + Affiliate Link → กด "สร้าง Content"
4. กด "บันทึกลง Sheets + Drive"
   → n8n Workflow A รัน Gemini อัตโนมัติ
5. ไป Content Sheet → Copy บทพากย์
6. เปิด elevenlabs.io → Generate เสียง → Download MP3
7. Upload MP3 ขึ้น Drive โฟลเดอร์สินค้า
   → n8n Workflow C ตรวจพบ → Update status
8. เปิด `bengen-template-v3.html`
   → โหลดข้อมูลจาก Extension อัตโนมัติ
   → อัปโหลดรูป + MP3 → Export MP4
   → กด "Upload Drive"
9. เปิด Google Drive บน Android → โพสต์ Shopee Video

