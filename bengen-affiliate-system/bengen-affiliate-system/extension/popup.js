// popup.js — BenGen Affiliate Extension

// ═══════════════════════════════════
// STATE
// ═══════════════════════════════════
let product  = null;
let settings = {};
let currentTab = 'product';
let settingsOpen = false;

// ═══════════════════════════════════
// INIT
// ═══════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  await checkCurrentTab();
});

function setupEventListeners() {
  // ── Header ──
  document.getElementById('settings-btn').addEventListener('click', toggleSettings);

  // ── Settings panel ──
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('close-settings-btn').addEventListener('click', closeSettings);

  // ── Tabs ──
  document.getElementById('tab-btn-product').addEventListener('click', () => switchTab('product'));
  document.getElementById('tab-btn-script').addEventListener('click',  () => switchTab('script'));

  // ── Product tab ──
  document.getElementById('fetch-btn').addEventListener('click', fetchProduct);
  document.getElementById('gen-btn').addEventListener('click',   generateScript);

  // ── Copy buttons ──
  document.getElementById('copy-hook-btn').addEventListener('click',    () => copyText('out-hook',    'Hook'));
  document.getElementById('copy-script-btn').addEventListener('click',  () => copyText('out-script',  'Script'));
  document.getElementById('copy-caption-btn').addEventListener('click', () => copyText('out-caption', 'Caption'));
  document.getElementById('copy-voice-btn').addEventListener('click',   () => copyText('out-voice',   'บทพากย์'));

  // ── TTS ──
  document.getElementById('browser-tts-btn').addEventListener('click', browserTTS);
  document.getElementById('eleven-btn').addEventListener('click',      elevenLabsTTS);

  // ── Actions ──
  document.getElementById('ai-studio-btn').addEventListener('click',     openAIStudio);
  document.getElementById('video-template-btn').addEventListener('click', openVideoTemplate);
  document.getElementById('save-btn').addEventListener('click',           saveToSheets);
  document.getElementById('regen-btn').addEventListener('click',          reGenerate);

  // ── Dropdowns ──
  document.getElementById('s-model').addEventListener('change', function() {
    document.getElementById('s-model-custom').style.display =
      this.value === 'custom' ? 'block' : 'none';
  });
  document.getElementById('s-voice').addEventListener('change', function() {
    document.getElementById('s-voice-custom').style.display =
      this.value === 'custom' ? 'block' : 'none';
  });
  document.getElementById('p-model').addEventListener('change', function() {
    document.getElementById('p-model-custom').style.display =
      this.value === 'custom' ? 'block' : 'none';
  });
}

