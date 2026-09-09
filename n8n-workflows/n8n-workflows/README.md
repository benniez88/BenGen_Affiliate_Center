# BenGen Affiliate — n8n Workflows Setup Guide

## Variables ที่ต้องตั้งใน n8n

ไปที่ **Settings → Variables** แล้วเพิ่ม:

| Variable | ค่า |
|---|---|
| `APPS_SCRIPT_URL` | URL จาก Apps Script Deployment |
| `GEMINI_API_KEY` | Gemini API Key |
| `DRIVE_ROOT_FOLDER_ID` | Folder ID ของ "BenGen Affiliate" ใน Drive |
| `VIDEO_API_URL` | (optional) API สำหรับสร้างวิดีโออัตโนมัติ |

## วิธีหา DRIVE_ROOT_FOLDER_ID

1. เปิด Google Drive
2. เข้าโฟลเดอร์ "BenGen Affiliate" (สร้างอัตโนมัติหลัง saveProduct ครั้งแรก)
3. ดู URL: `https://drive.google.com/drive/folders/XXXXXXXXXX`
4. `XXXXXXXXXX` คือ Folder ID

## Credentials ที่ต้องตั้ง

- **Google Sheets OAuth2**: สำหรับ Trigger + Read
- **Google Drive OAuth2**: สำหรับ Watch ไฟล์ใหม่

## Workflow ทั้งหมด

### Workflow A — Auto Content Generator
**Trigger:** มีแถวใหม่ใน Products Sheet (status = "new")
**ทำ:** Gemini สร้าง Content → บันทึก Content Sheet → Update status = "content_ready"

### Workflow B — Video Builder
**Trigger:** Content Sheet มี voiceStatus = "done" และ videoStatus = "pending"
**ทำ:** ดึง Drive URL → เตรียม data สำหรับสร้างวิดีโอ → Update status

### Workflow C — MP3 Watcher
**Trigger:** มีไฟล์ .mp3 ใหม่ใน Drive (ทุก subfolder)
**ทำ:** หา contentId จากโฟลเดอร์ → Update voiceStatus = "done" + บันทึก mp3DriveUrl

## Flow สมบูรณ์

```
Extension บันทึกสินค้า → Products Sheet (status: new)
        ↓ Workflow A trigger
Gemini สร้าง Content → Content Sheet (voiceStatus: pending)
        ↓ คุณเปิด ElevenLabs + Download MP3
Upload MP3 → Drive โฟลเดอร์สินค้า
        ↓ Workflow C trigger
Content Sheet อัปเดต (voiceStatus: done)
        ↓ Workflow B trigger
พร้อมสร้างวิดีโอ → แจ้งเตือน
```

## วิธี Import Workflow

1. เปิด n8n Dashboard
2. กด **+ New Workflow** → **Import from File**
3. เลือกไฟล์ .json ทีละตัว
4. ตั้ง Credentials และ Variables
5. **Activate** ทีละ Workflow

## Status Flow

```
Products Sheet:
new → content_ready → done

Content Sheet:
voiceStatus: pending → done
videoStatus: pending → processing → done
```
