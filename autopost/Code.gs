// ═══════════════════════════════════════════════════════════════
// BENGEN AFFILIATE — Google Apps Script v3.0
// ═══════════════════════════════════════════════════════════════
// วิธีติดตั้ง:
// 1. เปิด Google Sheets → Extensions → Apps Script
// 2. วางโค้ดนี้ทั้งหมดแทนที่ของเดิม
// 3. Deploy → New Deployment → Web App
//    Execute as: Me | Who has access: Anyone
// 4. Copy Deployment URL ไปใส่ใน Extension Settings
// ═══════════════════════════════════════════════════════════════

// ── DRIVE FOLDER ──────────────────────────────────────────────
// สร้างโฟลเดอร์หลักใน Drive อัตโนมัติ ถ้ายังไม่มี
const ROOT_FOLDER_NAME = 'BenGen Affiliate';

// ── SHEET NAMES ───────────────────────────────────────────────
const SN = {
  PRODUCTS: 'Products',
  CONTENT:  'Content',
  CONFIG:   'Config',
  // Legacy (เก็บไว้สำหรับ App หลัก)
  PLANS:    'Plans',
  TRACKER:  'Tracker',
  CONTENT_LOG: 'ContentLog',
};

// ── HEADERS ───────────────────────────────────────────────────
const HEADERS = {
  PRODUCTS: [
    'id','name','price','priceSale','discount',
    'commissionRate','commissionBaht','affiliateLink','productUrl',
    'shopName','shopType','rating','ratingCount','sales',
    'description','imageCount','driveFolderUrl','driveImageUrl',
    'status','createdAt','updatedAt',
    'introImageFile', // เพิ่มท้ายสุดเสมอ — ห้ามแทรกกลาง จะทำให้คอลัมน์เดิมเลื่อนเพี้ยนกับ Sheet ที่มีอยู่แล้ว
    'promoterCount'   // จำนวนพาร์ทเนอร์ที่โปรโมตสินค้านี้อยู่ — เอาไว้เช็คระดับการแข่งขัน
  ],
  CONTENT: [
    'id','productId','productName',
    'hook','script','caption','voiceScript',
    'voiceStatus','mp3DriveUrl',
    'videoStatus','mp4DriveUrl',
    'charCount','status','createdAt','updatedAt',
    'postedAt',      // เพิ่มท้ายสุดเสมอ — เวลาที่โพสต์จริงแล้ว (เขียนโดย markPosted)
    'scheduledAt',   // เวลาที่ตั้งไว้ให้ BenGen Auto Post SP โพสต์อัตโนมัติ (ว่าง = โพสต์เองด้วยมือ ไม่ auto)
    'postMode',      // 'now' | 'scheduled' | 'draft' — Auto Post SP ใช้เช็คว่าจะโพสต์จริงหรือเซฟร่าง
  ],
  CONFIG: ['key','value','updatedAt'],
  PLANS:  ['id','product','platform','date','status','affiliateLink','note','createdAt','updatedAt'],
  TRACKER:['id','product','platform','date','clicks','orders','commission','createdAt','updatedAt'],
  CONTENT_LOG:['id','product','platform','tone','lang','content','videoPrompt','createdAt'],
};

// ═══════════════════════════════════════════════════════════════
// ENTRY POINTS
// ═══════════════════════════════════════════════════════════════
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    initSheets();
    const params   = e.parameter || {};
    const postData = e.postData ? JSON.parse(e.postData.contents || '{}') : {};
    const action   = params.action || postData.action;
    const sheet    = params.sheet  || postData.sheet;
    const data     = postData.data;
    let result;

    switch (action) {
      // ── Core CRUD ──
      case 'read':        result = readSheet(sheet); break;
      case 'write':       result = writeRow(sheet, data); break;
      case 'update':      result = updateRow(sheet, data); break;
      case 'delete':      result = deleteRow(sheet, postData.id); break;
      case 'bulkWrite':   result = bulkWrite(sheet, postData.rows); break;
      case 'sync':        result = syncAll(); break;
      case 'getConfig':   result = getConfig(); break;
      case 'setConfig':   result = setConfig(postData.configs); break;

      // ── Extension v2 ──
      case 'saveProduct': result = saveProduct(data); break;
      case 'saveContent': result = saveContent(data); break;
      case 'updateStatus':result = updateStatus(postData); break;
      case 'getDriveUrl':   result = getDriveUrl(postData.productId); break;
      case 'uploadVideo':   result = uploadVideo(postData); break;
      case 'uploadAudio':   result = uploadAudio(postData); break;

      // ── n8n Workflow C ──
      case 'getDriveImages':     result = getDriveImages(params);       break;
      case 'markPosted':         result = markPosted(postData);         break;
      case 'unmarkPosted':       result = unmarkPosted(postData);       break;
      case 'listDriveAudio':     result = listDriveAudio(params);       break;
      case 'findFolderByProduct': result = findFolderByProduct(params);   break;
      case 'proxyAudio':         result = proxyAudio(params);            break;
      case 'proxyVideo':         result = proxyVideo(params);            break;
      case 'findAudioByProduct': result = findAudioByProduct(params);   break;
      case 'proxyImage':         result = proxyImage(params);            break;
      case 'searchNewAudio':     result = searchNewAudio(postData);     break;
      case 'markAudioProcessed': result = markAudioProcessed(postData); break;

      case 'ping':        result = { ok: true, time: new Date().toISOString(), version: '3.0' }; break;
      default:            result = { error: 'Unknown action: ' + action };
    }

    return jsonResp(result);
  } catch (err) {
    return jsonResp({ error: err.message });
  }
}