// ═══════════════════════════════════
// SETTINGS
// ═══════════════════════════════════
async function loadSettings() {
  const data = await chrome.storage.local.get('bengen_settings');
  settings   = data.bengen_settings || {};

  const set = (id, val) => {
    if (val !== undefined && val !== null && val !== '') {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
  };

  set('s-gemini',       settings.gemini);
  set('s-model',        settings.model);
  set('s-model-custom', settings.modelCustom);
  set('s-eleven',       settings.eleven);
  set('s-voice',        settings.voice);
  set('s-voice-custom', settings.voiceCustom);
  set('s-sheets',       settings.sheets);

  if (settings.model === 'custom')
    document.getElementById('s-model-custom').style.display = 'block';
  if (settings.voice === 'custom')
    document.getElementById('s-voice-custom').style.display = 'block';
  if (!settings.gemini)
    document.getElementById('no-key-warn').style.display = 'flex';

  // sync p-model dropdown
  if (settings.model) {
    const pm = document.getElementById('p-model');
    if (pm) {
      const found = [...pm.options].find(o => o.value === settings.model);
      if (found) pm.value = settings.model;
      if (settings.model === 'custom' && settings.modelCustom) {
        document.getElementById('p-model-custom').value = settings.modelCustom;
        document.getElementById('p-model-custom').style.display = 'block';
      }
    }
  }
}

async function saveSettings() {
  const model = document.getElementById('s-model').value;
  const voice = document.getElementById('s-voice').value;

  settings = {
    gemini:      document.getElementById('s-gemini').value.trim(),
    model,
    modelCustom: document.getElementById('s-model-custom').value.trim(),
    eleven:      document.getElementById('s-eleven').value.trim(),
    voice,
    voiceCustom: document.getElementById('s-voice-custom').value.trim(),
    sheets:      document.getElementById('s-sheets').value.trim(),
  };

  await chrome.storage.local.set({ bengen_settings: settings });

  // Sync p-model
  const pm = document.getElementById('p-model');
  if (pm && settings.model) {
    const found = [...pm.options].find(o => o.value === settings.model);
    if (found) {
      pm.value = settings.model;
    } else {
      // Custom model ที่ไม่มีใน dropdown
      pm.value = 'custom';
      document.getElementById('p-model-custom').value = settings.model;
      document.getElementById('p-model-custom').style.display = 'block';
    }
  }

  if (settings.gemini)
    document.getElementById('no-key-warn').style.display = 'none';

  toast('✅ บันทึก Settings แล้ว');
  closeSettings();
}

function openSettings() {
  settingsOpen = true;
  document.getElementById('settings-panel').style.display = 'flex';
  document.getElementById('main-tabs').style.display      = 'none';
  document.getElementById('tab-product').style.display    = 'none';
  document.getElementById('tab-script').style.display     = 'none';
}

function closeSettings() {
  settingsOpen = false;
  document.getElementById('settings-panel').style.display = 'none';
  document.getElementById('main-tabs').style.display      = 'flex';
  // Re-show active tab
  document.getElementById('tab-' + currentTab).style.display = 'block';
  document.getElementById('tab-' + currentTab).classList.add('active');
}

function toggleSettings() {
  if (settingsOpen) {
    closeSettings();
  } else {
    openSettings();
  }
}

// ═══════════════════════════════════
// TAB SWITCH
// ═══════════════════════════════════
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const activeTabEl = document.querySelector(`.tab[onclick="switchTab('${tab}')"]`);
  if (activeTabEl) activeTabEl.classList.add('active');
  const panel = document.getElementById('tab-' + tab);
  if (panel) {
    panel.classList.add('active');
    panel.style.display = 'block';
  }
}

// ═══════════════════════════════════
// CHECK CURRENT TAB
// ═══════════════════════════════════
async function checkCurrentTab() {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('shopee.co.th')) {
      dot.className   = 'status-dot error';
      txt.textContent = 'เปิดหน้าสินค้า Shopee ก่อน';
      setStatus('warn', '⚠️ เปิดหน้าสินค้า Shopee แล้วกดดึงข้อมูลครับ');
      return;
    }

    dot.className   = 'status-dot ok';
    txt.textContent = 'Shopee พร้อมแล้ว';
  } catch (e) {
    dot.className   = 'status-dot loading';
    txt.textContent = 'กำลังตรวจสอบ...';
  }
}

// ═══════════════════════════════════
// FETCH PRODUCT
// ═══════════════════════════════════
async function fetchProduct() {
  const btn = document.getElementById('fetch-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> กำลังดึงข้อมูล...';
  setStatus('loading', 'กำลังอ่านข้อมูลจากหน้า Shopee...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('shopee.co.th')) {
      throw new Error('เปิดหน้าสินค้า Shopee ก่อนครับ');
    }

    // ส่ง message ไปยัง content.js
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { action: 'getProduct' });
    } catch (e) {
      // content script อาจยังไม่ inject — inject ใหม่
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files:  ['content.js']
      });
      await new Promise(r => setTimeout(r, 500));
      result = await chrome.tabs.sendMessage(tab.id, { action: 'getProduct' });
    }

    if (!result)        throw new Error('ไม่ได้รับข้อมูล — Reload หน้า Shopee แล้วลองใหม่');
    if (result.error)   throw new Error(result.error);

    product = result;
    renderProduct(product);
    setStatus('success', '✅ ดึงข้อมูลสำเร็จ' + (result.source === 'dom' ? ' (DOM)' : ''));
    document.getElementById('gen-btn').style.display = 'flex';

  } catch (err) {
    setStatus('error', '❌ ' + err.message);
  }

  btn.disabled = false;
  btn.innerHTML = '🔍 ดึงข้อมูลสินค้า';
}

