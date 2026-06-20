/**
 * background.js - Service worker
 * Opens the side panel (Chrome) or a new tab (Firefox/other) when the extension icon is clicked.
 */

// Detect Firefox (uses browser.* namespace)
const isFirefox = typeof browser !== "undefined";

if (isFirefox) {
  // Firefox: no sidePanel API, open UI in a new tab
  chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/index.html") });
  });
} else {
  // Chrome: use side panel API
  chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
  });

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[Janitor Lorebook] setPanelBehavior error:", err));
}
