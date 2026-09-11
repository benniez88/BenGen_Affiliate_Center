// sidepanel.js v2.0 — BenGen Affiliate Side Panel

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let product      = null;
let settings     = {};
let settingsOpen = false;
let currentTab   = 'product';
let allImages    = []; // Base64 images ทั้งหมด
let imgSelected  = []; // เลือก/ไม่เลือก แต่ละรูป (true = จะถูก save)
let currentProductId = ''; // ได้จาก Apps Script หลัง saveProduct สำเร็จ
let currentContentId = ''; // ได้จาก Apps Script หลัง saveProduct สำเร็จ (ใช้ update voiceStatus)
let activeVoiceScript = ''; // บทพากย์ที่จะใช้ Generate เสียงจริง (session หรือจาก Sheets)
let loadedFromSheets  = false; // true = กำลังใช้ข้อมูลที่โหลดจาก Sheets แทน session ปัจจุบัน

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  bindEvents();
  await detectCurrentPage();

  // ฟัง message จาก background (affiliate link captured)
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'affiliateLinkCaptured' && msg.affiliateLink) {
      document.getElementById('p-link').value = msg.affiliateLink;
      toast('✅ Affiliate Link ได้แล้ว!');
    }
  });
});

// ═══════════════════════════════════════
// EVENT BINDING (ไม่มี inline handlers)
// ═══════════════════════════════════════
function bindEvents() {
  // Header
  $('btn-settings').addEventListener('click', toggleSettings);
  // Settings
  $('btn-save-settings').addEventListener('click', saveSettings);
  $('btn-close-settings').addEventListener('click', closeSettings);
  // Tabs
  $('tab-btn-product').addEventListener('click', () => switchTab('product'));
  $('tab-btn-script').addEventListener('click',  () => switchTab('script'));
  $('tab-btn-voice').addEventListener('click',   () => switchTab('voice'));
  // Product tab
  $('btn-fetch').addEventListener('click',         fetchProduct);
  $('btn-generate').addEventListener('click',      generateContent);
  $('btn-save').addEventListener('click',          saveToSheetsAndDrive);
  $('btn-get-link').addEventListener('click',      clickGetLink);
  $('btn-fetch-images').addEventListener('click',  fetchImagesFromProductPage);
  $('btn-dl-all').addEventListener('click',        downloadAllImages);
  // Script tab
  $('cp-hook').addEventListener('click',    () => copyText('out-hook',    'Hook'));
  $('cp-script').addEventListener('click',  () => copyText('out-script',  'Script'));
  $('cp-caption').addEventListener('click', () => copyText('out-caption', 'Caption'));
  $('cp-voice').addEventListener('click',   () => copyText('out-voice',   'บทพากย์'));
  $('btn-google-tts').addEventListener('click', openGoogleTTS);
  $('btn-browser-tts').addEventListener('click', browserTTS);
  $('btn-generate-voice').addEventListener('click', generateAndUploadVoice);
  $('btn-load-voice-list').addEventListener('click', loadVoicePendingList);
  $('btn-use-session').addEventListener('click', useSessionVoiceInstead);
  $('btn-select-all-voice').addEventListener('click', () => batchSelectAll(true));
  $('btn-select-none-voice').addEventListener('click', () => batchSelectAll(false));
  $('btn-start-batch').addEventListener('click', runVoiceBatch);
  $('btn-stop-batch').addEventListener('click', stopBatch);
  $('btn-regen').addEventListener('click',   reGenerate);
  // Dropdowns
  $('s-model').addEventListener('change', () => toggleCustom('s-model', 's-model-custom'));

  $('p-model').addEventListener('change', () => toggleCustom('p-model', 'p-model-custom'));
  // Voice char count
  $('out-voice').addEventListener('input', updateCharCount);
}

function $(id) { return document.getElementById(id); }

function toggleCustom(selId, inputId) {
  const v = $(selId).value;
  $(inputId).style.display = v === 'custom' ? 'block' : 'none';
}

// ═══════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════
async function loadSettings() {
  const d  = await chrome.storage.local.get('bengen_v2');
  settings = d.bengen_v2 || {};
  const s  = settings;

  const set = (id, v) => { if (v && $(id)) $(id).value = v; };
  set('s-gemini',      s.gemini);
  set('s-model',       s.model);
  set('s-model-custom',s.modelCustom);

  set('s-sheets',      s.sheetsUrl);

  if (s.model === 'custom') $('s-model-custom').style.display = 'block';


  // Sync p-model
  if (s.model) {
    const pm = $('p-model');
    const found = [...pm.options].find(o => o.value === s.model);
    if (found) pm.value = s.model;
    else { pm.value = 'custom'; $('p-model-custom').value = s.model; $('p-model-custom').style.display='block'; }
  }
}

async function saveSettings() {
  settings = {
    gemini:      $('s-gemini').value.trim(),
    model:       $('s-model').value,
    modelCustom: $('s-model-custom').value.trim(),

    sheetsUrl:   $('s-sheets').value.trim(),
  };
  await chrome.storage.local.set({ bengen_v2: settings });
  toast('✅ บันทึก Settings แล้ว');
  closeSettings();
}

function toggleSettings() { settingsOpen ? closeSettings() : openSettings(); }

function openSettings() {
  settingsOpen = true;
  $('settings-panel').style.display = 'flex';
  $('main-tabs').style.display       = 'none';
  document.querySelector('.scroll').style.display = 'none';
}

function closeSettings() {
  settingsOpen = false;
  $('settings-panel').style.display = 'none';
  $('main-tabs').style.display       = 'flex';
  document.querySelector('.scroll').style.display = 'block';
}