function jsonResp(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════
// SAVE PRODUCT — รับข้อมูลจาก Extension + Upload รูปขึ้น Drive
// ═══════════════════════════════════════════════════════════════
function saveProduct(d) {
  if (!d) throw new Error('ไม่มีข้อมูล');
  if (!d.name) throw new Error('ต้องระบุชื่อสินค้า');

  const id  = d.id || Utilities.getUuid();
  const now = new Date().toISOString();

  // ── สร้างโฟลเดอร์ใน Drive ──────────────────────────────
  const dateSlug  = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const nameSlug  = sanitizeFileName(d.name).substring(0, 40);
  const folderName = dateSlug + '_' + nameSlug;

  const rootFolder    = getOrCreateFolder(ROOT_FOLDER_NAME);
  const prodFolder    = getOrCreateFolder('Products', rootFolder);
  const itemFolder    = getOrCreateFolder(folderName, prodFolder);
  const driveFolderUrl = itemFolder.getUrl();

  // ── Upload รูปภาพ ──────────────────────────────────────
  let driveImageUrl = '';
  const images = d.images || [];
  let uploadCount = 0;

  for (let i = 0; i < images.length; i++) {
    const base64 = images[i];
    if (!base64 || !base64.startsWith('data:')) continue;

    try {
      const blob     = base64ToBlob(base64, 'product-' + (i + 1) + '.jpg');
      const file     = itemFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      if (i === 0) {
        driveImageUrl = 'https://drive.google.com/uc?id=' + file.getId();
      }
      uploadCount++;
    } catch (e) {
      Logger.log('Image upload error ' + i + ': ' + e.message);
    }
  }

  // ── บันทึก content.txt ──────────────────────────────────
  if (d.hook || d.script || d.caption || d.voiceScript) {
    const contentTxt =
      '=== BenGen Affiliate Content ===\n' +
      'สินค้า: ' + d.name + '\n' +
      'วันที่: ' + now + '\n\n' +
      '🎯 HOOK\n' + (d.hook || '') + '\n\n' +
      '🎬 SCRIPT\n' + (d.script || '') + '\n\n' +
      '📝 CAPTION\n' + (d.caption || '') + '\n\n' +
      '🎤 บทพากย์\n' + (d.voiceScript || '');
    const txtBlob = Utilities.newBlob(contentTxt, 'text/plain', 'content.txt');
    itemFolder.createFile(txtBlob);
  }

  // ── บันทึกลง Products Sheet ─────────────────────────────
  const rowData = {
    id,
    name:            d.name,
    price:           d.price || 0,
    priceSale:       d.priceSale || 0,
    discount:        d.discount || 0,
    commissionRate:  d.commissionRate || 0,
    commissionBaht:  d.commissionBaht || 0,
    affiliateLink:   d.affiliateLink || '',
    productUrl:      d.productUrl || '',
    shopName:        d.shopName || '',
    shopType:        d.shopType || 'normal',
    rating:          d.rating || 0,
    ratingCount:     d.ratingCount || 0,
    sales:           d.sales || 0,
    description:     (d.description || '').substring(0, 300),
    imageCount:      uploadCount,
    driveFolderUrl,
    driveImageUrl,
    status:          'new',
    createdAt:       now,
    updatedAt:       now,
    introImageFile:  d.introImageFile || '',
    promoterCount:   d.promoterCount || 0,
  };

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SN.PRODUCTS);
  // เผื่อ Sheet เดิมที่มีอยู่แล้วยังไม่มีคอลัมน์นี้ (สร้างให้อัตโนมัติที่ท้ายสุด ครั้งเดียวพอ)
  ensureHeaderColumn(sheet, 'introImageFile');
  ensureHeaderColumn(sheet, 'promoterCount');
  const row   = HEADERS.PRODUCTS.map(h => rowData[h] !== undefined ? rowData[h] : '');
  sheet.appendRow(row);

  // ── บันทึก Content ถ้ามี ────────────────────────────────
  let contentId = '';
  if (d.voiceScript || d.hook) {
    const cr = saveContentInternal({
      productId:   id,
      productName: d.name,
      hook:        d.hook || '',
      script:      d.script || '',
      caption:     d.caption || '',
      voiceScript: d.voiceScript || '',
    });
    contentId = cr.id;
  }

  return {
    ok:            true,
    productId:     id,
    contentId,
    driveFolder:   driveFolderUrl,
    driveImageUrl,
    imageUploaded: uploadCount,
    folderName,
  };
}