function renderProduct(p) {
  document.getElementById('empty-state').style.display  = 'none';
  document.getElementById('product-info').style.display = 'block';

  // รูปภาพหลัก
  const imgWrap = document.getElementById('img-wrap');
  if (p.imageUrl) {
    imgWrap.innerHTML = '';
    imgWrap.className = '';
    imgWrap.style.cssText = 'width:72px;height:72px;border-radius:7px;overflow:hidden;flex-shrink:0;';
    imgWrap.innerHTML = `<img src="${p.imageUrl}" style="width:100%;height:100%;object-fit:cover;"
      onerror="this.parentElement.innerHTML='🛍️'">`;
  }

  // Extra images
  const extraEl = document.getElementById('extra-imgs');
  if (p.extraImages?.length > 1) {
    extraEl.innerHTML = p.extraImages.slice(1, 5).map(u =>
      `<img src="${u}" style="width:36px;height:36px;object-fit:cover;border-radius:5px;
        cursor:pointer;border:1px solid var(--border);"
        onclick="setMainImg('${u}')" onerror="this.style.display='none'">`
    ).join('');
  }

  document.getElementById('p-name').textContent = p.name || '—';
  document.getElementById('p-shop').textContent = p.shop
    ? `🏪 ${p.shop}${p.shopType==='mall'?' · Mall':p.shopType==='preferred'?' · Preferred':''}`
    : '';

  // Badges
  const badges = [];
  if (p.shopType === 'mall')      badges.push(`<span class="badge badge-mall">🏬 Mall</span>`);
  if (p.shopType === 'preferred') badges.push(`<span class="badge badge-pref">⭐ Pref</span>`);
  if (p.rating)   badges.push(`<span class="badge badge-star">⭐ ${p.rating} (${fmt(p.ratingCount)})</span>`);
  if (p.sales)    badges.push(`<span class="badge badge-sold">📦 ${fmt(p.sales)}</span>`);
  if (p.discount) badges.push(`<span class="badge badge-discount">🔥 -${p.discount}%</span>`);
  document.getElementById('p-badges').innerHTML = badges.join('');

  document.getElementById('p-sale').textContent =
    p.sale ? `฿${p.sale.toLocaleString()}` : '—';
  document.getElementById('p-orig').textContent =
    (p.price > p.sale) ? `฿${p.price.toLocaleString()}` : '';

  // Auto-fill affiliate link
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.url) document.getElementById('p-link').value = tabs[0].url;
  });
}

function setMainImg(url) {
  const el = document.querySelector('#img-wrap img');
  if (el) el.src = url;
  if (product) product.imageUrl = url;
}

function fmt(n) {
  if (!n) return '0';
  n = parseInt(n);
  return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
}

// ═══════════════════════════════════
// GET ACTIVE MODEL
// ═══════════════════════════════════
function getActiveModel() {
  const sel = document.getElementById('p-model').value;
  if (sel === 'custom') {
    const custom = document.getElementById('p-model-custom').value.trim();
    return custom || settings.modelCustom || 'gemini-3.5-flash-lite';
  }
  return sel || settings.model || 'gemini-3.5-flash-lite';
}