// ═══════════════════════════════════════
// TAB SWITCH
// ═══════════════════════════════════════
function switchTab(tab) {
  currentTab = tab;
  ['product','script','voice'].forEach(t => {
    $('tab-btn-' + t).classList.toggle('active', t === tab);
    $('tab-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'voice') syncVoicePreview();
}

function syncVoicePreview() {
  // ถ้ากำลังใช้ข้อมูลที่โหลดจาก Sheets อยู่ ไม่ต้อง overwrite ด้วย session ปัจจุบัน
  if (loadedFromSheets) { renderVoicePreview(); return; }

  activeVoiceScript = $('out-voice')?.value || '';
  renderVoicePreview();
}

function renderVoicePreview() {
  const text = activeVoiceScript || '';
  const preview = $('voice-script-preview');
  if (preview) preview.textContent = text || '—';
  const chars2 = $('voice-chars-2');
  if (chars2) chars2.textContent = `${text.length.toLocaleString()} / 10,000 chars`;

  const hasScript = !!text.trim();
  $('voice-empty').style.display  = hasScript ? 'none' : 'block';
  $('voice-output').style.display = hasScript ? 'flex' : 'none';
}

// ═══════════════════════════════════════
// VOICE TAB — โหลดรายการจาก Sheets (ทำงานอิสระจาก Session)
// ═══════════════════════════════════════
let voicePendingRows = []; // เก็บรายการล่าสุดไว้ใช้กับ Batch

// รายชื่อ Model TTS ที่รองรับ — แต่ละตัวมีโควต้าแยกกัน
const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
let exhaustedModels = new Set(); // Model ที่รู้แล้วว่าติด Limit ต่อเนื่อง (reset ตอน reload extension)

async function loadVoicePendingList() {
  if (!settings.sheetsUrl) { toast('⚠️ ตั้งค่า Apps Script URL ใน ⚙️ ก่อนครับ'); return; }

  const btn = $('btn-load-voice-list');
  btn.innerHTML = '<span class="spin"></span>';
  btn.disabled  = true;
  setVoiceListStatus('info', 'กำลังโหลดรายการจาก Sheets...');
  $('batch-controls').style.display = 'none';
  $('batch-summary').style.display  = 'none';

  try {
    const res  = await fetchWithTimeout(`${settings.sheetsUrl}?action=read&sheet=Content`, {}, 30000);
    const data = await res.json();
    const rows = (data.rows || []).filter(r =>
      r.voiceScript && r.voiceScript.trim() && r.voiceStatus !== 'done'
    );

    if (!rows.length) {
      setVoiceListStatus('warn', '⚠️ ไม่พบรายการที่รอสร้างเสียง (voiceStatus ≠ done)');
      $('voice-pick-list').style.display = 'none';
      return;
    }

    rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    voicePendingRows = rows;

    const listEl = $('voice-pick-list');
    listEl.style.display = 'flex';
    listEl.innerHTML = rows.map((r, i) => `
      <div class="voice-pick-item" data-i="${i}" style="padding:9px 10px;background:var(--bg3);
        border-radius:8px;border:1px solid var(--border);display:flex;align-items:flex-start;gap:8px;">
        <input type="checkbox" class="batch-check" data-i="${i}" style="margin-top:2px;flex-shrink:0;">
        <div style="flex:1;cursor:pointer;" data-select-i="${i}">
          <div style="font-size:12px;font-weight:700;margin-bottom:2px;">${escapeHtmlV(r.productName || r.productId)}</div>
          <div style="font-size:10px;color:var(--text2);">${(r.voiceScript||'').length} chars · ${r.createdAt ? new Date(r.createdAt).toLocaleDateString('th-TH') : ''}</div>
        </div>
      </div>`
    ).join('');

    // คลิกที่ตัวข้อความ → เลือกแบบเดี่ยว (behavior เดิม)
    listEl.querySelectorAll('[data-select-i]').forEach(el => {
      const i = parseInt(el.dataset.selectI);
      el.addEventListener('click', () => selectVoiceItem(rows[i], el.closest('.voice-pick-item'), listEl));
    });

    // ติ๊ก Checkbox → เข้าโหมด Batch selection
    listEl.querySelectorAll('.batch-check').forEach(cb => {
      cb.addEventListener('change', updateBatchSelectedCount);
    });

    setVoiceListStatus('ok', `✅ พบ ${rows.length} รายการที่รอสร้างเสียง`);
    $('batch-controls').style.display = 'block'; // โชว์ปุ่ม "เลือกทั้งหมด" ทันที ไม่ต้องรอติ๊กก่อน
    updateBatchSelectedCount();

  } catch (err) {
    setVoiceListStatus('err', '❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.innerHTML = '🔄 โหลดรายการ';
  }
}

function selectVoiceItem(row, el, listEl) {
  listEl.querySelectorAll('.voice-pick-item').forEach(x => x.style.borderColor = 'var(--border)');
  if (el) el.style.borderColor = 'var(--pn)';

  currentProductId  = row.productId || '';
  currentContentId  = row.id || '';
  activeVoiceScript = row.voiceScript || '';
  loadedFromSheets  = true;

  $('active-voice-label').style.display = 'block';
  $('active-voice-name').textContent    = row.productName || row.productId || '—';

  renderVoicePreview();
  toast('✅ เลือก "' + (row.productName || row.productId) + '" แล้ว');
}

function useSessionVoiceInstead() {
  loadedFromSheets = false;
  $('active-voice-label').style.display = 'none';
  syncVoicePreview();
  toast('🔄 กลับไปใช้บทพากย์จาก Content Tab แล้ว');
}

function setVoiceListStatus(type, msg) {
  const el = $('voice-list-status');
  const cls = { info:'row-info', ok:'row-ok', err:'row-err', warn:'row-warn' };
  el.className = cls[type] || 'row-info';
  el.style.display = 'flex';
  el.innerHTML = `<span></span><span>${msg}</span>`;
}

function escapeHtmlV(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ═══════════════════════════════════════
// BATCH VOICE GENERATOR — ปลอดภัยจาก Rate Limit
// ═══════════════════════════════════════
let batchRunning = false;
let batchStopRequested = false;

function updateBatchSelectedCount() {
  const checked = document.querySelectorAll('.batch-check:checked').length;
  $('batch-selected-count').textContent = checked;
  $('btn-start-batch').disabled = checked === 0;

  // เตือนถ้าเลือกเยอะเกินไป — RPD (Requests/Day) ของ Free Tier อาจต่ำสุดแค่ 100 ครั้ง/วัน
  const warnEl = $('batch-rpd-warning');
  if (checked > 50) {
    warnEl.style.display = 'flex';
    warnEl.innerHTML = `<span>⚠️</span><span>เลือก ${checked} รายการ — Free Tier บางบัญชีมีโควต้าแค่ 100-500 ครั้ง/วัน ถ้าทำสินค้าอื่นมาแล้วในวันนี้ อาจไม่พอ ลองแบ่งทำหลายรอบครับ</span>`;
  } else {
    warnEl.style.display = 'none';
  }
}

function getBatchSelectedRows() {
  const boxes = document.querySelectorAll('.batch-check:checked');
  return Array.from(boxes).map(cb => voicePendingRows[parseInt(cb.dataset.i)]);
}

function batchSelectAll(select) {
  document.querySelectorAll('.batch-check').forEach(cb => cb.checked = select);
  updateBatchSelectedCount();
}

// สร้างเสียง + Upload ให้ 1 รายการ — คืนค่า {success, error, directUrl}
// ไม่พึ่ง UI state กลาง (activeVoiceScript ฯลฯ) เพื่อให้ Batch เรียกซ้ำได้ปลอดภัย
async function generateVoiceForRow(row, modelOverride) {
  const text = (row.voiceScript || '').trim();
  if (!text) return { success: false, error: 'ไม่มีบทพากย์' };

  const voiceName = $('tts-voice').value;
  const model     = modelOverride || $('tts-model').value;

  try {
    const pcmBase64 = await callGeminiTTS(text, voiceName, settings.gemini, model);
    const wavBlob   = pcmToWavBlob(pcmBase64);
    const wavDataUrl = await blobToDataUrl(wavBlob);

    const res = await fetchWithTimeout(settings.sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'uploadAudio',
        productId: row.productId,
        contentId: row.id,
        audioBase64: wavDataUrl,
        fileName: 'voiceover-' + Date.now() + '.wav',
      })
    }, 45000);

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) return { success: false, error: json.error || `HTTP ${res.status}`, model };

    return { success: true, directUrl: json.directUrl, model };

  } catch (err) {
    // เช็คจาก HTTP Status Code จริงก่อน (แม่นสุด) — Fallback เป็นข้อความถ้าไม่มี (เช่น error จาก Apps Script)
    const isRateLimit = err.httpStatus === 429 || /429|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(err.message);

    // Google บอกเวลาที่ต้องรอมาให้ตรงๆ ใน error message เช่น "Please retry in 10.64s"
    // แม่นยำกว่าการเดา — ใช้ค่านี้แทนถ้ามี
    let retryAfterSec = null;
    const retryMatch = err.message.match(/retry in\s*([\d.]+)\s*s/i);
    if (retryMatch) retryAfterSec = Math.ceil(parseFloat(retryMatch[1]));

    return { success: false, error: err.message, isRateLimit, retryAfterSec, model };
  }
}

async function runVoiceBatch() {
  const rows = getBatchSelectedRows();
  if (!rows.length) { toast('⚠️ เลือกอย่างน้อย 1 รายการก่อนครับ'); return; }
  if (!settings.gemini)   { toast('⚠️ ตั้งค่า Gemini API Key ก่อนครับ'); return; }
  if (!settings.sheetsUrl){ toast('⚠️ ตั้งค่า Apps Script URL ก่อนครับ'); return; }

  batchRunning = true;
  batchStopRequested = false;

  $('batch-controls').style.display  = 'none';
  $('batch-progress').style.display  = 'block';
  $('batch-summary').style.display   = 'none';
  $('batch-item-log').innerHTML      = '';

  // ล็อกปุ่มอื่นที่จะยิง Gemini TTS ซ้อนกันได้ — กันชน Rate Limit โดยไม่ตั้งใจ
  $('btn-load-voice-list').disabled  = true;
  $('btn-generate-voice').disabled   = true;

  const delayMs = parseInt($('batch-delay').value) || 20000;
  const results = { success: [], failed: [] };

  for (let i = 0; i < rows.length; i++) {
    if (batchStopRequested) break;
    const row  = rows[i];
    const name = row.productName || row.productId || `รายการที่ ${i+1}`;

    updateBatchProgress(i, rows.length, `กำลังทำ ${i+1}/${rows.length}: ${name}`);
    addBatchLog(name, 'loading', 'กำลัง Generate...');

    let result;
    const maxRetries = 2; // ต่อ Model
    let usedModel = $('tts-model').value;

    // ลำดับ Model ที่จะลอง — เริ่มจากที่เลือกไว้ ตามด้วยตัวสำรอง
    const modelQueue = [usedModel, ...TTS_MODELS.filter(m => m !== usedModel)];

    outer:
    for (const model of modelQueue) {
      if (exhaustedModels.has(model)) continue; // ข้าม Model ที่รู้แล้วว่าหมดโควต้าวันนี้

      let attempt = 0;
      while (attempt <= maxRetries) {
        result = await generateVoiceForRow(row, model);
        usedModel = model;
        if (result.success) break outer;

        if (result.isRateLimit && attempt < maxRetries) {
          // ใช้เวลาที่ Google บอกมาตรงๆ (แม่นยำกว่า) ถ้ามี ไม่งั้น fallback เป็น escalating wait
          const waitSec = result.retryAfterSec
            ? result.retryAfterSec + 2 // เผื่อ buffer นิดหน่อยกันชนเวลาเป๊ะๆ
            : 30 + attempt * 20;
          addBatchLog(name, 'warn', `[${model}] โดน Limit — รอ ${waitSec} วิ ก่อนลองใหม่ (ครั้งที่ ${attempt+1}/${maxRetries})`);
          await countdownWait(waitSec, (left) => {
            updateBatchProgress(i, rows.length, `รอ Limit: ${name} (เหลือ ${left} วิ)`);
          });
          attempt++;
          continue;
        }

        if (result.isRateLimit) {
          // Retry ครบแล้วยัง Limit อยู่ — ถือว่า Model นี้ใช้ไม่ได้ตอนนี้ (ไม่ว่าจะเป็น Limit รายนาทีหรือรายวัน)
          // จำไว้กันเสียเวลาลองซ้ำอีกในรอบ Batch นี้ แล้วลอง Model ถัดไปในคิว
          exhaustedModels.add(model);
          addBatchLog(name, 'warn', `⛽ "${model}" ยังติด Limit หลัง Retry ครบแล้ว — ลองสลับ Model`);
          break; // ออกจาก while ไปลอง model ถัดไปใน for
        }

        break; // error อื่นๆ ที่ไม่ใช่ Rate Limit — ไม่ retry ไม่สลับ model จบเลย
      }

      // ถ้า error ไม่ใช่ rate limit เลย ไม่ต้องลอง model ถัดไปต่อ (คงเป็น error เดิม)
      if (result && !result.success && !result.isRateLimit) break;
    }

    if (result.success) {
      results.success.push(name);
      updateBatchLog(name, 'ok', `✅ สำเร็จ (${usedModel})`);
    } else {
      results.failed.push({ name, error: result.error });
      updateBatchLog(name, 'err', '❌ ' + result.error);

      // ถ้า Model ทุกตัวที่มีหมดโควต้าหมดแล้ว ไม่มีประโยชน์จะทำรายการถัดไปต่อ — หยุด Batch เลย
      if (TTS_MODELS.every(m => exhaustedModels.has(m))) {
        addBatchLog('⛔ ระบบ', 'err', 'ติด Limit ครบทุก Model TTS แล้ว — หยุด Batch ทันที ลองใหม่ภายหลังครับ');
        batchStopRequested = true;
        break;
      }
    }

    // หน่วงเวลาก่อนตัวถัดไป (ยกเว้นตัวสุดท้าย หรือถ้าถูกสั่งหยุด)
    if (i < rows.length - 1 && !batchStopRequested) {
      const waitSec = Math.round(delayMs / 1000);
      await countdownWait(waitSec, (left) => {
        updateBatchProgress(i, rows.length, `พักก่อนตัวถัดไป... (${left} วิ)`);
      });
    }
  }

  batchRunning = false;
  $('btn-load-voice-list').disabled = false;
  $('btn-generate-voice').disabled  = false;
  showBatchSummary(results, batchStopRequested);
}

function stopBatch() {
  batchStopRequested = true;
  toast('⏹️ กำลังหยุด Batch หลังจบรายการปัจจุบัน...');
}

function updateBatchProgress(i, total, text) {
  $('batch-progress-text').textContent = text;
  $('batch-progress-bar').style.width  = Math.round((i / total) * 100) + '%';
}

function addBatchLog(name, type, msg) {
  const colors = { loading:'var(--text2)', ok:'var(--green)', err:'var(--red)', warn:'var(--amber)' };
  const row = document.createElement('div');
  row.dataset.name = name;
  row.style.cssText = `padding:5px 8px;background:var(--bg3);border-radius:5px;color:${colors[type]};`;
  row.textContent = `${escapeHtmlV(name)} — ${msg}`;
  $('batch-item-log').appendChild(row);
  $('batch-item-log').scrollTop = $('batch-item-log').scrollHeight;
}

function updateBatchLog(name, type, msg) {
  const colors = { loading:'var(--text2)', ok:'var(--green)', err:'var(--red)', warn:'var(--amber)' };
  const rows = $('batch-item-log').querySelectorAll(`[data-name="${CSS.escape(name)}"]`);
  const row  = rows[rows.length - 1];
  if (row) {
    row.style.color = colors[type];
    row.textContent = `${name} — ${msg}`;
  } else {
    addBatchLog(name, type, msg);
  }
}

function showBatchSummary(results, wasStopped) {
  $('batch-progress').style.display = 'none';
  const el = $('batch-summary');
  el.style.display = 'block';

  const total = results.success.length + results.failed.length;
  const type  = results.failed.length === 0 ? 'ok' : (results.success.length === 0 ? 'err' : 'warn');
  const cls   = { ok:'row-ok', err:'row-err', warn:'row-warn' }[type];

  let html = `<div class="${cls}" style="flex-direction:column;align-items:flex-start;gap:6px;">`;
  html += `<div>${wasStopped ? '⏹️ หยุด Batch แล้ว' : '🏁 Batch เสร็จสิ้น'} — สำเร็จ ${results.success.length}/${total} รายการ</div>`;
  if (results.failed.length) {
    html += `<div style="font-size:11px;">รายการที่พลาด:<br>` +
      results.failed.map(f => `• ${escapeHtmlV(f.name)}: ${escapeHtmlV(f.error)}`).join('<br>') +
      `</div>`;
  }
  html += `</div>`;
  el.innerHTML = html;

  toast(wasStopped ? '⏹️ หยุด Batch แล้ว' : `🏁 Batch เสร็จ — สำเร็จ ${results.success.length}/${total}`);

  // Refresh รายการ (รายการที่สำเร็จจะหายไปเพราะ voiceStatus=done แล้ว)
  loadVoicePendingList();
}

// นับถอยหลังพร้อม callback อัปเดต UI ทุกวินาที
function countdownWait(totalSec, onTick) {
  return new Promise(resolve => {
    let left = totalSec;
    onTick(left);
    const timer = setInterval(() => {
      left--;
      if (batchStopRequested) { clearInterval(timer); resolve(); return; }
      if (left <= 0) { clearInterval(timer); resolve(); return; }
      onTick(left);
    }, 1000);
  });
}

// ═══════════════════════════════════════
// DETECT PAGE MODE
// ═══════════════════════════════════════
async function detectCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    updateMode(tab?.url || '');
  } catch { updateMode(''); }
}