// ═══════════════════════════════════════════════════════════════
// SAVE CONTENT
// ═══════════════════════════════════════════════════════════════
function saveContent(d) {
  if (!d) throw new Error('ไม่มีข้อมูล');
  const result = saveContentInternal(d);
  return { ok: true, ...result };
}

function saveContentInternal(d) {
  const id  = d.id || Utilities.getUuid();
  const now = new Date().toISOString();

  const rowData = {
    id,
    productId:   d.productId || '',
    productName: d.productName || '',
    hook:        d.hook || '',
    script:      d.script || '',
    caption:     d.caption || '',
    voiceScript: d.voiceScript || '',
    voiceStatus: 'pending',
    mp3DriveUrl: '',
    videoStatus: 'pending',
    mp4DriveUrl: '',
    charCount:   (d.voiceScript || '').length,
    status:      d.status || 'new', // ใช้ค่าที่ส่งมาถ้ามี (เช่น content_ready/content_incomplete จาก n8n)
    createdAt:   now,
    updatedAt:   now,
    postedAt:    '',
    scheduledAt: d.scheduledAt || '', // เวลาที่ตั้งให้ BenGen Auto Post SP โพสต์อัตโนมัติ — ว่าง = ยังไม่ตั้งเวลา
    postMode:    d.postMode || 'now', // 'now' | 'scheduled' | 'draft'
  };

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SN.CONTENT);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SN.CONTENT);

  // เผื่อ Sheet เดิมที่มีอยู่แล้วยังไม่มีคอลัมน์พวกนี้ (สร้างให้อัตโนมัติที่ท้ายสุด ครั้งเดียวพอ)
  ensureHeaderColumn(sheet, 'postedAt');
  ensureHeaderColumn(sheet, 'scheduledAt');
  ensureHeaderColumn(sheet, 'postMode');

  const row = HEADERS.CONTENT.map(h => rowData[h] !== undefined ? rowData[h] : '');
  sheet.appendRow(row);

  return { id, productId: d.productId };
}

// ═══════════════════════════════════════════════════════════════
// UPDATE STATUS (สำหรับ n8n เรียก)
// ═══════════════════════════════════════════════════════════════
function updateStatus(params) {
  const { sheet: sheetName, id, field, value, driveUrl } = params;
  if (!id) throw new Error('ต้องระบุ id');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName || SN.CONTENT);
  if (!sheet) throw new Error('ไม่พบ Sheet');

  const rowNum  = findRowById(sheet, id);
  if (rowNum < 0) throw new Error('ไม่พบ row id: ' + id);

  // Update field ที่ระบุ — ใช้ ensureHeaderColumn แทน headers.indexOf() ตรงๆ
  // เผื่อเป็น field ใหม่ที่ Sheet ยังไม่มีคอลัมน์ (เช่น scheduledAt สำหรับ Auto Post SP)
  // จะได้ไม่ต้องมาแก้ Code.gs ทุกครั้งที่มี field ใหม่เพิ่มเข้ามา
  if (field) {
    const colIdx = ensureHeaderColumn(sheet, field);
    sheet.getRange(rowNum, colIdx).setValue(value || '');
  }
  if (driveUrl) {
    // บันทึก URL ของไฟล์ที่ upload
    const urlField  = field === 'voiceStatus' ? 'mp3DriveUrl' : 'mp4DriveUrl';
    const urlColIdx = ensureHeaderColumn(sheet, urlField);
    sheet.getRange(rowNum, urlColIdx).setValue(driveUrl);
  }

  // updatedAt
  const updatedIdx = ensureHeaderColumn(sheet, 'updatedAt');
  sheet.getRange(rowNum, updatedIdx).setValue(new Date().toISOString());

  return { ok: true, id, field, value };
}

// ═══════════════════════════════════════════════════════════════
// GET DRIVE URL (สำหรับ n8n ดึง URL โฟลเดอร์สินค้า)
// ═══════════════════════════════════════════════════════════════
function getDriveUrl(productId) {
  if (!productId) throw new Error('ต้องระบุ productId');
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SN.PRODUCTS);
  const rowNum = findRowById(sheet, productId);
  if (rowNum < 0) throw new Error('ไม่พบ productId: ' + productId);
  const headers    = getSheetHeaders(sheet);
  const folderIdx  = headers.indexOf('driveFolderUrl');
  const imageIdx   = headers.indexOf('driveImageUrl');
  return {
    driveFolderUrl: folderIdx >= 0 ? sheet.getRange(rowNum, folderIdx + 1).getValue() : '',
    driveImageUrl:  imageIdx  >= 0 ? sheet.getRange(rowNum, imageIdx  + 1).getValue() : '',
  };
}

