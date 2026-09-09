// sidepanel.js v2.0 — BenGen Affiliate Side Panel

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let product      = null;
let settings     = {};
let settingsOpen = false;
let currentTab   = 'product';
let allImages    = []; // Base64 images ทั้งหมด

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
  ['product','script'].forEach(t => {
    $('tab-btn-' + t).classList.toggle('active', t === tab);
    $('tab-' + t).classList.toggle('active', t === tab);
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
      <img src="${src}" data-i="${i}" class="${i===0?'active':''}" title="${i===0?'รูปหลัก':'คลิกเลือก | Ctrl+คลิก Download'}">`
    ).join('');
    gallery.querySelectorAll('img').forEach((img, i) => {
      img.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) { downloadImg(allImages[i], `product-${i+1}.jpg`); return; }
        setMainImg(allImages[i]);
        gallery.querySelectorAll('img').forEach(im => im.classList.remove('active'));
        img.classList.add('active');
      });
    });
    $('btn-dl-all').style.display  = 'block';
    $('btn-dl-all').textContent    = `⬇️ Download รูปทั้งหมด (${allImages.length} ภาพ)`;
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
(โพสต์ + emoji + hashtag ภาษาไทย)

🎤 บทพากย์
(อ่านออกเสียง 25-30 วิ ภาษาไทยเป็นธรรมชาติ ไม่เป็นทางการ)`;

  const btn = $('btn-generate');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Gemini กำลังสร้าง...';
  setRow('gen-status', 'info', `กำลังใช้ ${model}...`);

  try {
    const res  = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.gemini}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:.85, maxOutputTokens:1400} }) }
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
  }

  btn.disabled = false; btn.innerHTML = '✨ สร้าง Content + บทพากย์';
}

function getModel() {
  const v = $('p-model').value;
  if (v === 'custom') return $('p-model-custom').value.trim() || settings.modelCustom || 'gemini-3.5-flash-lite';
  return v || settings.model || 'gemini-3.5-flash-lite';
}

// ═══════════════════════════════════════
// SAVE TO SHEETS + DRIVE
// ═══════════════════════════════════════
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
        // รูปภาพ — ส่งเป็น Base64 ให้ Apps Script upload ขึ้น Drive
        images:          allImages.filter(Boolean),
        imageCount:      allImages.length,
        // Content ที่ Generate แล้ว (ถ้ามี)
        hook:            $('out-hook').value    || '',
        script:          $('out-script').value  || '',
        caption:         $('out-caption').value || '',
        voiceScript:     $('out-voice').value   || '',
        savedAt:         new Date().toISOString(),
        status:          'new',
      }
    };

    const res = await fetch(settings.sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);

    setRow('save-status', 'ok',
      `✅ บันทึกลง Sheets แล้ว${json.driveFolder ? ` · Drive: ${json.driveFolder}` : ''}`
    );
    toast('✅ บันทึกสำเร็จ!');

  } catch (err) {
    setRow('save-status', 'err', '❌ ' + err.message);
    toast('❌ ' + err.message);
  }

  btn.disabled = false; btn.innerHTML = '💾 บันทึกลง Sheets + Drive';
}

// ═══════════════════════════════════════
// ELEVENLABS WEB (ไม่ใช้ API)
// ═══════════════════════════════════════
function openGoogleTTS() {
  const text = $('out-voice').value.trim();
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
  const text = $('out-voice').value.trim();
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
  if (!allImages.length) { toast('⚠️ ไม่มีรูป'); return; }
  const slug = (product?.name||'product').substring(0,15).replace(/[^ก-๙a-zA-Z0-9]/g,'-');
  toast(`⬇️ Download ${allImages.length} รูป...`);
  for (let i = 0; i < allImages.length; i++) {
    await sleep(300);
    downloadImg(allImages[i], `${slug}-${i+1}.jpg`);
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