function updateMode(url) {
  const dot    = $('dot');
  const badge  = $('mode-badge');
  const status = $('hdr-status');

  if (url.includes('affiliate.shopee.co.th')) {
    dot.className   = 'dot ok';
    badge.className = 'hdr-mode mode-affiliate';
    badge.textContent = 'Affiliate';
    status.textContent = 'Affiliate Dashboard';
  } else if (url.includes('shopee.co.th')) {
    dot.className   = 'dot ok';
    badge.className = 'hdr-mode mode-shopee';
    badge.textContent = 'Shopee';
    status.textContent = 'หน้าสินค้า Shopee';
  } else {
    dot.className   = 'dot err';
    badge.className = 'hdr-mode mode-none';
    badge.textContent = '—';
    status.textContent = 'เปิด Shopee ก่อนครับ';
  }
}

// ═══════════════════════════════════════
// FETCH PRODUCT
// ═══════════════════════════════════════
async function fetchProduct() {
  const btn = $('btn-fetch');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> กำลังดึงข้อมูล...';
  setRow('fetch-status', 'info', 'กำลังอ่านข้อมูลจากหน้า Shopee...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    updateMode(tab?.url || '');

    if (!tab?.url?.includes('shopee.co.th')) {
      throw new Error('เปิดหน้า Affiliate Dashboard หรือหน้าสินค้า Shopee ก่อนครับ');
    }

    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await sleep(600);
      result = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
    }

    if (!result)      throw new Error('ไม่ได้รับข้อมูล — Reload หน้า Shopee แล้วลองใหม่');
    if (result.error) throw new Error(result.error);

    product   = result;
    allImages = [product.imageUrl, ...(product.extraImages || [])].filter(Boolean);
    imgSelected = allImages.map(() => true);

    renderProduct(product);
    setRow('fetch-status', 'ok', `✅ ดึงข้อมูลสำเร็จ (${result.source})`);
    $('btn-generate').style.display = 'flex';
    $('btn-save').style.display     = 'flex';

  } catch (err) {
    setRow('fetch-status', 'err', '❌ ' + err.message);
  }

  btn.disabled = false;
  btn.innerHTML = '🔍 ดึงข้อมูลสินค้า';
}

