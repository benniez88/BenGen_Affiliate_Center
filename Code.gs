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
    'status','createdAt','updatedAt'
  ],
  CONTENT: [
    'id','productId','productName',
    'hook','script','caption','voiceScript',
    'voiceStatus','mp3DriveUrl',
    'videoStatus','mp4DriveUrl',
    'charCount','status','createdAt','updatedAt'
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
  };

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SN.PRODUCTS);
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
    status:      'new',
    createdAt:   now,
    updatedAt:   now,
  };

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SN.CONTENT);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SN.CONTENT);

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

  const headers = getSheetHeaders(sheet);
  const rowNum  = findRowById(sheet, id);
  if (rowNum < 0) throw new Error('ไม่พบ row id: ' + id);

  // Update field ที่ระบุ
  if (field) {
    const colIdx = headers.indexOf(field);
    if (colIdx >= 0) sheet.getRange(rowNum, colIdx + 1).setValue(value || '');
  }
  if (driveUrl) {
    // บันทึก URL ของไฟล์ที่ upload
    const urlField  = field === 'voiceStatus' ? 'mp3DriveUrl' : 'mp4DriveUrl';
    const urlColIdx = headers.indexOf(urlField);
    if (urlColIdx >= 0) sheet.getRange(rowNum, urlColIdx + 1).setValue(driveUrl);
  }

  // updatedAt
  const updatedIdx = headers.indexOf('updatedAt');
  if (updatedIdx >= 0) sheet.getRange(rowNum, updatedIdx + 1).setValue(new Date().toISOString());

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
      const data    = content.getDataRange().getValues();
      const headers = data[0];
      const pidIdx  = headers.indexOf('productId');
      const statIdx = headers.indexOf('videoStatus');
      const urlIdx  = headers.indexOf('mp4DriveUrl');
      const updIdx  = headers.indexOf('updatedAt');

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][pidIdx]) === String(productId)) {
          if (statIdx >= 0) content.getRange(i+1, statIdx+1).setValue('done');
          if (urlIdx  >= 0) content.getRange(i+1, urlIdx+1).setValue(directUrl);
          if (updIdx  >= 0) content.getRange(i+1, updIdx+1).setValue(new Date().toISOString());
          break;
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
// HELPERS
// ═══════════════════════════════════════════════════════════════
function findRowById(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function findByKey(sheet, key) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return i + 1;
  }
  return -1;
}

function getSheetHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}
