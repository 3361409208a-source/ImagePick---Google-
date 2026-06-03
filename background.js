chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename || 'image_download',
      saveAs: false
    });
    sendResponse({ ok: true });
  }
  return true;
});