function renderProduct(p) {
  $('empty-state').style.display   = 'none';
  $('product-info').style.display  = 'flex';

  // รูปหลัก
  const wrap = $('img-wrap');
  if (p.imageUrl) {
    wrap.innerHTML = `<img src="${p.imageUrl}" id="main-img" title="คลิก Download">`;
    $('main-img').addEventListener('click', () => downloadImg(p.imageUrl, 'product-main.jpg'));
  }

  // Gallery
  const gallery = $('gallery');
  if (allImages.length > 1) {
    gallery.style.display = 'flex';
    gallery.innerHTML = allImages.map((src, i) => `
      <div class="thumb-item" data-i="${i}" style="position:relative;flex-shrink:0;">
        <img src="${src}" data-i="${i}" class="${i===0?'active':''}"
          style="opacity:${imgSelected[i]===false?'0.3':'1'};"
          title="${i===0?'รูปหลัก':'คลิกเลือก | Ctrl+คลิก Download'}">
        <button class="thumb-remove" data-i="${i}" title="${imgSelected[i]===false?'กดเพื่อใช้รูปนี้':'กดเพื่อไม่ใช้รูปนี้'}"
          style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;
          background:${imgSelected[i]===false?'var(--green)':'var(--red)'};color:#fff;border:none;
          font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
          font-weight:700;">${imgSelected[i]===false?'+':'×'}</button>
      </div>`
    ).join('');

    gallery.querySelectorAll('img[data-i]').forEach((img, i) => {
      img.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) { downloadImg(allImages[i], `product-${i+1}.jpg`); return; }
        setMainImg(allImages[i]);
        gallery.querySelectorAll('img[data-i]').forEach(im => im.classList.remove('active'));
        img.classList.add('active');
      });
    });

    gallery.querySelectorAll('.thumb-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const i = parseInt(btn.dataset.i);
        imgSelected[i] = !imgSelected[i];
        renderProduct(product);
      });
    });

    const selCount = imgSelected.filter(Boolean).length;
    $('btn-dl-all').style.display  = 'block';
    $('btn-dl-all').textContent    = `⬇️ Download รูปที่เลือก (${selCount}/${allImages.length} ภาพ)`;
  } else {
    gallery.style.display         = 'none';
    $('btn-dl-all').style.display = 'none';
  }

  // ข้อมูล
  $('p-name').textContent = p.name || '—';
  $('p-shop').textContent = p.shop
    ? `🏪 ${p.shop}${p.shopType==='mall'?' · Mall':p.shopType==='preferred'?' · Pref':''}`
    : '';

  const badges = [];
  if (p.shopType==='mall')      badges.push(`<span class="badge b-mall">🏬 Mall</span>`);
  if (p.shopType==='preferred') badges.push(`<span class="badge b-pref">⭐ Pref</span>`);
  if (p.rating)   badges.push(`<span class="badge b-star">⭐ ${p.rating} (${fmt(p.ratingCount)})</span>`);
  if (p.sales)    badges.push(`<span class="badge b-sold">📦 ${fmt(p.sales)}</span>`);
  if (p.discount) badges.push(`<span class="badge b-disc">🔥 -${p.discount}%</span>`);
  if (p.commission) badges.push(`<span class="badge b-comm">💰 ${p.commission}%</span>`);
  $('p-badges').innerHTML = badges.join('');

  $('p-sale').textContent = p.sale ? `฿${p.sale.toLocaleString()}` : '—';
  $('p-orig').textContent = (p.price > p.sale) ? `฿${p.price.toLocaleString()}` : '';

  // Fill form
  if (p.commission)       $('p-commission').value      = p.commission;
  if (p.commissionBaht)   $('p-commission-bath').value = p.commissionBaht;
  if (p.affiliateLink)    $('p-link').value             = p.affiliateLink;
  if (p.productUrl)       $('p-product-url').value      = p.productUrl;
}