// ═══════════════════════════════════
// GENERATE SCRIPT
// ═══════════════════════════════════
async function generateScript() {
  if (!product)       { toast('⚠️ ดึงข้อมูลสินค้าก่อนครับ'); return; }
  if (!settings.gemini) { toast('⚠️ ตั้งค่า Gemini API Key ใน ⚙️ ก่อนครับ'); return; }

  const model      = getActiveModel();
  const tone       = document.getElementById('p-tone').value;
  const platform   = document.getElementById('p-platform').value;
  const commission = document.getElementById('p-commission').value;

  const toneMap = {
    review:    'รีวิวสินค้าจริงใจ น่าเชื่อถือ',
    promo:     'โปรโมชั่น สร้าง Urgency',
    lifestyle: 'Lifestyle เป็นธรรมชาติ',
  };
  const platMap = {
    reels:    'Shopee Video/Reels (25-30 วิ)',
    facebook: 'Facebook Page',
    both:     'Reels + Facebook',
  };

  const prompt =
`คุณเป็น Content Creator Affiliate มือโปรในไทย

สินค้า: ${product.name}
ราคา: ฿${product.price?.toLocaleString()||'-'} → ฿${product.sale?.toLocaleString()||'-'}${product.discount > 0 ? ` (ลด ${product.discount}%)` : ''}
ร้าน: ${product.shop||'-'}${product.shopType==='mall' ? ' (Shopee Mall)' : product.shopType==='preferred' ? ' (Preferred)' : ''}
Rating: ${product.rating||'-'} / ${fmt(product.ratingCount)} รีวิว | ขายแล้ว ${fmt(product.sales)} ชิ้น
รายละเอียด: ${(product.description||'').substring(0,250)}
${commission ? `Commission: ${commission}%` : ''}
Platform: ${platMap[platform]}
สไตล์: ${toneMap[tone]}

สร้างครบ 4 ส่วน (ใช้ Emoji นำหน้าตามนี้เท่านั้น):

🎯 HOOK
(1 บรรทัด ดึงใจใน 3 วิแรก)

🎬 SCRIPT
(แบ่ง timestamp ชัดเจน รวม 25-30 วิ)

📝 CAPTION
(โพสต์ + emoji + hashtag)

🎤 บทพากย์
(อ่านออกเสียง 25-30 วิ ภาษาไทยเป็นธรรมชาติ)`;

  const genBtn = document.getElementById('gen-btn');
  genBtn.disabled = true;
  genBtn.innerHTML = '<span class="loading"></span> กำลัง Generate...';
  setGenStatus('loading', `กำลังใช้ ${model}...`);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.gemini}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 1400 },
        }),
      }
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

    const out = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!out) throw new Error('Gemini ไม่ส่งข้อมูลกลับ');

    // แยกแต่ละส่วน
    const get = (emoji, next) => {
      const rx = new RegExp(emoji + '\\s*[^\\n]*\\n([\\s\\S]*?)(?=' + next + '|$)', 'i');
      return (out.match(rx)?.[1] || '').trim();
    };

    document.getElementById('out-hook').value    = get('🎯', '🎬');
    document.getElementById('out-script').value  = get('🎬', '📝');
    document.getElementById('out-caption').value = get('📝', '🎤');
    document.getElementById('out-voice').value   = get('🎤', '$$$');

    document.getElementById('script-empty').style.display  = 'none';
    document.getElementById('script-output').style.display = 'block';

    setGenStatus('success', `✅ Generate ด้วย ${model} เสร็จแล้ว`);
    await saveForTemplate();
    switchTab('script');
    toast('✅ สร้างบทพากย์เสร็จแล้ว!');

  } catch (err) {
    setGenStatus('error', '❌ ' + err.message);
    toast('❌ ' + err.message);
  }

  genBtn.disabled = false;
  genBtn.innerHTML = '✨ Generate บทพากย์';
}

async function saveForTemplate() {
  if (!product) return;
  const d = {
    name: product.name, price: product.price, sale: product.sale,
    discount: product.discount, imageUrl: product.imageUrl,
    extraImages: product.extraImages || [], shop: product.shop,
    rating: product.rating, sales: product.sales,
    link:    document.getElementById('p-link').value,
    hook:    document.getElementById('out-hook').value,
    voice:   document.getElementById('out-voice').value,
    caption: document.getElementById('out-caption').value,
    script:  document.getElementById('out-script').value,
  };
  await chrome.storage.local.set({ vg_product: JSON.stringify(d) });
  localStorage.setItem('vg_product', JSON.stringify(d));
}

async function reGenerate() {
  switchTab('product');
  await generateScript();
}

// ═══════════════════════════════════
// BROWSER TTS
// ═══════════════════════════════════
function browserTTS() {
  const text = document.getElementById('out-voice').value.trim();
  if (!text) { toast('⚠️ ยังไม่มีบทพากย์'); return; }
  window.speechSynthesis.cancel();
  const u  = new SpeechSynthesisUtterance(text);
  u.lang   = 'th-TH';
  u.rate   = 0.95;
  const th = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('th'));
  if (th) u.voice = th;
  window.speechSynthesis.speak(u);
  toast('🔊 กำลังอ่านบทพากย์...');
}