// ═══════════════════════════════════════════════════════════════
// DRIVE HELPERS
// ═══════════════════════════════════════════════════════════════
function getOrCreateFolder(name, parent) {
  const root = parent || DriveApp.getRootFolder();
  const iter = root.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return root.createFolder(name);
}

function base64ToBlob(base64Data, fileName) {
  // base64Data = "data:image/jpeg;base64,/9j/4AAQ..."
  const parts    = base64Data.split(',');
  const mimeType = parts[0].match(/:(.*?);/)[1] || 'image/jpeg';
  const decoded  = Utilities.base64Decode(parts[1]);
  return Utilities.newBlob(decoded, mimeType, fileName);
}

function sanitizeFileName(name) {
  return name.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '-').trim() || 'product';
}

// ═══════════════════════════════════════════════════════════════
// SHEETS INIT
// ═══════════════════════════════════════════════════════════════
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(SN).forEach(([key, name]) => {
    const headers = HEADERS[key];
    if (!headers) return;
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      const range = sheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setBackground('#1a1025');
      range.setFontColor('#c87dff');
      range.setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// SHEETS CRUD
// ═══════════════════════════════════════════════════════════════
function readSheet(sheetName) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { rows: [] };
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return { rows: [] };
  const headers = data[0];
  const rows = data.slice(1)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    })
    .filter(r => r.id);
  return { rows, count: rows.length };
}

function writeRow(sheetName, data) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheet   = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found: ' + sheetName };
  const headers = HEADERS[sheetName.toUpperCase()] || getSheetHeaders(sheet);
  const now     = new Date().toISOString();
  if (!data.id) data.id = Utilities.getUuid();
  if (!data.createdAt) data.createdAt = now;
  data.updatedAt = now;
  if (findRowById(sheet, data.id) > 0) return updateRow(sheetName, data);
  sheet.appendRow(headers.map(h => data[h] !== undefined ? data[h] : ''));
  return { success: true, id: data.id, action: 'created' };
}

function updateRow(sheetName, data) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheet   = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found' };
  const rowNum  = findRowById(sheet, data.id);
  if (rowNum < 0) return writeRow(sheetName, data);
  const headers = HEADERS[sheetName.toUpperCase()] || getSheetHeaders(sheet);
  data.updatedAt = new Date().toISOString();
  sheet.getRange(rowNum, 1, 1, headers.length).setValues([headers.map(h => data[h] !== undefined ? data[h] : '')]);
  return { success: true, id: data.id, action: 'updated' };
}

function deleteRow(sheetName, id) {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheet  = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found' };
  const rowNum = findRowById(sheet, id);
  if (rowNum < 0) return { error: 'Not found: ' + id };
  sheet.deleteRow(rowNum);
  return { success: true, id, action: 'deleted' };
}

function bulkWrite(sheetName, rows) {
  if (!rows?.length) return { success: true, count: 0 };
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheet   = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found' };
  const headers = HEADERS[sheetName.toUpperCase()] || getSheetHeaders(sheet);
  const now     = new Date().toISOString();
  const last    = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, headers.length).clearContent();
  const values  = rows.map(d => {
    if (!d.id) d.id = Utilities.getUuid();
    if (!d.createdAt) d.createdAt = now;
    d.updatedAt = now;
    return headers.map(h => d[h] !== undefined ? d[h] : '');
  });
  if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  return { success: true, count: values.length };
}

function syncAll() {
  return {
    products:   readSheet(SN.PRODUCTS),
    content:    readSheet(SN.CONTENT),
    plans:      readSheet(SN.PLANS),
    tracker:    readSheet(SN.TRACKER),
    syncedAt:   new Date().toISOString()
  };
}

function getConfig() {
  const result = readSheet(SN.CONFIG);
  const config = {};
  (result.rows || []).forEach(r => { if (r.key) config[r.key] = r.value; });
  return { config };
}

function setConfig(configs) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SN.CONFIG);
  const now   = new Date().toISOString();
  Object.entries(configs).forEach(([key, value]) => {
    const row = findByKey(sheet, key);
    if (row > 0) sheet.getRange(row, 2, 1, 2).setValues([[value, now]]);
    else sheet.appendRow([key, value, now]);
  });
  return { success: true };
}


