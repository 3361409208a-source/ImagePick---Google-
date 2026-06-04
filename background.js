let downloading = false;
let queue = [];

function processQueue() {
  if (downloading || queue.length === 0) return;
  downloading = true;
  const item = queue.shift();
  chrome.downloads.download({
    url: item.url,
    filename: item.filename || 'image.jpg',
    saveAs: !!item.saveAs
  }, (id) => {
    if (chrome.runtime.lastError) {
      console.error('Download failed:', chrome.runtime.lastError.message);
    }
    downloading = false;
    if (item.saveAs) {
      setTimeout(() => processQueue(), 800);
    } else {
      setTimeout(() => processQueue(), 250);
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download') {
    queue.push({
      url: request.url,
      filename: request.filename || 'image.jpg',
      saveAs: request.saveAs
    });
    processQueue();
    sendResponse({ ok: true });
  }
  return true;
});
