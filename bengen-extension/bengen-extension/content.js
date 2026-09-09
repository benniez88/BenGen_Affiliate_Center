// content.js v2.1 — affiliate.shopee.co.th + shopee.co.th
(function () {
  'use strict';

  const IS_AFFILIATE = location.hostname === 'affiliate.shopee.co.th';
  const IS_SHOPEE    = location.hostname === 'shopee.co.th';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'getPageInfo') {
      getPageInfo().then(sendResponse).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'clickGetLink') {
      clickAffiliateButton().then(sendResponse).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'ping') {
      sendResponse({ ok: true, mode: IS_AFFILIATE ? 'affiliate' : IS_SHOPEE ? 'shopee' : 'other', url: location.href });
    }
  });

  async function getPageInfo() {
    if (IS_AFFILIATE) return await getAffiliateInfo();
    if (IS_SHOPEE)    return await getShopeeProductInfo();
    throw new Error('ไม่รองรับหน้านี้');
  }

  // ═══ MODE A: affiliate.shopee.co.th ═══
  async function getAffiliateInfo() {
    const url = location.href;
    if (url.includes('/offer/product_offer/') || url.match(/product_offer_id/)) {
      return await scrapeAffiliateDetail();
    }
    if (url.includes('/offer/product_offer')) {
      return await scrapeAffiliateList();
    }
    throw new Error('เปิดหน้า "ข้อเสนอผลิตภัณฑ์" ใน Affiliate Dashboard ก่อนครับ');
  }

  async function scrapeAffiliateList() {
    const cards = document.querySelectorAll('[class*="product-item"],[class*="offer-item"],[class*="product-card"]');
    if (!cards.length) throw new Error('ไม่พบสินค้า — กดสินค้าเพื่อเปิดหน้า Detail ก่อนครับ');
    const card   = cards[0];
    const name   = card.querySelector('[class*="name"],[class*="title"]')?.textContent?.trim() || '';
    const price  = parsePrice(card.querySelector('[class*="price"]')?.textContent || '');
    const comm   = parseCommission(card.querySelector('[class*="commission"],[class*="comm"]')?.textContent || '');
    const imgUrl = card.querySelector('img')?.src || '';
    const images = imgUrl ? await fetchBase64([imgUrl]) : [];
    return {
      mode:'affiliate-list', name, price, sale:price, discount:0,
      commission:comm, commissionBaht:0, shop:'', shopType:'normal',
      imageUrl:images[0]||'', extraImages:[], imageUrls:imgUrl?[imgUrl]:[],
      rating:0, ratingCount:0, sales:0,
      affiliateLink:'', productUrl:card.querySelector('a[href*="shopee.co.th"]')?.href||'',
      source:'affiliate-list'
    };
  }

  async function scrapeAffiliateDetail() {
    // รอหน้าโหลดเสร็จ
    await waitFor('table tr td', 4000).catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    // ── ชื่อสินค้า ──────────────────────────────────────────────
    // DOM จริง: <div class="name">ชื่อสินค้า</div>
    let name = '';

    // วิธี 1: class="name" ตรงๆ (จาก DOM จริงที่ส่งมา)
    const nameEl = document.querySelector('div.name, span.name, p.name');
    if (nameEl) name = nameEl.textContent.trim();

    // วิธี 2: page title
    if (!name) {
      const t = document.title.replace(/\s*\|\s*Shopee.*/i, '').trim();
      if (t && t.length > 3 && !t.includes('ข้อเสนอ') && !t.includes('Affiliate')) {
        name = t;
      }
    }

    // วิธี 3: หาจาก section product detail
    if (!name) {
      const detailSection = document.querySelector(
        '[class*="product-detail"],[class*="offer-detail"],[class*="detail-info"]'
      );
      if (detailSection) {
        const candidates = detailSection.querySelectorAll('span,div,p');
        for (const el of candidates) {
          if (el.children.length > 0) continue;
          const txt = el.textContent.trim();
          if (txt.length > 5 && !/^[฿\d%]/.test(txt) && !txt.includes('ดูรายละเอียด')) {
            name = txt; break;
          }
        }
      }
    }

    // ── ราคา ────────────────────────────────────────────────────
    // ราคาอยู่ใน section detail ข้างรูป — หาจาก element ที่มี ฿
    let price = 0;
    const priceSection = document.querySelector('[class*="product-detail"],[class*="offer-detail"],[class*="detail-info"]');
    const priceTarget  = priceSection || document.body;

    priceTarget.querySelectorAll('[class*="price"],[class*="amount"],[class*="cost"]').forEach(el => {
      // ข้าม element ที่เป็น commission table
      if (el.closest('table')) return;
      const n = parsePrice(el.textContent);
      if (n > 0 && (!price || n < price)) price = n;
    });

    // Fallback: หา element ที่มี ฿ อยู่ใน text
    if (!price) {
      const allEls = (priceSection || document.body).querySelectorAll('*');
      for (const el of allEls) {
        if (el.children.length > 0) continue; // leaf node เท่านั้น
        if (el.closest('table')) continue;
        const t = el.textContent.trim();
        if (t.includes('฿') || t.includes('บาท')) {
          const n = parsePrice(t);
          if (n > 0 && (!price || n < price)) { price = n; break; }
        }
      }
    }

    // ── Commission จากตาราง ──────────────────────────────────────
    // ตาราง: ประเภทช่องทาง | ExtraComm | ค่าคอมปีนี้ | ค่าคอมโดยประมาณ
    let commission = 0, commissionBaht = 0;
    const tableRows = document.querySelectorAll('table tr');
    tableRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) return;

      // % จาก ExtraComm column (cell index 1)
      const pct = cells[1]?.textContent?.match(/([\d.]+)\s*%/);
      if (pct && !commission) commission = parseFloat(pct[1]);

      // บาทจาก column สุดท้าย (ค่าคอมโดยประมาณ)
      const lastCell = cells[cells.length - 1]?.textContent || '';
      const bath = parsePrice(lastCell);
      if (bath > 0 && !commissionBaht) commissionBaht = bath;
    });

    // ── รูปภาพ ───────────────────────────────────────────────────
    // รูปอยู่ใน section ด้านซ้ายของ detail page
    const imgSelectors = [
      '[class*="product-image"] img',
      '[class*="preview-image"] img',
      '[class*="offer-image"] img',
      '[class*="product-img"] img',
      '[class*="main-image"] img',
    ];
    let imgUrl = '';
    for (const sel of imgSelectors) {
      const el = document.querySelector(sel);
      if (el?.src && !el.src.includes('avatar') && !el.src.includes('icon')) {
        imgUrl = el.src; break;
      }
    }
    // Fallback: หา img ที่ใหญ่ที่สุดในหน้า (ไม่ใช่ icon)
    if (!imgUrl) {
      let bestImg = null, bestArea = 0;
      document.querySelectorAll('img').forEach(img => {
        if (!img.src || img.src.includes('avatar') || img.src.includes('icon')) return;
        const area = img.naturalWidth * img.naturalHeight || img.width * img.height;
        if (area > bestArea) { bestArea = area; bestImg = img; }
      });
      if (bestImg) imgUrl = bestImg.src;
    }

    const images = imgUrl ? await fetchBase64([imgUrl]) : [];

    // ── Rating / ยอดขาย ──────────────────────────────────────────
    // หาจาก text ที่มี "ขายได้" หรือ "sold"
    let rating = 0, sales = 0;
    document.querySelectorAll('*').forEach(el => {
      if (el.children.length > 0) return;
      const t = el.textContent.trim();
      // Rating: ตัวเลข 1-5 ที่มีดาวอยู่ใกล้ๆ
      if (!rating && /^\d\.\d$/.test(t)) rating = parseFloat(t);
      // Sales: "ขายได้ xxx ชิ้น"
      if (!sales && /ขายได้|ขายแล้ว|sold/i.test(t)) {
        const m = t.match(/(\d[\d,]*)\s*ชิ้น/);
        if (m) sales = parseInt(m[1].replace(/,/g, ''));
      }
    });

    // ── Product URL ("ดูสินค้า") ─────────────────────────────────
    const productUrl = document.querySelector('a[href*="shopee.co.th/product"]')?.href || '';

    // ── Affiliate Link (ถ้ามีใน input) ──────────────────────────
    const linkInput = document.querySelector('input[value*="s.shopee"],input[value*="shp.ee"]');
    const affiliateLink = linkInput?.value || '';

    return {
      mode:'affiliate-detail', name, price, sale:price, discount:0,
      commission, commissionBaht, shop:'', shopType:'normal',
      imageUrl:images[0]||'', extraImages:[], imageUrls:imgUrl?[imgUrl]:[],
      rating, ratingCount:0, sales,
      affiliateLink, productUrl,
      source:'affiliate-detail'
    };
  }

  // ── กดปุ่ม "เอา ลิงก์" → กด "คัดลอกลิงก์" → ดัก link ─────────
  async function clickAffiliateButton() {
    // ขั้น 1: หาปุ่ม "เอา ลิงก์" — class จริง: get-link-btn
    const getBtn = document.querySelector('button.get-link-btn')
                || document.querySelector('button.ant-btn.get-link-btn')
                || Array.from(document.querySelectorAll('button')).find(b =>
                     /เอา?\s*ลิงก์|Get\s*Link/i.test(b.textContent?.trim())
                   );

    if (!getBtn) {
      throw new Error('ไม่พบปุ่ม "เอาลิงก์" — ต้องเปิดหน้า Detail ของสินค้าก่อนครับ\n(กดที่ชื่อสินค้าจากหน้า List)');
    }

    getBtn.click();

    // ขั้น 2: รอ Modal เปิด (ant-modal จาก Ant Design)
    await waitFor('.ant-modal, .ant-modal-content, [class*="get-link-modal"]', 3000).catch(() => {});
    await new Promise(r => setTimeout(r, 600));

    // ขั้น 3: อ่าน link จาก textarea/input ใน Modal
    let link = '';
    const modal = document.querySelector('.ant-modal-content, .ant-modal');

    if (modal) {
      // textarea มักมี link อยู่
      const inputs = modal.querySelectorAll('input, textarea');
      for (const inp of inputs) {
        const v = (inp.value || inp.textContent || '').trim();
        if (/s\.shopee|shp\.ee|shopee\.co\.th/.test(v)) { link = v; break; }
      }
    }

    // ขั้น 4: กดปุ่ม "คัดลอกลิงก์" — class จริง: ant-btn mkt-btn ant-btn-primary
    // ปุ่มนี้อยู่ใน Modal และมีข้อความ "คัดลอกลิงก์"
    const copyBtn = (modal || document).querySelector(
      'button:not(.get-link-btn)'
    );

    // หาปุ่มที่มีข้อความ "คัดลอกลิงก์" โดยเฉพาะ
    const allModalBtns = Array.from((modal || document).querySelectorAll('button'));
    const copyLinkBtn  = allModalBtns.find(b =>
      /คัดลอกลิงก์|คัดลอก\s*ลิงก์|copy\s*link/i.test(b.textContent?.trim())
    );

    if (copyLinkBtn) {
      copyLinkBtn.click();
      await new Promise(r => setTimeout(r, 700));

      // อ่านจาก clipboard หลังกด
      try {
        const clip = await navigator.clipboard.readText();
        if (/shopee|shp\.ee/.test(clip)) link = clip.trim();
      } catch {
        // clipboard ถูก block → ลองอ่าน input อีกรอบ
        if (modal) {
          const inputs2 = modal.querySelectorAll('input, textarea');
          for (const inp of inputs2) {
            const v = (inp.value || '').trim();
            if (/s\.shopee|shp\.ee/.test(v)) { link = v; break; }
          }
        }
      }
    }

    // ขั้น 5: ปิด Modal (กด X หรือ Escape)
    const closeEl = document.querySelector(
      '.ant-modal-close, .ant-modal-close-x, button[aria-label="Close"]'
    );
    if (closeEl) {
      (closeEl.closest('button') || closeEl).click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    if (!link) {
      throw new Error(
        'ดึง Affiliate Link อัตโนมัติไม่ได้\n' +
        'กด "เอาลิงก์" เอง → กด "คัดลอกลิงก์" → วางในช่อง Affiliate Link ครับ'
      );
    }

    return { affiliateLink: link };
  }

  // ═══ MODE B: shopee.co.th ═══
  async function getShopeeProductInfo() {
    const url = location.href;
    const ids = extractIds(url);
    if (!ids) throw new Error('ไม่ใช่หน้าสินค้า — เปิด shopee.co.th/product/... ก่อนครับ');
    const { shopId, itemId } = ids;

    const res = await fetch(
      `https://shopee.co.th/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
      { credentials:'include', headers:{ 'Accept':'application/json','x-api-source':'pc','x-shopee-language':'th','Referer':'https://shopee.co.th/' } }
    );

    if (!res.ok) return scrapeShopeeDOM(url, shopId, itemId);
    const json = await res.json();
    const item = json.data || json.item;
    if (!item)  return scrapeShopeeDOM(url, shopId, itemId);

    const tp   = v => v ? +(v/100000).toFixed(2) : 0;
    const base = 'https://down-th.img.susercontent.com/file/';
    const sale = tp(item.price_min || item.price);
    const orig = tp(item.price_before_discount || item.price_max || item.price);
    const disc = (orig>sale && sale>0) ? Math.round((1-sale/orig)*100) : 0;
    const keys = [];
    if (item.image) keys.push(item.image);
    if (item.images) item.images.forEach(k => { if (!keys.includes(k)) keys.push(k); });
    const allUrls = keys.slice(0,8).map(k => base+k);
    const images  = await fetchBase64(allUrls);

    return {
      mode:'shopee', itemId, shopId,
      name:item.name||'',
      description:(item.description||'').substring(0,600).trim(),
      price:orig||sale, sale, discount:disc,
      shop:item.shop_name||'',
      shopType:item.shop_type===1?'mall':item.shop_type===2?'preferred':'normal',
      imageUrl:images[0]||'', extraImages:images.slice(1), imageUrls:allUrls,
      rating:item.item_rating?.rating_star ? +item.item_rating.rating_star.toFixed(1) : 0,
      ratingCount:item.item_rating?.rating_count?.[0]||0,
      sales:item.historical_sold||item.sold||0, stock:item.stock||0,
      affiliateLink:'', productUrl:url, source:'shopee-api'
    };
  }

  async function scrapeShopeeDOM(url, shopId, itemId) {
    const get = sel => document.querySelector(sel);
    const name    = get('meta[property="og:title"]')?.content?.replace(/ \| Shopee.*/g,'').trim()
                 || document.title.replace(/ \| Shopee.*/g,'').trim() || '';
    const ogImg   = get('meta[property="og:image"]')?.content || '';
    const domUrls = [];
    document.querySelectorAll('img[src*="susercontent.com"]').forEach(img => {
      if (img.src && !img.src.includes('avatar') && !domUrls.includes(img.src)) domUrls.push(img.src);
    });
    const allUrls = ogImg ? [ogImg, ...domUrls.filter(u=>u!==ogImg)] : domUrls;
    const images  = await fetchBase64(allUrls.slice(0,8));
    let sale=0, orig=0;
    document.querySelectorAll('[class*="price"]').forEach(el => {
      const n = parsePrice(el.textContent);
      if (n>0 && n<9999999) { if (!sale||n<sale) sale=n; if (n>orig) orig=n; }
    });
    return {
      mode:'shopee', itemId, shopId, name,
      imageUrl:images[0]||'', extraImages:images.slice(1), imageUrls:allUrls,
      price:orig||sale, sale, discount:(orig>sale&&sale>0)?Math.round((1-sale/orig)*100):0,
      shop:get('[class*="shop-name"]')?.textContent?.trim()||'', shopType:'normal',
      rating:parseFloat(get('[class*="rating"] [class*="score"]')?.textContent)||0,
      ratingCount:0, sales:0, stock:0,
      affiliateLink:'', productUrl:url, source:'shopee-dom'
    };
  }

  // ═══ HELPERS ═══
  async function fetchBase64(urls) {
    const out = [];
    for (const url of urls) {
      try {
        const r = await fetch(url, {credentials:'omit'});
        if (!r.ok) { out.push(''); continue; }
        const blob = await r.blob();
        const b64  = await new Promise((res,rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = rej;
          fr.readAsDataURL(blob);
        });
        out.push(b64);
      } catch { out.push(''); }
    }
    return out;
  }

  function extractIds(url) {
    let m = url.match(/shopee\.co\.th\/(?:product|shop)\/(\d+)\/(\d+)/);
    if (m) return {shopId:m[1], itemId:m[2]};
    m = url.match(/shopee\.co\.th\/[^/?#]+\/(\d{6,})\/(\d{8,})/);
    if (m) return {shopId:m[1], itemId:m[2]};
    m = url.match(/-i\.(\d+)\.(\d+)/);
    if (m) return {shopId:m[1], itemId:m[2]};
    const qi=url.match(/[?&]itemid=(\d+)/i), qs=url.match(/[?&]shopid=(\d+)/i);
    if (qi&&qs) return {shopId:qs[1], itemId:qi[1]};
    return null;
  }

  function parsePrice(t) {
    if (!t) return 0;
    const m = t.replace(/,/g,'').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[0]) : 0;
  }

  function parseCommission(t) {
    if (!t) return 0;
    const m = t.match(/([\d.]+)\s*%/);
    return m ? parseFloat(m[1]) : 0;
  }

  function waitFor(sel, ms=3000) {
    return new Promise((res, rej) => {
      const el = document.querySelector(sel);
      if (el) return res(el);
      const ob = new MutationObserver(() => {
        const el = document.querySelector(sel);
        if (el) { ob.disconnect(); res(el); }
      });
      ob.observe(document.body, {childList:true, subtree:true});
      setTimeout(() => { ob.disconnect(); rej(new Error('timeout')); }, ms);
    });
  }

})();