// ═══════════════════════════════════════════════════════════════
// UPLOAD VIDEO — รับ Base64 MP4 จาก Video Template → Upload Drive
// ═══════════════════════════════════════════════════════════════
function uploadVideo(params) {
  const { productId, videoBase64, fileName } = params;
  if (!videoBase64) throw new Error('ไม่มีข้อมูลวิดีโอ');

  // หาโฟลเดอร์ของสินค้า
  let targetFolder = getOrCreateFolder(ROOT_FOLDER_NAME);

  if (productId) {
    try {
      const driveInfo = getDriveUrl(productId);
      if (driveInfo.driveFolderUrl) {
        // ดึง Folder จาก URL
        const folderId = driveInfo.driveFolderUrl.match(/folders\/([^?]+)/)?.[1];
        if (folderId) {
          targetFolder = DriveApp.getFolderById(folderId);
        }
      }
    } catch(e) {
      Logger.log('Folder lookup error: ' + e.message);
    }
  }

  // Upload วิดีโอ
  const blob    = base64ToBlob(videoBase64, fileName || 'video-final.mp4');
  const file    = targetFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const fileUrl  = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  const directUrl = 'https://drive.google.com/uc?id=' + file.getId();

  // Update Content Sheet ถ้ามี productId
  if (productId) {
    try {
      const ss      = SpreadsheetApp.getActiveSpreadsheet();
      const content = ss.getSheetByName(SN.CONTENT);
      const headers = getSheetHeaders(content);
      const pidIdx  = headers.indexOf('productId');
      const statIdx = headers.indexOf('videoStatus');
      const urlIdx  = headers.indexOf('mp4DriveUrl');
      const updIdx  = headers.indexOf('updatedAt');

      if (pidIdx >= 0) {
        const colLetter = String.fromCharCode(65 + pidIdx); // A, B, C...
        const finder = content.getRange(colLetter + ':' + colLetter)
          .createTextFinder(String(productId)).matchEntireCell(true);
        const cell = finder.findNext();

        if (cell) {
          const rowNum = cell.getRow();
          if (statIdx >= 0) content.getRange(rowNum, statIdx+1).setValue('done');
          if (urlIdx  >= 0) content.getRange(rowNum, urlIdx+1).setValue(directUrl);
          if (updIdx  >= 0) content.getRange(rowNum, updIdx+1).setValue(new Date().toISOString());
        }
      }
    } catch(e) {
      Logger.log('Content update error: ' + e.message);
    }
  }

  return {
    ok:        true,
    fileId:    file.getId(),
    fileUrl,
    directUrl,
    driveUrl:  fileUrl,
    fileName:  file.getName(),
    size:      file.getSize(),
  };
}

// ═══════════════════════════════════════════════════════════════
// UPLOAD AUDIO — รับ Base64 WAV จาก Extension (Gemini TTS) → Upload Drive
// ═══════════════════════════════════════════════════════════════
function uploadAudio(params) {
  const { productId, contentId, audioBase64, fileName } = params;
  if (!audioBase64) throw new Error('ไม่มีข้อมูลเสียง');

  // หาโฟลเดอร์ของสินค้า
  let targetFolder = getOrCreateFolder(ROOT_FOLDER_NAME);

  if (productId) {
    try {
      const driveInfo = getDriveUrl(productId);
      if (driveInfo.driveFolderUrl) {
        const folderId = driveInfo.driveFolderUrl.match(/folders\/([^?]+)/)?.[1];
        if (folderId) targetFolder = DriveApp.getFolderById(folderId);
      }
    } catch(e) {
      Logger.log('Folder lookup error: ' + e.message);
    }
  }

  // Upload เสียง
  const blob = base64ToBlob(audioBase64, fileName || 'voiceover.wav');
  const file = targetFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const fileUrl   = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  const directUrl = 'https://drive.google.com/uc?id=' + file.getId();

  // Update Content Sheet — หาแถวจาก contentId ก่อน (แม่นกว่า) ถ้าไม่มีค่อยใช้ productId
  try {
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const content = ss.getSheetByName(SN.CONTENT);
    const headers = getSheetHeaders(content);
    const pidIdx  = headers.indexOf('productId');
    const statIdx = headers.indexOf('voiceStatus');
    const urlIdx  = headers.indexOf('mp3DriveUrl');
    const updIdx  = headers.indexOf('updatedAt');

    // id อยู่คอลัมน์ A เสมอ (ตาม HEADERS.CONTENT) — ใช้ findRowById (TextFinder) ได้ตรงๆ
    let rowNum = contentId ? findRowById(content, contentId) : -1;

    // Fallback: หาจาก productId แทน ถ้าไม่พบด้วย contentId
    if (rowNum < 0 && productId && pidIdx >= 0) {
      const colLetter = String.fromCharCode(65 + pidIdx);
      const finder = content.getRange(colLetter + ':' + colLetter)
        .createTextFinder(String(productId)).matchEntireCell(true);
      const cell = finder.findNext();
      if (cell) rowNum = cell.getRow();
    }

    if (rowNum > 0) {
      if (statIdx >= 0) content.getRange(rowNum, statIdx+1).setValue('done');
      if (urlIdx  >= 0) content.getRange(rowNum, urlIdx+1).setValue(directUrl);
      if (updIdx  >= 0) content.getRange(rowNum, updIdx+1).setValue(new Date().toISOString());
    }
  } catch(e) {
    Logger.log('Content update error: ' + e.message);
  }

  return {
    ok:        true,
    fileId:    file.getId(),
    fileUrl,
    directUrl,
    fileName:  file.getName(),
    size:      file.getSize(),
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function findRowById(sheet, id) {
  if (!id) return -1;
  // ใช้ TextFinder ค้นหาแบบ native ของ Sheets — เร็วกว่าอ่านทั้งชีทมาวนลูปมาก
  // โดยเฉพาะเมื่อ Sheet มีข้อมูลเยอะขึ้นเรื่อยๆ (ป้องกัน Timeout)
  const finder = sheet.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true);
  const cell   = finder.findNext();
  return cell ? cell.getRow() : -1;
}

function findByKey(sheet, key) {
  if (!key) return -1;
  const finder = sheet.getRange('A:A').createTextFinder(String(key)).matchEntireCell(true);
  const cell   = finder.findNext();
  return cell ? cell.getRow() : -1;
}

function getSheetHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

// เพิ่มคอลัมน์ใหม่ในหัวตาราง ถ้ายังไม่มี — คืนค่า column index (1-based)
function ensureHeaderColumn(sheet, colName) {
  const headers = getSheetHeaders(sheet);
  const idx = headers.indexOf(colName);
  if (idx >= 0) return idx + 1;

  const newCol = headers.length + 1;
  sheet.getRange(1, newCol).setValue(colName);
  return newCol;
}

// ═══════════════════════════════════════════════════════════════
// MARK POSTED — ทำเครื่องหมายว่าโพสต์แล้ว (สำหรับ Mobile App)
// ═══════════════════════════════════════════════════════════════
function markPosted(params) {
  const id = params.id || params.contentId;
  if (!id) throw new Error('ต้องระบุ id');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SN.CONTENT);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SN.CONTENT);

  const rowNum = findRowById(sheet, id);
  if (rowNum < 0) throw new Error('ไม่พบ content id: ' + id);

  const colIdx = ensureHeaderColumn(sheet, 'postedAt');
  const now    = new Date().toISOString();
  sheet.getRange(rowNum, colIdx).setValue(now);

  return { ok: true, id, postedAt: now };
}