function setMainImg(src) {
  const img = $('main-img');
  if (img) img.src = src;
  if (product) product.imageUrl = src;
}

// ═══════════════════════════════════════
// FETCH IMAGES จาก shopee.co.th (via tab)
// ═══════════════════════════════════════
async function fetchImagesFromProductPage() {
  const url = $('p-product-url').value.trim();
  if (!url) { toast('⚠️ กรอก Product URL ก่อนครับ'); return; }

  const btn = $('btn-fetch-images');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  setRow('fetch-status', 'info', 'กำลังเปิดหน้าสินค้าเพื่อดึงรูป...');

  try {
    // เปิด Tab ชั่วคราว
    const tab = await chrome.tabs.create({ url, active: false });
    await sleep(3000); // รอหน้าโหลด

    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await sleep(1000);
      result = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
    }

    await chrome.tabs.remove(tab.id); // ปิด Tab

    if (result?.error) throw new Error(result.error);
    if (!result) throw new Error('ไม่ได้รับข้อมูล');

    // Merge รูปใหม่เข้า product
    const newImgs = [result.imageUrl, ...(result.extraImages||[])].filter(Boolean);
    allImages = [...new Set([...allImages, ...newImgs])];
    // เพิ่ม selected = true ให้รูปใหม่ที่เพิ่มเข้ามา (คงค่าเดิมของรูปที่มีอยู่แล้ว)
    while (imgSelected.length < allImages.length) imgSelected.push(true);

    if (!product) product = result;
    else {
      product.extraImages = allImages.slice(1);
      product.imageUrls   = result.imageUrls || [];
      if (!product.description && result.description) product.description = result.description;
    }

    // Re-render gallery
    renderProduct(product);
    setRow('fetch-status', 'ok', `✅ ดึงรูปสำเร็จ — ${allImages.length} ภาพ`);
    toast(`✅ ได้รูป ${allImages.length} ภาพ`);

  } catch (err) {
    setRow('fetch-status', 'err', '❌ ' + err.message);
    toast('❌ ' + err.message);
  }

  btn.disabled = false; btn.textContent = 'ดึงรูป';
}

