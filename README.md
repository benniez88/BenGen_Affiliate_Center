# BenGen Affiliate Center

เครื่องมือสร้าง Content + Video สำหรับ Shopee Affiliate แบบกึ่งอัตโนมัติ
(Chrome Extension → Google Sheets/Drive → n8n → Gemini → Video Template)

## โครงสร้างไฟล์

| ไฟล์ / โฟลเดอร์ | หน้าที่ |
|---|---|
| `affiliate-command-center-v2.html` | หน้า Command Center (standalone, เรียก Gemini + Apps Script) |
| `index.html` | Video Template + อัปโหลดขึ้น Drive (เดิมชื่อ `bengen-template-v3.html`) |
| `Code.gs` | Google Apps Script backend |
| `bengen-extension/` | Chrome Extension (Side Panel) — ดึงข้อมูลสินค้าจาก Shopee |
| `bengen-affiliate-system/` | แพ็กเกจรวม (extension + apps-script + video template) |
| `n8n-workflows/` | n8n workflows A/B/C (content generator, video builder, MP3 watcher) |
| `SETUP_GUIDE.md` | คู่มือติดตั้งแบบละเอียด |

## เริ่มต้น

ดู [`SETUP_GUIDE.md`](SETUP_GUIDE.md) สำหรับขั้นตอนติดตั้งทั้งหมด

## หมายเหตุ

- ไม่มี API Key อยู่ในโค้ด — ต้องกรอกเองใน Extension Settings / n8n Variables / Apps Script Script Properties
- ไฟล์ `.zip` ไม่ถูก commit (มีโฟลเดอร์ต้นฉบับอยู่แล้ว)