function unmarkPosted(params) {
  const id = params.id || params.contentId;
  if (!id) throw new Error('ต้องระบุ id');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SN.CONTENT);
  const rowNum = findRowById(sheet, id);
  if (rowNum < 0) throw new Error('ไม่พบ content id: ' + id);

  const colIdx = ensureHeaderColumn(sheet, 'postedAt');
  sheet.getRange(rowNum, colIdx).setValue('');

  return { ok: true, id };
}

// ═══════════════════════════════════════════════════════════════
// SEARCH NEW AUDIO FILES (สำหรับ n8n Workflow C)
// ═══════════════════════════════════════════════════════════════
function searchNewAudio(params) {
  const folderId = params.folderId;
  if (!folderId) throw new Error('ต้องระบุ folderId');

  const since    = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sinceStr = Utilities.formatDate(since, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  const files    = [];

  function searchFolder(folder) {
    const iter = folder.searchFiles(
      "trashed = false and createdTime > '" + sinceStr + "'"
    );
    while (iter.hasNext()) {
      const file = iter.next();
      const name = file.getName();
      if (!/\.(mp3|wav|m4a|aac)$/i.test(name)) continue;
      if (file.getDescription() === 'processed') continue;
      files.push({
        id:          file.getId(),
        name:        name,
        parentName:  folder.getName(),
        createdTime: file.getDateCreated().toISOString()
      });
    }
    const subs = folder.getFolders();
    while (subs.hasNext()) searchFolder(subs.next());
  }

  searchFolder(DriveApp.getFolderById(folderId));
  return { files: files };
}

function markAudioProcessed(params) {
  if (!params.fileId) return { ok: false };
  DriveApp.getFileById(params.fileId).setDescription('processed');
  return { ok: true, fileId: params.fileId };
}

// ═══════════════════════════════════════════════════════════════
// GET DRIVE IMAGES — ดึงรูปในโฟลเดอร์ + ส่งกลับเป็น Base64
// ═══════════════════════════════════════════════════════════════
function getDriveImages(params) {
  const folderId = params.folderId || (params.parameter && params.parameter.folderId);
  if (!folderId) throw new Error('ต้องระบุ folderId');

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch(e) {
    throw new Error('เปิดโฟลเดอร์ไม่ได้ (folderId: ' + folderId + ') — ' + e.message);
  }

  const iter    = folder.getFiles();
  const images  = [];
  let totalFiles = 0;
  const allNames = [];

  while (iter.hasNext()) {
    const file = iter.next();
    const name = file.getName();
    totalFiles++;
    allNames.push(name);
    if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(name)) continue;

    try {
      const blob     = file.getBlob();
      const b64      = Utilities.base64Encode(blob.getBytes());
      const mimeType = blob.getContentType() || 'image/jpeg';
      images.push({
        id:     file.getId(),
        name:   name,
        base64: 'data:' + mimeType + ';base64,' + b64
      });
    } catch(e) {
      Logger.log('Image error: ' + name + ' — ' + e.message);
    }

    if (images.length >= 8) break;
  }

  return {
    images: images,
    count: images.length,
    folderName: folder.getName(),
    totalFilesInFolder: totalFiles,
    allFileNames: allNames.slice(0, 20)
  };
}

