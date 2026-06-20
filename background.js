/*
 * Grimoire - Lorebook injection for JanitorAI
 * Copyright (C) 2026 Ash <ash@ashisgreat.xyz>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */


/**
 * background.js - Service worker
 * Opens the side panel (Chrome) or a new tab (Firefox/other) when the extension icon is clicked.
 */

// Detect sidePanel support (Chrome 114+, Helium, other Chromium forks)
// Firefox lacks chrome.sidePanel entirely
const hasSidePanel = typeof chrome.sidePanel !== "undefined";

if (!hasSidePanel) {
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
    .catch((err) => console.error("[Grimoire] setPanelBehavior error:", err));
}