// ═══════════════════════════════════
// ELEVENLABS TTS
// ═══════════════════════════════════
async function elevenLabsTTS() {
  if (!settings.eleven) {
    toast('⚠️ ใส่ ElevenLabs API Key ใน ⚙️ ก่อนครับ');
    return;
  }
  const text = document.getElementById('out-voice').value.trim();
  if (!text) { toast('⚠️ ยังไม่มีบทพากย์'); return; }

  const voiceId = settings.voice === 'custom'
    ? (settings.voiceCustom || 'ThT5KcBeYPX3keUQqHPh')
    : (settings.voice || 'ThT5KcBeYPX3keUQqHPh');

  const btn = document.getElementById('eleven-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> กำลังสร้างเสียง...';
  setElevenStatus('loading', 'กำลังเรียก ElevenLabs...');

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': settings.eleven },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
        }),
      }
    );

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.detail?.message || `ElevenLabs HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);

    const player = document.getElementById('voice-player');
    player.src   = url;
    player.style.display = 'block';
    player.play();

    // Auto download
    const a  = document.createElement('a');
    a.href   = url;
    a.download = `voiceover-${Date.now()}.mp3`;
    a.click();

    setElevenStatus('success', '✅ Download MP3 แล้ว — กด Play เพื่อฟัง');
    toast('✅ ElevenLabs TTS เสร็จ + Download แล้ว!');

  } catch (err) {
    setElevenStatus('error', '❌ ' + err.message);
    toast('❌ ' + err.message);
  }

  btn.disabled = false;
  btn.innerHTML = '🎙️ ElevenLabs TTS + Download MP3';
}

// ═══════════════════════════════════
// ACTIONS
// ═══════════════════════════════════
function openAIStudio() {
  const text = document.getElementById('out-voice').value.trim();
  if (text) navigator.clipboard.writeText(text);
  chrome.tabs.create({ url: 'https://aistudio.google.com/app/speech' });
  toast('📋 Copy บทพากย์แล้ว — เปิด AI Studio');
}

function openVideoTemplate() {
  saveForTemplate();
  chrome.tabs.create({ url: chrome.runtime.getURL('bengen-template.html') });
}

async function saveToSheets() {
  if (!settings.sheets) { toast('⚠️ ตั้งค่า Sheets URL ใน ⚙️ ก่อน'); return; }
  if (!product)         { toast('⚠️ ไม่มีข้อมูลสินค้า'); return; }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> กำลังบันทึก...';

  try {
    const res = await fetch(settings.sheets, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write', sheet: 'Products',
        data: {
          id: Date.now().toString(),
          name: product.name, price: product.price,
          priceSale: product.sale,
          commissionRate: document.getElementById('p-commission').value,
          affiliateLink:  document.getElementById('p-link').value,
          shopName: product.shop, rating: product.rating,
          sales: product.sales, imageUrl: product.imageUrl,
          savedAt: new Date().toISOString(),
        },
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    toast('✅ บันทึกลง Sheets แล้ว!');
  } catch (err) {
    toast('❌ ' + err.message);
  }

  btn.disabled = false;
  btn.innerHTML = '🔖 บันทึกลง Sheets';
}

function copyText(id, label) {
  const el = document.getElementById(id);
  if (!el?.value?.trim()) { toast('⚠️ ไม่มีข้อความ'); return; }
  navigator.clipboard.writeText(el.value.trim());
  toast(`📋 Copy ${label} แล้ว`);
}

// ═══════════════════════════════════
// STATUS HELPERS
// ═══════════════════════════════════
function setStatus(type, msg) {
  _setRow('fetch-status', type, msg);
}
function setGenStatus(type, msg) {
  _setRow('gen-status', type, msg);
}
function setElevenStatus(type, msg) {
  _setRow('eleven-status', type, msg);
}
function _setRow(id, type, msg) {
  const el  = document.getElementById(id);
  if (!el) return;
  const cls = { loading:'info-row', success:'success-row', error:'error-row', warn:'warn-row' };
  el.className     = cls[type] || 'info-row';
  el.style.display = 'flex';
  el.innerHTML     = `<span></span><span>${msg}</span>`;
}

// ═══════════════════════════════════
// TOAST
// ═══════════════════════════════════
function toast(msg, d = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window._toast);
  window._toast = setTimeout(() => el.classList.remove('show'), d);
}