// ═══════════════════════════════════════════════════════════════
// FIND FOLDER BY PRODUCT — ค้นหาโฟลเดอร์จากชื่อสินค้า (Fallback)
// ใช้เมื่อ driveFolderUrl ที่บันทึกไว้ใน Sheet ใช้ไม่ได้
// ═══════════════════════════════════════════════════════════════
function findFolderByProduct(params) {
  const productId = params.productId;
  const name      = params.name || '';
  if (!productId && !name) throw new Error('ต้องระบุ productId หรือ name');

  const root = getOrCreateFolder(ROOT_FOLDER_NAME);
  const prodRoot = getOrCreateFolder('Products', root);
  const iter = prodRoot.getFolders();

  const candidates = [];
  const nameSlug = sanitizeFileName(name).substring(0, 40).toLowerCase();

  while (iter.hasNext()) {
    const f = iter.next();
    const fname = f.getName();
    // Match: folder name เช่น "2026-09-09_ส่งด่วนฟรี-Louis-..."
    if (nameSlug && fname.toLowerCase().indexOf(nameSlug.substring(0, 15)) >= 0) {
      candidates.push({ id: f.getId(), name: fname, url: f.getUrl() });
    }
  }

  if (!candidates.length) {
    return { found: false, searched: nameSlug, message: 'ไม่พบโฟลเดอร์ที่ตรงกับชื่อสินค้านี้' };
  }

  // เอาโฟลเดอร์ล่าสุด (ชื่อโฟลเดอร์ขึ้นต้นด้วยวันที่ ISO ทำให้ sort string ได้)
  candidates.sort((a,b) => b.name.localeCompare(a.name));

  return { found: true, folder: candidates[0], allMatches: candidates };
}

