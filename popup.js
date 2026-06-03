document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  async function getCounts() {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const state = window.__gidState || { images: [] };
          return { images: state.images?.length || 0 };
        }
      });
      document.getElementById('img-count').textContent = result?.images ?? '-';
      document.getElementById('sel-count').textContent = '-';
    } catch (e) {
      document.getElementById('img-count').textContent = '-';
      document.getElementById('sel-count').textContent = '-';
    }
  }

  function showStatus(msg, type) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = 'status ' + type;
    setTimeout(() => { el.className = 'status'; }, 2500);
  }

  document.getElementById('btn-refresh').addEventListener('click', async () => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.initImageToolbar === 'function') {
            window.initImageToolbar();
          }
        }
      });
      showStatus('刷新成功', 'success');
      await getCounts();
    } catch (e) {
      showStatus('刷新失败，请确保在 Google 页面', 'error');
    }
  });

  document.getElementById('btn-options').addEventListener('click', () => {
    showStatus('设置功能开发中', 'success');
  });

  getCounts();
});