// ═══════════════════════════════════════
// GET AFFILIATE LINK
// ═══════════════════════════════════════
async function clickGetLink() {
  const btn = $('btn-get-link');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('affiliate.shopee')) throw new Error('ต้องอยู่ในหน้า Affiliate Dashboard');

    const result = await chrome.tabs.sendMessage(tab.id, { action: 'clickGetLink' });
    if (result?.error)    throw new Error(result.error);
    if (result?.affiliateLink) {
      $('p-link').value = result.affiliateLink;
      toast('✅ ได้ Affiliate Link แล้ว!');
    }
  } catch (err) {
    toast('⚠️ ' + err.message);
  }

  btn.disabled = false; btn.textContent = 'เอาลิงก์';
}

// ═══════════════════════════════════════
// GENERATE CONTENT (GEMINI)
// ═══════════════════════════════════════
async function generateContent() {
  if (!product)         { toast('⚠️ ดึงข้อมูลสินค้าก่อนครับ'); return; }
  if (!settings.gemini) { toast('⚠️ ตั้งค่า Gemini API Key ใน ⚙️ ก่อน'); return; }

  const model      = getModel();
  const tone       = $('p-tone').value;
  const platform   = $('p-platform').value;
  const commission = $('p-commission').value;
  const commBaht   = $('p-commission-bath').value;

  const tones = { review:'รีวิวจริงใจน่าเชื่อถือ', promo:'โปรโมชั่นสร้าง Urgency', lifestyle:'Lifestyle เป็นธรรมชาติ' };
  const plats = { reels:'Shopee Video/Reels 25-30 วิ', facebook:'Facebook Page', both:'Reels + Facebook' };

  const prompt = `คุณเป็น Content Creator Affiliate มือโปรในไทย

สินค้า: ${product.name}
ราคา: ฿${product.price?.toLocaleString()||'-'} → ฿${product.sale?.toLocaleString()||'-'}${product.discount>0?` (ลด ${product.discount}%)`:''}
ร้าน: ${product.shop||'-'}${product.shopType==='mall'?' (Shopee Mall)':product.shopType==='preferred'?' (Preferred)':''}
Rating: ${product.rating||'-'} / ${fmt(product.ratingCount)} รีวิว | ขายแล้ว ${fmt(product.sales)} ชิ้น
${commission?`Commission: ${commission}% (ประมาณ ฿${commBaht||'-'} ต่อออเดอร์)`:''}
รายละเอียด: ${(product.description||'').substring(0,300)}
Platform: ${plats[platform]}
สไตล์: ${tones[tone]}

สร้างครบ 4 ส่วน (ใช้ Emoji นำหน้าตามนี้):

🎯 HOOK
(1 บรรทัด ดึงใจใน 3 วิแรก)

🎬 SCRIPT
(แบ่ง timestamp ชัดเจน รวม 25-30 วิ)

📝 CAPTION
(ข้อความโพสต์ + hashtag ภาษาไทย รวมกันทั้งหมดต้องไม่เกิน 150 ตัวอักษร นับรวม hashtag และ emoji ด้วย กระชับ ตรงประเด็น)

🎤 บทพากย์
(อ่านออกเสียง 25-30 วิ ภาษาไทยเป็นธรรมชาติ ไม่เป็นทางการ)`;

  const btn = $('btn-generate');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Gemini กำลังสร้าง...';
  setRow('gen-status', 'info', `กำลังใช้ ${model}...`);

  try {
    const res  = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.gemini}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:.85, maxOutputTokens:1400} }) },
      30000,
      'Gemini API'
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

    const out = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!out)  throw new Error('Gemini ไม่ส่งข้อมูลกลับ');

    const get = (em, nxt) => (out.match(new RegExp(em+'\\s*[^\\n]*\\n([\\s\\S]*?)(?='+nxt+'|$)','i'))?.[1]||'').trim();
    $('out-hook').value    = get('🎯','🎬');
    $('out-script').value  = get('🎬','📝');
    $('out-caption').value = get('📝','🎤');
    $('out-voice').value   = get('🎤','\\$\\$\\$');

    $('script-empty').style.display  = 'none';
    $('script-output').style.display = 'flex';

    updateCharCount();
    setRow('gen-status', 'ok', `✅ Generate ด้วย ${model} เสร็จแล้ว`);
    switchTab('script');
    toast('✅ สร้าง Content เสร็จแล้ว!');

  } catch (err) {
    setRow('gen-status', 'err', '❌ ' + err.message);
    toast('❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.innerHTML = '✨ สร้าง Content + บทพากย์';
  }
}

