/** Opens the side panel when the toolbar button is clicked. Nothing else. */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Older Chrome without setPanelBehavior: the panel still opens from the menu.
});