// ═══════════════════════════════════════════════════════════════
// PROXY IMAGE — ส่งรูปจาก Drive กลับเป็น Base64
// ใช้สำหรับ Video Template โหลดรูปโดยตรง
// ═══════════════════════════════════════════════════════════════
function proxyImage(params) {
  const fileId = params.fileId || params.id;
  if (!fileId) return { error: 'ต้องระบุ fileId' };

  try {
    const file     = DriveApp.getFileById(fileId);
    const blob     = file.getBlob();
    const b64      = Utilities.base64Encode(blob.getBytes());
    const mimeType = blob.getContentType() || 'image/jpeg';
    return { base64: 'data:' + mimeType + ';base64,' + b64 };
  } catch(e) {
    return { error: 'เปิดรูปไม่ได้ (fileId: ' + fileId + ') — ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// PROXY AUDIO — ส่งไฟล์เสียงจาก Drive กลับเป็น Base64
// ═══════════════════════════════════════════════════════════════
function proxyAudio(params) {
  const fileId = params.fileId || params.id;
  if (!fileId) return { error: 'ต้องระบุ fileId' };

  const MAX_BYTES = 15 * 1024 * 1024; // 15MB — เผื่อ Apps Script quota + JSON overhead

  try {
    const file = DriveApp.getFileById(fileId);
    const sizeBytes = file.getSize();

    if (sizeBytes > MAX_BYTES) {
      const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
      return {
        error: `ไฟล์ "${file.getName()}" ใหญ่เกินไป (${sizeMB} MB) — Apps Script รองรับได้สูงสุดประมาณ 15 MB\nกรุณาเลือกไฟล์เพลงสั้นลง (แนะนำไม่เกิน 3-5 นาที) หรือตัดคลิปให้สั้นก่อนอัปโหลดครับ`
      };
    }

    const blob     = file.getBlob();
    const b64      = Utilities.base64Encode(blob.getBytes());
    const mimeType = blob.getContentType() || 'audio/mpeg';

    return {
      base64:   'data:' + mimeType + ';base64,' + b64,
      mimeType: mimeType,
      name:     file.getName(),
      size:     blob.getBytes().length
    };
  } catch(e) {
    return { error: 'เปิดไฟล์เสียงไม่ได้ (fileId: ' + fileId + ') — ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// PROXY VIDEO — ส่งไฟล์ MP4 กลับเป็น Base64 (สำหรับ Download แบบ Blob)
// ทำให้ Browser รู้ขนาดไฟล์ชัดเจนตั้งแต่ต้น ไม่มีปัญหา Content-Length
// ที่เกิดจากการ Download ตรงจาก Drive
// ═══════════════════════════════════════════════════════════════
function proxyVideo(params) {
  const fileId = params.fileId || params.id;
  if (!fileId) return { error: 'ต้องระบุ fileId' };

  const MAX_BYTES = 20 * 1024 * 1024; // 20MB — วิดีโอสั้น 20-30 วิ ปกติไม่เกินนี้

  try {
    const file = DriveApp.getFileById(fileId);
    const sizeBytes = file.getSize();

    if (sizeBytes > MAX_BYTES) {
      const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
      return {
        error: `วิดีโอใหญ่เกินไป (${sizeMB} MB) — ใช้ปุ่ม "เปิด Drive" แล้วดาวน์โหลดจากหน้า Drive แทนครับ`,
        tooLarge: true,
        sizeMB: sizeMB
      };
    }

    const blob     = file.getBlob();
    const b64      = Utilities.base64Encode(blob.getBytes());
    const mimeType = blob.getContentType() || 'video/mp4';

    return {
      base64:   'data:' + mimeType + ';base64,' + b64,
      mimeType: mimeType,
      name:     file.getName(),
      size:     blob.getBytes().length
    };
  } catch(e) {
    return { error: 'เปิดไฟล์วิดีโอไม่ได้ (fileId: ' + fileId + ') — ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// FIND AUDIO BY PRODUCT — ค้นหาไฟล์เสียงจากชื่อสินค้า (Fallback)
// ═══════════════════════════════════════════════════════════════
function findAudioByProduct(params) {
  const productId = params.productId;
  const name      = params.name || '';

  const root = getOrCreateFolder(ROOT_FOLDER_NAME);
  const prodRoot = getOrCreateFolder('Products', root);
  const folderIter = prodRoot.getFolders();
  const nameSlug = sanitizeFileName(name).substring(0, 15).toLowerCase();

  let targetFolder = null;
  while (folderIter.hasNext()) {
    const f = folderIter.next();
    if (nameSlug && f.getName().toLowerCase().indexOf(nameSlug) >= 0) {
      targetFolder = f;
      break;
    }
  }

  if (!targetFolder) return { found: false, message: 'ไม่พบโฟลเดอร์สินค้านี้' };

  const fileIter = targetFolder.getFiles();
  const audioFiles = [];
  while (fileIter.hasNext()) {
    const file = fileIter.next();
    const fname = file.getName();
    if (/\.(mp3|wav|m4a|aac)$/i.test(fname) || file.getMimeType().indexOf('audio') >= 0) {
      audioFiles.push({ id: file.getId(), name: fname, createdTime: file.getDateCreated().toISOString() });
    }
  }

  if (!audioFiles.length) return { found: false, message: 'ไม่พบไฟล์เสียงในโฟลเดอร์นี้' };

  audioFiles.sort((a,b) => new Date(b.createdTime) - new Date(a.createdTime));
  return { found: true, file: audioFiles[0], allFiles: audioFiles };
}

// ═══════════════════════════════════════════════════════════════
// LIST DRIVE AUDIO — ดึงรายชื่อไฟล์เสียง (BGM) จากโฟลเดอร์ที่กำหนด
// เบากว่า proxyAudio เพราะไม่ส่ง Base64 มาด้วย (แค่ list ก่อน)
// ═══════════════════════════════════════════════════════════════
function listDriveAudio(params) {
  const folderId = params.folderId;
  if (!folderId) throw new Error('ต้องระบุ folderId');

  const MAX_BYTES = 15 * 1024 * 1024; // ต้องตรงกับ proxyAudio

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch(e) {
    throw new Error('เปิดโฟลเดอร์ BGM ไม่ได้ — ' + e.message);
  }

  const iter  = folder.getFiles();
  const files = [];

  while (iter.hasNext()) {
    const file = iter.next();
    const name = file.getName();
    if (!/\.(mp3|wav|m4a|aac|ogg)$/i.test(name)) continue;
    const sizeBytes = file.getSize();
    files.push({
      id:       file.getId(),
      name:     name.replace(/\.(mp3|wav|m4a|aac|ogg)$/i, ''),
      sizeKB:   Math.round(sizeBytes / 1024),
      sizeMB:   +(sizeBytes / 1024 / 1024).toFixed(1),
      tooLarge: sizeBytes > MAX_BYTES
    });
  }

  // เรียงไฟล์เล็กก่อน — ให้เจอไฟล์ที่ใช้ได้จริงง่ายขึ้น
  files.sort((a,b) => a.sizeKB - b.sizeKB);
  return { files: files, count: files.length };
}