function getModel() {
  const v = $('p-model').value;
  if (v === 'custom') return $('p-model-custom').value.trim() || settings.modelCustom || 'gemini-3.5-flash-lite';
  return v || settings.model || 'gemini-3.5-flash-lite';
}

// ═══════════════════════════════════════
// SAVE TO SHEETS + DRIVE
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// FETCH WITH TIMEOUT — กัน Spinner ค้างตลอดไป
// ถ้าไม่ตอบกลับภายในเวลาที่กำหนด จะ Abort แล้วแจ้งเตือน
// (งานฝั่ง Server อาจสำเร็จแล้วจริงๆ แค่ Response ไม่กลับมาถึง)
// ═══════════════════════════════════════
async function fetchWithTimeout(url, options, timeoutMs = 45000, serviceName = 'Apps Script') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(
        `หมดเวลารอ (${Math.round(timeoutMs/1000)} วิ) — ${serviceName} อาจทำงานเสร็จแล้วจริงๆ ` +
        `แค่ตอบกลับมาช้าเกินไป ${serviceName === 'Apps Script' ? 'ลองเช็ค Sheets/Drive ดูก่อนนะครับ ถ้ายังไม่มีข้อมูลค่อยลองกดใหม่' : 'ลองกดใหม่อีกครั้งครับ'}`
      );
    }
    throw err;
  }
}

async function saveToSheetsAndDrive() {
  if (!product)           { toast('⚠️ ดึงข้อมูลสินค้าก่อนครับ'); return; }
  if (!settings.sheetsUrl){ toast('⚠️ ตั้งค่า Apps Script URL ใน ⚙️ ก่อน'); return; }

  const btn = $('btn-save');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> กำลังบันทึก...';
  setRow('save-status', 'info', 'กำลังส่งข้อมูลขึ้น Sheets + Drive...');

  try {
    const payload = {
      action: 'saveProduct',
      data: {
        id:              Date.now().toString(),
        name:            product.name,
        price:           product.price,
        priceSale:       product.sale,
        discount:        product.discount,
        commissionRate:  $('p-commission').value,
        commissionBaht:  $('p-commission-bath').value,
        affiliateLink:   $('p-link').value,
        productUrl:      $('p-product-url').value,
        shopName:        product.shop,
        shopType:        product.shopType,
        rating:          product.rating,
        ratingCount:     product.ratingCount,
        sales:           product.sales,
        description:     product.description || '',
        // รูปภาพ — ส่งเฉพาะรูปที่เลือกไว้ (imgSelected) ให้ Apps Script upload ขึ้น Drive
        images:          allImages.filter((img, i) => img && imgSelected[i] !== false),
        imageCount:      allImages.filter((img, i) => img && imgSelected[i] !== false).length,
        // Content ที่ Generate แล้ว (ถ้ามี)
        hook:            $('out-hook').value    || '',
        script:          $('out-script').value  || '',
        caption:         $('out-caption').value || '',
        voiceScript:     $('out-voice').value   || '',
        savedAt:         new Date().toISOString(),
        status:          'new',
      }
    };

    const res = await fetchWithTimeout(settings.sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 60000); // upload รูปหลายรูปอาจใช้เวลานาน ให้ 60 วิ

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);

    // เก็บ productId/contentId ไว้ใช้ตอน Generate เสียง
    currentProductId = json.productId || payload.data.id;
    currentContentId = json.contentId || '';

    setRow('save-status', 'ok',
      `✅ บันทึกลง Sheets แล้ว${json.driveFolder ? ` · Drive: ${json.driveFolder}` : ''}`
    );
    toast('✅ บันทึกสำเร็จ!');

  } catch (err) {
    setRow('save-status', 'err', '❌ ' + err.message);
    toast('❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.innerHTML = '💾 บันทึกลง Sheets + Drive';
  }
}

// ═══════════════════════════════════════
// AUTO TTS — เรียก Gemini TTS API ตรงๆ + Upload Drive ในคลิกเดียว
// ═══════════════════════════════════════
async function generateAndUploadVoice() {
  const text = (activeVoiceScript || '').trim();
  if (!text) { toast('⚠️ ยังไม่มีบทพากย์ — Generate Content หรือโหลดจาก Sheets ก่อนครับ'); return; }
  if (!settings.gemini) { toast('⚠️ ตั้งค่า Gemini API Key ใน ⚙️ ก่อนครับ'); return; }
  if (!settings.sheetsUrl) { toast('⚠️ ตั้งค่า Apps Script URL ใน ⚙️ ก่อนครับ'); return; }
  if (!currentProductId) { toast('⚠️ ยังไม่มีสินค้าที่เลือก — บันทึกสินค้าก่อน หรือโหลดจาก Sheets ก่อนครับ'); return; }

  const btn = $('btn-generate-voice');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> กำลัง Generate เสียง...';
  setTTSStatus('info', 'กำลังเรียก Gemini TTS API...');

  try {
    const voiceName = $('tts-voice').value;
    const model     = $('tts-model').value;
    const pcmBase64 = await callGeminiTTS(text, voiceName, settings.gemini, model);

    setTTSStatus('info', 'ได้เสียงแล้ว — กำลังแปลงเป็น WAV...');
    const wavBlob = pcmToWavBlob(pcmBase64);

    const player = $('tts-preview');
    player.src = URL.createObjectURL(wavBlob);
    player.style.display = 'block';

    setTTSStatus('info', 'กำลัง Upload ขึ้น Drive...');
    const wavDataUrl = await blobToDataUrl(wavBlob);

    const res = await fetchWithTimeout(settings.sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'uploadAudio',
        productId: currentProductId,
        contentId: currentContentId,
        audioBase64: wavDataUrl,
        fileName: 'voiceover-' + Date.now() + '.wav',
      })
    }, 45000);

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);

    setTTSStatus('ok', `✅ Generate + Upload สำเร็จ! เสียง: ${voiceName}${json.directUrl ? ` · <a href="${json.directUrl}" target="_blank" style="color:var(--pn);">เปิดใน Drive</a>` : ''}`);
    toast('✅ เสียงพร้อมแล้ว! Upload ขึ้น Drive เรียบร้อย');

  } catch (err) {
    setTTSStatus('err', '❌ ' + err.message);
    toast('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🎙️ Generate + Upload ขึ้น Drive';
  }
}

