document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  async function getCounts() {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const state = window.__gidState || { images: [], selected: new Set() };
          return {
            images: state.images?.length || 0,
            selected: state.selected?.size || 0
          };
        }
      });
      document.getElementById('img-count').textContent = result?.images ?? '-';
      document.getElementById('sel-count').textContent = result?.selected ?? '-';
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
      showStatus('reload complete', 'success');
      await getCounts();
    } catch (e) {
      showStatus('reload fail, please ensure you are on Google page', 'error');
    }
  });

  document.getElementById('btn-options').addEventListener('click', () => {
    showStatus('settings are under development', 'success');
  });

  getCounts();
});
