(() => {
  const GID = 'google-image-downloader';
  const ICON_PREVIEW = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg>`;
  const ICON_DOWNLOAD = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>`;

  const state = { images: [], processed: new WeakSet(), panelOpen: false };

  function createEl(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html) el.innerHTML = html;
    return el;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/\s+/g, ' ');
  }

  // ========== 判断是否是人物头像 ==========
  function isPortraitImage(img) {
    const w = img.naturalWidth || img.width || img.clientWidth;
    const h = img.naturalHeight || img.height || img.clientHeight;
    if (w < 60 || h < 60) return false;
    if (w / h > 3 || h / w > 3) return false;
    return true;
  }

  // ========== 判断文本是否是人名（不是位置/国家/垃圾） ==========
  function isValidName(text) {
    if (!text || text.length < 2 || text.length > 35) return false;
    const t = text.trim();
    // 排除位置词
    if (/^(前锋|中场|后卫|守门员|主教练|教练|球员|后卫|左边锋|右边锋|中锋)$/.test(t)) return false;
    // 排除纯数字
    if (/^\d+$/.test(t)) return false;
    // 排除纯emoji
    if (/^[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F9FF}\s]+$/u.test(t)) return false;
    // 排除明显不是人名的
    if (/logo|team|goog|搜索|更多|结果|FIFA|World Cup|国际足协|世足|世界杯|2026/i.test(t)) return false;
    return true;
  }

  // ========== 从球员卡片提取名字 ==========
  function extractName(img) {
    // 1. alt / aria-label 最优先
    const alt = img.alt || img.getAttribute('aria-label') || '';
    if (isValidName(alt)) return sanitizeFilename(alt.trim());

    // 2. 找到球员卡片容器（Google 知识面板通常是 role="listitem"）
    let card = img.closest('[role="listitem"]');
    if (!card) {
      // fallback：找包含当前 img 且包含文字的最小 div
      let node = img.parentElement;
      while (node && node !== document.body) {
        if (node.children.length >= 2 && node.textContent.trim().length > 5) {
          card = node;
          break;
        }
        node = node.parentElement;
      }
    }

    if (card) {
      // 遍历卡片的直接子元素，排除包含图片的，找文字容器
      for (const child of card.children) {
        if (child.contains(img) || child.querySelector('img')) continue;
        const text = child.textContent.trim();
        if (!text) continue;
        // 按行分割，取第一个像人名的
        const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (isValidName(line)) return sanitizeFilename(line);
        }
      }
    }

    // 3. fallback：img 父元素的相邻兄弟
    const parent = img.parentElement;
    if (parent) {
      const sibling = parent.nextElementSibling;
      if (sibling) {
        const lines = sibling.textContent.trim().split(/\n+/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (isValidName(line)) return sanitizeFilename(line);
        }
      }
    }

    // 4. 最后 fallback：img 的 title
    if (img.title && isValidName(img.title)) return sanitizeFilename(img.title.trim());

    return '';
  }

  // ========== 收集图片 ==========
  function collectImagesFromNode(root) {
    const imgs = [];
    const candidates = root.matches?.('img') ? [root] : [];
    if (root.querySelectorAll) candidates.push(...root.querySelectorAll('img'));

    candidates.forEach(img => {
      if (state.processed.has(img)) return;
      let src = img.currentSrc || img.src || img.dataset?.src;
      if (!src) return;
      if (src.startsWith('data:image/gif;base64,R0lGODlhAQABAI')) return;
      if (/google.*\/(x|favicon|logo|icon)\b|google[\w]*logo|gstatic/i.test(src)) return;
      if (!isPortraitImage(img)) { state.processed.add(img); return; }

      // 提取高清原图
      let highRes = src;
      const anyA = img.closest('a');
      if (anyA && anyA.href) {
        try {
          const u = new URL(anyA.href, location.href);
          const imgurl = u.searchParams.get('imgurl');
          if (imgurl) highRes = decodeURIComponent(imgurl);
        } catch (e) {}
      }
      if (highRes === src && img.srcset) {
        const parts = img.srcset.split(',');
        const last = parts[parts.length - 1].trim().split(' ')[0];
        if (last && last.startsWith('http')) highRes = last;
      }

      if (state.images.find(i => i.src === highRes)) { state.processed.add(img); return; }

      const caption = extractName(img);
      state.processed.add(img);
      imgs.push({ src: highRes, thumb: src, alt: img.alt || '', caption, el: img });
    });
    return imgs;
  }

  function addToolbarToImage(imgData) {
    const img = imgData.el;
    if (!img || img.dataset.gidToolbar) return;
    img.dataset.gidToolbar = '1';

    let container = img.parentElement;
    while (container && container !== document.body) {
      const rect = container.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 20) break;
      container = container.parentElement;
    }
    if (!container || container === document.body) container = img.parentElement;

    const computed = window.getComputedStyle(container);
    if (computed.position === 'static') container.style.position = 'relative';

    const toolbar = createEl('div', `${GID}-toolbar`);
    toolbar.innerHTML = `
      <button class="${GID}-tb-btn" title="预览" data-action="preview" data-src="${imgData.src}">${ICON_PREVIEW}</button>
      <button class="${GID}-tb-btn" title="下载" data-action="download" data-src="${imgData.src}" data-caption="${escapeHtml(imgData.caption)}">${ICON_DOWNLOAD}</button>
    `;
    container.appendChild(toolbar);
    container.addEventListener('mouseenter', () => { toolbar.style.opacity = '1'; });
    container.addEventListener('mouseleave', () => { toolbar.style.opacity = '0'; });
  }

  function scanAndInject(nodes) {
    const newImages = [];
    nodes.forEach(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      newImages.push(...collectImagesFromNode(node));
    });
    if (newImages.length) {
      state.images.push(...newImages);
      newImages.forEach(addToolbarToImage);
      updatePanel();
    }
  }

  // ========== 预览 ==========
  function openPreview(src) {
    let overlay = document.getElementById(`${GID}-overlay`);
    if (!overlay) {
      overlay = createEl('div', `${GID}-overlay`);
      overlay.id = `${GID}-overlay`;
      overlay.addEventListener('click', e => { if (e.target === overlay) closePreview(); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="${GID}-modal">
        <img src="${src}" alt="preview" />
        <div class="${GID}-modal-actions">
          <button class="${GID}-btn ${GID}-btn-download" data-action="download" data-src="${src}">${ICON_DOWNLOAD} 下载原图</button>
          <button class="${GID}-btn ${GID}-btn-close" data-action="close">关闭</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closePreview() {
    const overlay = document.getElementById(`${GID}-overlay`);
    if (overlay) { overlay.classList.remove('active'); document.body.style.overflow = ''; }
  }

  // ========== 下载 ==========
  function getExt(src) {
    if (src.startsWith('data:image/png')) return 'png';
    if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) return 'jpg';
    if (src.startsWith('data:image/gif')) return 'gif';
    if (src.startsWith('data:image/webp')) return 'webp';
    const ext = src.split('.').pop().split('?')[0];
    return ['jpg','jpeg','png','gif','webp'].includes(ext) ? ext : 'jpg';
  }

  function downloadImage(src, caption) {
    const ext = getExt(src);
    const name = caption ? `${caption}.${ext}` : `image_${Date.now()}.${ext}`;

    if (src.startsWith('data:')) {
      const a = document.createElement('a'); a.href = src; a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); return;
    }
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cvs = document.createElement('canvas');
        cvs.width = img.naturalWidth || img.width;
        cvs.height = img.naturalHeight || img.height;
        cvs.getContext('2d').drawImage(img, 0, 0);
        const a = document.createElement('a');
        a.href = cvs.toDataURL('image/png');
        a.download = name.replace(/\.[^.]+$/, '.png');
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { fallbackDownload(src, name); }
    };
    img.onerror = () => fallbackDownload(src, name);
    img.src = src;
  }

  function fallbackDownload(src, filename) {
    try { chrome.runtime.sendMessage({ action: 'download', url: src, filename }); }
    catch { window.open(src, '_blank'); }
  }

  // ========== 触发按钮 ==========
  function createTriggerBtn() {
    if (document.getElementById(`${GID}-trigger`)) return;
    const btn = createEl('div', `${GID}-trigger`, `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>
      <span>图片下载器</span>
    `);
    btn.id = `${GID}-trigger`;
    document.body.appendChild(btn);
    btn.addEventListener('click', () => { btn.style.display = 'none'; openPanel(); });
  }

  // ========== 右侧面板 ==========
  function openPanel() {
    let panel = document.getElementById(`${GID}-panel`);
    if (!panel) {
      panel = createEl('div', `${GID}-panel`, `
        <div class="${GID}-panel-header">
          <span>图片下载器</span>
          <button class="${GID}-panel-close" title="收起">−</button>
        </div>
        <div class="${GID}-panel-body">
          <div class="${GID}-stats">
            检测到 <strong id="${GID}-count">0</strong> 张图片
          </div>
          <div class="${GID}-actions">
            <button class="${GID}-btn ${GID}-btn-primary" id="${GID}-refresh">刷新</button>
            <button class="${GID}-btn ${GID}-btn-download" id="${GID}-batch-download">全部下载</button>
          </div>
          <div class="${GID}-gallery" id="${GID}-gallery"></div>
        </div>
      `);
      panel.id = `${GID}-panel`;
      document.body.appendChild(panel);

      panel.querySelector(`.${GID}-panel-close`).addEventListener('click', e => { e.stopPropagation(); closePanel(); });
      panel.querySelector(`#${GID}-refresh`).addEventListener('click', () => { scanAndInject([document.body]); });
      panel.querySelector(`#${GID}-batch-download`).addEventListener('click', batchDownload);
    }

    panel.classList.remove('collapsed');
    document.body.style.paddingRight = '280px';
    state.panelOpen = true;
    updatePanel();
  }

  function closePanel() {
    const panel = document.getElementById(`${GID}-panel`);
    if (panel) panel.classList.add('collapsed');
    document.body.style.paddingRight = '';
    state.panelOpen = false;
    const trigger = document.getElementById(`${GID}-trigger`);
    if (trigger) trigger.style.display = 'flex';
  }

  function updatePanel() {
    const countEl = document.getElementById(`${GID}-count`);
    const gallery = document.getElementById(`${GID}-gallery`);
    if (countEl) countEl.textContent = state.images.length;

    if (!gallery) return;
    if (!state.images.length) {
      gallery.innerHTML = '<div class="gid-empty">未检测到图片</div>';
      return;
    }

    gallery.innerHTML = state.images.map((img, idx) => `
      <div class="${GID}-gallery-item" data-idx="${idx}">
        <img src="${img.thumb}" alt="${escapeHtml(img.caption || img.alt)}" loading="lazy">
        ${img.caption ? `<div class="${GID}-gallery-caption" title="${escapeHtml(img.caption)}">${escapeHtml(img.caption)}</div>` : ''}
        <div class="${GID}-gallery-overlay">
          <button class="${GID}-gallery-btn" data-action="preview" data-src="${img.src}">${ICON_PREVIEW}</button>
          <button class="${GID}-gallery-btn" data-action="download" data-src="${img.src}" data-caption="${escapeHtml(img.caption)}">${ICON_DOWNLOAD}</button>
        </div>
      </div>
    `).join('');

    gallery.querySelectorAll(`.${GID}-gallery-item`).forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest(`.${GID}-gallery-btn`)) return;
        const idx = +item.dataset.idx;
        const img = state.images[idx];
        if (img) openPreview(img.src);
      });
    });

    gallery.querySelectorAll(`.${GID}-gallery-btn`).forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const src = btn.dataset.src;
        const caption = btn.dataset.caption || '';
        if (action === 'preview') openPreview(src);
        else if (action === 'download') downloadImage(src, caption);
      });
    });
  }

  function batchDownload() {
    if (!state.images.length) { alert('未检测到图片'); return; }
    let delay = 0;
    state.images.forEach(img => { setTimeout(() => downloadImage(img.src, img.caption), delay); delay += 300; });
  }

  // ========== 页面悬浮工具栏点击代理 ==========
  document.addEventListener('click', e => {
    const btn = e.target.closest(`.${GID}-tb-btn, .${GID}-btn`);
    if (!btn) return;
    const action = btn.dataset.action;
    const src = btn.dataset.src;
    const caption = btn.dataset.caption || '';

    if (action === 'preview') {
      e.preventDefault(); e.stopPropagation(); openPreview(src);
    } else if (action === 'download') {
      e.preventDefault(); e.stopPropagation(); downloadImage(src, caption);
    } else if (action === 'close') {
      e.preventDefault(); closePreview();
    }
  });

  // ========== 启动 ==========
  function init() {
    scanAndInject([document.body]);
    createTriggerBtn();

    let timer = null;
    const observer = new MutationObserver(mutations => {
      const added = [];
      mutations.forEach(m => { m.addedNodes.forEach(n => { if (n.nodeType === Node.ELEMENT_NODE) added.push(n); }); });
      if (!added.length) return;
      clearTimeout(timer);
      timer = setTimeout(() => scanAndInject(added), 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__gidState = state;
  window.initImageToolbar = () => scanAndInject([document.body]);
})();