// เรียก Gemini TTS API โดยตรง — ได้ PCM base64 กลับมา (24kHz, 16-bit, mono)
async function callGeminiTTS(text, voiceName, apiKey, model) {
  model = model || 'gemini-3.1-flash-tts-preview';
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } }
          }
        }
      })
    },
    // Audio generation ใช้เวลานานกว่า Text ธรรมดามาก — โดยเฉพาะ Preview model
    // ตั้ง Timeout ให้กว้างพอ (75 วิ) ไม่ให้ตัดกลางคันตอนกำลังสร้างเสียงอยู่จริงๆ
    75000,
    'Gemini TTS API'
  );

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    err.httpStatus = res.status; // เก็บ Status Code จริงไว้ — เช็คแม่นกว่าเดาจากข้อความ
    throw err;
  }

  const part = data.candidates?.[0]?.content?.parts?.[0];
  const inlineData = part?.inlineData || part?.inline_data;
  if (!inlineData?.data) throw new Error('Gemini ไม่ส่งข้อมูลเสียงกลับมา (ลองเปลี่ยนเสียงหรือบทพากย์)');

  return inlineData.data; // base64 PCM
}

// แปลง PCM (raw, ไม่มี header) → WAV Blob ที่เล่นได้ทันที
function pcmToWavBlob(base64Pcm, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const binary = atob(base64Pcm);
  const len = binary.length;
  const pcmBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) pcmBytes[i] = binary.charCodeAt(i);

  const byteRate   = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize   = pcmBytes.length;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view   = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcmBytes);

  return new Blob([buffer], { type: 'audio/wav' });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function setTTSStatus(type, msg) {
  const el = $('tts-status');
  const cls = { info:'row-info', ok:'row-ok', err:'row-err', warn:'row-warn' };
  el.className = cls[type] || 'row-info';
  el.style.display = 'flex';
  el.innerHTML = `<span></span><span>${msg}</span>`;
}

// ═══════════════════════════════════════
// ELEVENLABS WEB (ไม่ใช้ API)
// ═══════════════════════════════════════
function openGoogleTTS() {
  const text = (activeVoiceScript || $('out-voice').value || '').trim();
  if (!text) { toast('⚠️ ยังไม่มีบทพากย์ — Generate ก่อนครับ'); return; }

  navigator.clipboard.writeText(text)
    .then(() => {
      chrome.tabs.create({
        url: 'https://aistudio.google.com/generate-speech?model=gemini-3.1-flash-tts-preview'
      });
      toast('📋 Copy บทพากย์แล้ว — วางใน AI Studio แล้วกด Generate ได้เลย!');
    })
    .catch(() => {
      // clipboard ไม่ได้รับอนุญาต — เปิด tab พร้อมแจ้งให้ copy เอง
      chrome.tabs.create({
        url: 'https://aistudio.google.com/generate-speech?model=gemini-3.1-flash-tts-preview'
      });
      toast('⚠️ กรุณา Copy บทพากย์จาก Tab "Content" ไปวางใน AI Studio ครับ');
    });
}

// ═══════════════════════════════════════
// BROWSER TTS
// ═══════════════════════════════════════
function browserTTS() {
  const text = (activeVoiceScript || $('out-voice').value || '').trim();
  if (!text) { toast('⚠️ ยังไม่มีบทพากย์'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang  = 'th-TH'; u.rate = 0.95;
  const th = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('th'));
  if (th) u.voice = th;
  window.speechSynthesis.speak(u);
  toast('🔊 กำลังอ่านบทพากย์...');
}

// ═══════════════════════════════════════
// RE-GENERATE
// ═══════════════════════════════════════
async function reGenerate() {
  switchTab('product');
  await generateContent();
}

// ═══════════════════════════════════════
// CHAR COUNT
// ═══════════════════════════════════════
function updateCharCount() {
  const len = $('out-voice').value.length;
  const el  = $('voice-chars');
  el.textContent = `${len.toLocaleString()} / 10,000 chars`;
  el.className   = 'char-count' + (len > 10000 ? ' over' : len > 8000 ? ' warn' : '');
}

// ═══════════════════════════════════════
// IMAGE HELPERS
// ═══════════════════════════════════════
function downloadImg(src, name) {
  const a = document.createElement('a');
  a.href = src; a.download = name || 'shopee.jpg'; a.click();
  toast(`⬇️ Download ${name}`);
}

async function downloadAllImages() {
  const selectedImgs = allImages.filter((img, i) => img && imgSelected[i] !== false);
  if (!selectedImgs.length) { toast('⚠️ ไม่มีรูปที่เลือกไว้'); return; }
  const slug = (product?.name||'product').substring(0,15).replace(/[^ก-๙a-zA-Z0-9]/g,'-');
  toast(`⬇️ Download ${selectedImgs.length} รูป...`);
  for (let i = 0; i < selectedImgs.length; i++) {
    await sleep(300);
    downloadImg(selectedImgs[i], `${slug}-${i+1}.jpg`);
  }
}

// ═══════════════════════════════════════
// COPY
// ═══════════════════════════════════════
function copyText(id, label) {
  const v = $(id)?.value?.trim();
  if (!v) { toast('⚠️ ไม่มีข้อความ'); return; }
  navigator.clipboard.writeText(v);
  toast(`📋 Copy ${label} แล้ว`);
}

// ═══════════════════════════════════════
// STATUS ROW
// ═══════════════════════════════════════
function setRow(id, type, msg) {
  const el  = $(id);
  if (!el) return;
  const cls = { info:'row-info', ok:'row-ok', err:'row-err', warn:'row-warn' };
  el.className     = cls[type] || 'row-info';
  el.style.display = 'flex';
  el.innerHTML     = `<span></span><span>${msg}</span>`;
}

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════
function fmt(n) {
  if (!n) return '0';
  n = parseInt(n);
  return n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toast(msg, d=3000) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(window._t);
  window._t = setTimeout(() => el.classList.remove('show'), d);
}
