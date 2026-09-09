// background.js v2.0
// เปิด Side Panel เมื่อกดไอคอน

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// รับข้อมูลจาก content.js ผ่าน background (สำหรับ cross-tab messaging)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'affiliateLinkCaptured') {
    // ส่งต่อไปยัง side panel
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
  return false;
});
