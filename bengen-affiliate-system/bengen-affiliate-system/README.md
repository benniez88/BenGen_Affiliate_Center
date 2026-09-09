# ⚡ BenGen Affiliate System

ระบบ Automation สำหรับ Shopee Affiliate — ดึงข้อมูลสินค้า สร้าง Content ด้วย AI และสร้างวิดีโออัตโนมัติ

---

## โครงสร้างโปรเจค

```
bengen-affiliate-system/
├── extension/              ← Chrome Extension (Side Panel)
│   ├── manifest.json
│   ├── sidepanel.html
│   ├── sidepanel.js
│   ├── content.js
│   ├── background.js
│   └── icons/
├── apps-script/            ← Google Apps Script Backend
│   └── Code.gs
├── video-template/         ← Video Template (HTML)
│   └── bengen-template-v3.html
└── SETUP_GUIDE.md
```

---

## Flow การทำงาน

```
affiliate.shopee.co.th
        ↓
Chrome Extension (Side Panel)
ดึงข้อมูล: ชื่อ / ราคา / commission / รูป / affiliate link
        ↓
Google Sheets + Drive (Apps Script)
บันทึกข้อมูล + Upload รูป
        ↓
n8n Workflow A
Gemini สร้าง Hook / Script / Caption / บทพากย์
        ↓
Google AI Studio TTS
Copy บทพากย์ → Generate เสียง → Download .wav
        ↓
Upload .wav → Drive
n8n Workflow C ตรวจพบ → Update voiceStatus = done
        ↓
Video Template (bengen-template-v3.html)
โหลดข้อมูลจาก Sheets + รูป/เสียงจาก Drive → Export MP4
        ↓
Upload MP4 → Drive
        ↓
Android → โพสต์ Shopee Video
```

---

## ติดตั้ง Extension

1. Clone หรือ Download โปรเจคนี้
2. เปิด Chrome → `chrome://extensions`
3. เปิด **Developer mode**
4. กด **Load unpacked** → เลือกโฟลเดอร์ `extension/`
5. กดไอคอน **⚡ B** ใน Toolbar → Side Panel จะเปิดขึ้น

---

## ติดตั้ง Apps Script

1. เปิด Google Sheets ใหม่
2. Extensions → Apps Script
3. Copy โค้ดจาก `apps-script/Code.gs` ทั้งหมด → วางแทนที่ของเดิม
4. Deploy → New Deployment → Web App
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy Deployment URL → ใส่ใน Extension Settings

---

## ตั้งค่า Extension

กดไอคอน Extension → ⚙️ Settings

| ช่อง | ค่า |
|---|---|
| Gemini API Key | จาก [Google AI Studio](https://aistudio.google.com) |
| Gemini Model | `gemini-3.5-flash-lite` (Free) |
| Apps Script URL | URL จาก Deploy ด้านบน |

---

## ใช้งาน Video Template

1. เปิด `video-template/bengen-template-v3.html` ใน Chrome
2. ใส่ Apps Script URL
3. กด **โหลดรายการสินค้า** → เลือกสินค้า
4. กด **โหลดรูปจาก Drive** และ **โหลดเสียงจาก Drive**
5. กด **Export MP4** → รอ Render
6. Download หรือ Upload ขึ้น Drive

---

## Tools ที่ใช้

| Tool | หน้าที่ | ค่าใช้จ่าย |
|---|---|---|
| Chrome Extension | ดึงข้อมูลสินค้า | ฟรี |
| Google Sheets + Drive | เก็บข้อมูล + ไฟล์ | ฟรี |
| Google Apps Script | Backend API | ฟรี |
| Gemini API | สร้าง Content | ฟรี |
| Google AI Studio TTS | สร้างเสียง | ฟรี |
| n8n (Self-hosted) | Automation | ฟรี |

**ทั้งระบบฟรี 100%**

---

## n8n Workflows

- **Workflow A** — ตรวจ Products Sheet → Gemini สร้าง Content อัตโนมัติ
- **Workflow C** — ตรวจ Drive → พบ MP3/WAV ใหม่ → Update voiceStatus

ดูวิธีตั้งค่าใน [SETUP_GUIDE.md](./SETUP_GUIDE.md)

---

## License

MIT — ใช้ได้ฟรี ดัดแปลงได้
