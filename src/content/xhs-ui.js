// Xiaohongshu-adjacent notebook UI injected by the content script.
(function () {
  'use strict';

  const STYLE_ID = 'fg-theme-link';
  // Old hover pair 「收这张图」「框选文字」. Do not add fg-lbchip — that's the lightbox capsule.
  const CUT_IMAGE_UI_IDS = ['fg-imgbadge', 'fg-imgchip', 'fg-ocr', 'fg-selchip', 'fg-boardpick', 'fg-checkin'];

  function stripCutImageUi() {
    CUT_IMAGE_UI_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    document.querySelectorAll('.fg-imgbadge, .fg-imgchip, .fg-ocr').forEach((el) => {
      if (el.id === 'fg-lbchip') return;
      el.remove();
    });
  }

  function ensureCutImageUiGone() {
    stripCutImageUi();
    if (window.__fgCutImageUiBound) return;
    window.__fgCutImageUiBound = true;
    const watch = new MutationObserver((muts) => {
      for (let i = 0; i < muts.length; i++) {
        const nodes = muts[i].addedNodes;
        for (let j = 0; j < nodes.length; j++) {
          const n = nodes[j];
          if (!n || n.nodeType !== 1) continue;
          const id = n.id || '';
          if (id === 'fg-lbchip') continue;
          if (CUT_IMAGE_UI_IDS.indexOf(id) !== -1) {
            stripCutImageUi();
            return;
          }
          if (n.matches && n.matches('.fg-imgbadge, .fg-imgchip, .fg-ocr, #fg-imgbadge, #fg-imgchip, #fg-ocr')) {
            stripCutImageUi();
            return;
          }
          if (n.querySelector && n.querySelector('#fg-imgbadge, #fg-imgchip, #fg-ocr, .fg-imgbadge, .fg-ocr')) {
            stripCutImageUi();
            return;
          }
        }
      }
    });
    watch.observe(document.documentElement, { childList: true, subtree: true });
  }

  function injectStyles() {
    ensureCutImageUiGone();
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/pages/theme.css');
    (document.head || document.documentElement).appendChild(link);
  }

  function clearOverlayShift() {
    document.querySelectorAll('[data-fg-shifted]').forEach((el) => {
      el.style.removeProperty('right');
      el.style.removeProperty('width');
      el.style.removeProperty('max-width');
      el.style.removeProperty('left');
      el.removeAttribute('data-fg-shifted');
    });
    const html = document.documentElement;
    html.classList.remove('fg-nb-open');
    html.style.removeProperty('--fg-nb-w');
    html.style.removeProperty('padding-right');
    html.style.removeProperty('margin-right');
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    if (!msg) return;
    injectStyles();
    const old = document.getElementById('fg-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'fg-toast';
    el.className = 'fg-toast';
    el.textContent = msg;
    document.documentElement.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 2800);
  }

  function asset(name) {
    return chrome.runtime.getURL('assets/icons/' + name);
  }

  function openSidePanelNow() {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }

  function showGate({ defaultKeyword, onSearch, onBrowse }) {
    if (document.getElementById('fg-xhs-gate')) return;
    injectStyles();
    const gate = document.createElement('div');
    gate.id = 'fg-xhs-gate';
    gate.className = 'fg-gate';
    gate.innerHTML = `
      <div class="fg-gate-card" id="fg-gate-card">
        <div class="fg-gate-title">咱来搜点什么<img class="fg-gate-hand"
          src="${asset('gate-hand.svg')}" alt="" /></div>
        <div class="fg-gate-row">
          <div class="fg-gate-field">
            <input class="fg-gate-input" id="fg-gate-input" type="text"
              placeholder="请输入文本" value="${esc(defaultKeyword)}" />
            <button class="fg-gate-clear" id="fg-gate-clear" type="button" aria-label="清空">
              <img src="${asset('input-clear.svg')}" alt="" />
            </button>
          </div>
          <div class="fg-gate-actions">
            <button class="fg-gate-btn fg-gate-go" id="fg-gate-go" type="button">搜一搜</button>
            <button class="fg-gate-btn fg-gate-browse" id="fg-gate-browse" type="button">
              <span class="fg-gate-browse-long">没事，我随便逛逛</span>
              <span class="fg-gate-browse-short">随便逛逛</span>
            </button>
          </div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(gate);

    const card = gate.querySelector('#fg-gate-card');
    const input = gate.querySelector('#fg-gate-input');
    const browse = gate.querySelector('#fg-gate-browse');

    const sync = () => {
      card.classList.toggle('is-filled', Boolean(input.value.trim()));
    };
    const go = () => {
      const kw = input.value.trim();
      if (!kw) return;
      openSidePanelNow();
      onSearch(kw);
    };

    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    gate.querySelector('#fg-gate-clear').addEventListener('click', () => {
      input.value = '';
      sync();
      input.focus();
    });
    gate.querySelector('#fg-gate-go').addEventListener('click', go);
    browse.addEventListener('click', () => {
      openSidePanelNow();
      onBrowse && onBrowse(input.value.trim());
    });
    sync();

    requestAnimationFrame(() => {
      gate.classList.add('on');
      input.focus();
    });
  }

  function hideGate() {
    const el = document.getElementById('fg-xhs-gate');
    if (!el) return;
    el.classList.remove('on');
    setTimeout(() => el.remove(), 180);
  }

  function showFocusCard({ intent, keywords, onContinue, onKeyword }) {
    injectStyles();
    hideFocusCard();
    const chips = (keywords || []).filter(Boolean).slice(0, 5);
    const overlay = document.createElement('div');
    overlay.id = 'fg-xhs-focus';
    overlay.className = 'fg-gate on';
    overlay.innerHTML = `
      <div class="fg-gate-card fg-focus-card" id="fg-focus-card">
        <div class="fg-gate-title">专注模式，咱先不开小差<img class="fg-gate-hand"
          src="${asset('gate-hand.svg')}" alt="" /></div>
        <button class="fg-gate-btn fg-focus-go" id="fg-focus-go" type="button">继续搜索${intent ? `「${esc(intent)}」` : ''}</button>
        ${chips.length ? `
          <div class="fg-focus-more">
            <p class="fg-focus-hint">根据整理，你还可以搜：</p>
            <div class="fg-focus-chips">
              ${chips.map((k) => `<button class="fg-focus-chip" type="button" data-kw="${esc(k)}">${esc(k)}</button>`).join('')}
            </div>
          </div>` : ''}
      </div>
    `;
    document.documentElement.appendChild(overlay);
    overlay.querySelector('#fg-focus-go').addEventListener('click', () => {
      openSidePanelNow();
      onContinue && onContinue();
    });
    overlay.querySelectorAll('[data-kw]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openSidePanelNow();
        onKeyword && onKeyword(btn.getAttribute('data-kw'));
      });
    });
  }

  function hideFocusCard() {
    const el = document.getElementById('fg-xhs-focus');
    if (!el) return;
    el.classList.remove('on');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 180);
  }

  function showOpenPanelTab() {
    injectStyles();
    if (document.getElementById('fg-open-panel')) return;
    const el = document.createElement('button');
    el.id = 'fg-open-panel';
    el.className = 'fg-open-panel';
    el.type = 'button';
    el.textContent = '记事本';
    el.title = '在浏览器侧栏打开记事本（网页会变窄，不会挡住内容）';
    el.addEventListener('click', () => openSidePanelNow());
    document.documentElement.appendChild(el);
  }

  function hideOpenPanelTab() {
    const el = document.getElementById('fg-open-panel');
    if (el) el.remove();
  }

  function hideNotebook() {
    const el = document.getElementById('fg-notebook');
    if (el) el.remove();
    clearOverlayShift();
  }

  function renderNotebook() {
    hideNotebook();
    hideOpenPanelTab();
  }

  function toggleNotebook() {
    openSidePanelNow();
  }

  function notebookOpen() {
    return false;
  }

  function chipHtml(iconFile, label) {
    return `<span class="fg-chip-ico" aria-hidden="true"><img src="${asset(iconFile)}" alt="" /></span>` +
      (label ? `<span class="fg-chip-label">${esc(label)}</span>` : '');
  }

  function mountChip(id, extraClass) {
    injectStyles();
    if (id === 'fg-imgchip' || id === 'fg-imgbadge') return null;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('button');
      el.id = id;
      el.type = 'button';
      document.documentElement.appendChild(el);
    }
    el.className = 'fg-chip' + (extraClass ? ' ' + extraClass : '');
    return el;
  }

  function noteRoot() {
    const mask = document.querySelector(
      '.note-detail-mask, .note-container-mask, [class*="note-detail-mask"]'
    );
    if (mask) {
      return mask.querySelector('.note-container, #noteContainer, [class*="note-container"]') || mask;
    }
    const nodes = document.querySelectorAll('#noteContainer, .note-container');
    let best = null;
    let area = 0;
    for (let i = 0; i < nodes.length; i++) {
      const r = visRect(nodes[i]);
      if (!r) continue;
      const a = r.width * r.height;
      if (a > area) {
        best = nodes[i];
        area = a;
      }
    }
    return best;
  }

  function visRect(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) return null;
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    return r;
  }

  function shortAncestor(el, scope, maxH) {
    let cur = el;
    let best = el;
    for (let i = 0; i < 10 && cur && cur !== scope; i++) {
      const r = visRect(cur);
      if (!r) break;
      if (r.height <= maxH) best = cur;
      else break;
      cur = cur.parentElement;
    }
    return best;
  }

  function noteMedia(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll(
      '.media-container, .swiper, .n-media, .note-slider, [class*="carousel"], [class*="media-container"], [class*="MediaContainer"]'
    );
    let best = null;
    let area = 0;
    for (let i = 0; i < nodes.length; i++) {
      const r = visRect(nodes[i]);
      if (!r || r.width < 180) continue;
      const a = r.width * r.height;
      if (a > area && r.left < window.innerWidth * 0.62) {
        best = nodes[i];
        area = a;
      }
    }
    return best;
  }

  function noteTextCol(root) {
    const scope = root || document;
    return scope.querySelector(
      '.interaction-container, [class*="interaction-container"], [class*="InteractionContainer"]'
    );
  }

  function noteEngageBar(root) {
    const scope = root || document;
    const named = scope.querySelector('.engage-bar, [class*="engage-bar"], [class*="EngageBar"]');
    const nr = named && visRect(named);
    if (named && nr && nr.height <= 120) return named;
    const ph = scope.querySelector(
      'input[placeholder*="说点什么"], textarea[placeholder*="说点什么"], [placeholder*="说点什么"]'
    );
    if (ph) return shortAncestor(ph, scope, 96);
    const col = noteTextCol(root);
    if (!col) return null;
    const kids = col.querySelectorAll('div, span');
    let hit = null;
    let bottom = -1;
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      const t = (el.textContent || '').replace(/\s+/g, '');
      if (t.indexOf('说点什么') === -1) continue;
      const r = visRect(el);
      if (!r || r.height > 96) continue;
      if (r.bottom > bottom) {
        hit = shortAncestor(el, col, 96);
        bottom = r.bottom;
      }
    }
    return hit;
  }

  function placeDrift(el) {
    const root = noteRoot();
    const media = noteMedia(root);
    const bar = noteEngageBar(root);
    const mr = visRect(media);
    const br = visRect(bar);
    const h = el.offsetHeight || 56;
    const pad = 16;
    let width = mr ? Math.max(280, mr.width - pad * 2) : Math.min(828, window.innerWidth - 48);
    let left = mr ? mr.left + pad : 24;
    let top = window.innerHeight - h - 88;
    if (br) top = br.top - h - 12;
    else if (mr) top = mr.bottom - h - 72;
    if (mr) {
      top = Math.max(top, mr.top + 8);
      if (left + width > mr.right - 8) width = Math.max(240, mr.right - 8 - left);
    }
    el.style.transform = 'none';
    el.style.bottom = 'auto';
    el.style.width = Math.round(width) + 'px';
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  function placeSave(el) {
    const root = noteRoot();
    const col = noteTextCol(root);
    const bar = noteEngageBar(root);
    const chipH = el.offsetHeight || 48;
    const chipW = el.offsetWidth || 190;
    const cr = visRect(col);
    const br = visRect(bar);
    let top = window.innerHeight - chipH - 88;
    if (br) {
      top = br.top - chipH - 10;
    } else if (cr) {
      top = Math.min(window.innerHeight - chipH - 88, cr.bottom - chipH - 16);
    }
    // Center in the note's text/interaction column (desktop right pane, stacked
    // layout = text region). Use column rect, not CSS left:50% + translateX.
    const band = cr || br;
    let left = band
      ? band.left + band.width / 2 - chipW / 2
      : Math.max(8, window.innerWidth * 0.52);
    el.style.removeProperty('transform');
    el.style.removeProperty('right');
    el.style.removeProperty('bottom');
    el.style.top = Math.max(8, Math.round(top)) + 'px';
    el.style.left = Math.round(Math.max(8, Math.min(left, window.innerWidth - chipW - 8))) + 'px';
  }

  function ownText(el) {
    if (!el || !el.childNodes) return '';
    let s = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === 3) s += n.textContent || '';
    }
    return s.replace(/\s+/g, '');
  }

  function sampleBottomChrome() {
    const texts = [];
    const labels = [];
    const ys = [
      Math.max(8, window.innerHeight - 22),
      Math.max(8, window.innerHeight - 44)
    ];
    for (let yi = 0; yi < ys.length; yi++) {
      const y = ys[yi];
      for (let i = 0; i < 9; i++) {
        const x = window.innerWidth * (0.08 + i * 0.105);
        const stack = document.elementsFromPoint(x, y) || [];
        for (let j = 0; j < Math.min(8, stack.length); j++) {
          const el = stack[j];
          if (!el || (el.closest && el.closest('[id^="fg-"]'))) continue;
          const t = ownText(el) || ((el.textContent || '').replace(/\s+/g, '').slice(0, 8));
          if (t) texts.push(t);
          const aria = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
          if (aria) labels.push(aria);
        }
      }
    }
    return { texts, labels: labels.join(' ') };
  }

  function interactionHittable() {
    const col = noteTextCol(noteRoot());
    const r = visRect(col);
    if (!r) return false;
    const x = r.left + Math.min(48, r.width * 0.5);
    const y = r.top + Math.min(64, r.height * 0.35);
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit.closest && hit.closest('[id^="fg-"]'))) return true;
    return col.contains(hit) || Boolean(
      hit.closest && hit.closest('.interaction-container, [class*="interaction-container"], [class*="InteractionContainer"]')
    );
  }

  function lightboxPhoto() {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.42;
    const stack = document.elementsFromPoint(cx, cy) || [];
    for (let i = 0; i < stack.length; i++) {
      const el = stack[i];
      if (!el || (el.closest && el.closest('[id^="fg-"]'))) continue;
      const img = el.tagName === 'IMG' ? el : (el.querySelector && el.querySelector('img'));
      if (!img) continue;
      const r = visRect(img);
      if (r && r.width >= 140 && r.height >= 140) return img;
    }
    const imgs = document.querySelectorAll('img');
    let best = null;
    let area = 0;
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (img.closest && img.closest('[id^="fg-"]')) continue;
      const r = visRect(img);
      if (!r || r.width < 140 || r.height < 140) continue;
      const dist = Math.abs((r.left + r.width / 2) - cx);
      if (dist > window.innerWidth * 0.3) continue;
      const a = r.width * r.height;
      if (a > area) {
        best = img;
        area = a;
      }
    }
    return best;
  }

  function isLightboxOpen() {
    const chrome = sampleBottomChrome();
    const hasZoom = chrome.texts.some((t) => /^\d{1,3}%$/.test(t));
    const hasPager = chrome.texts.some((t) => /^\d{1,3}\/\d{1,3}$/.test(t));
    const hasTools = /放大|缩小|旋转|下载|zoom|rotate|download/i.test(chrome.labels);
    if (hasZoom) return true;
    if (hasTools && !interactionHittable()) return true;
    const photo = lightboxPhoto();
    if (!photo) return false;
    const r = photo.getBoundingClientRect();
    const centered = Math.abs((r.left + r.width / 2) - window.innerWidth / 2) <= Math.max(48, window.innerWidth * 0.14);
    const big = r.width >= 160 && r.height >= 160 && (r.width * r.height) > window.innerWidth * window.innerHeight * 0.18;
    if (!centered || !big || interactionHittable()) return false;
    return hasPager || r.height > window.innerHeight * 0.62;
  }

  function diandianDeepText(root) {
    let s = '';
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        s += node.textContent || '';
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.id && String(node.id).indexOf('fg-') === 0) return;
      if (node.shadowRoot) visit(node.shadowRoot);
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) visit(kids[i]);
    };
    visit(root);
    return s.replace(/\n{3,}/g, '\n\n').trim();
  }

  function expandToPanel(el) {
    let cur = el;
    let best = el;
    for (let i = 0; i < 14 && cur && cur !== document.body; i++) {
      const r = visRect(cur);
      if (r && r.width >= 260 && r.width <= 640 && r.height >= 240) best = cur;
      cur = cur.parentElement;
    }
    return best;
  }

  function diandianPanel() {
    const hints = [];
    const input = document.querySelector(
      'input[placeholder*="搜或者"], input[placeholder*="任何问题"], textarea[placeholder*="任何问题"], input[placeholder*="问点点"], textarea[placeholder*="问点点"]'
    );
    if (input) hints.push(input);
    const nodes = document.querySelectorAll('div, span, header, h1, h2, h3, p, [role="heading"]');
    for (let i = 0; i < nodes.length && hints.length < 10; i++) {
      const el = nodes[i];
      if (el.closest && el.closest('[id^="fg-"]')) continue;
      const own = ownText(el);
      const t = own || (el.childElementCount <= 4 ? String(el.textContent || '').replace(/\s+/g, '') : '');
      if (!t || t.length > 20) continue;
      if (/^点点(ai)?$/i.test(t) || /ai总结|篇笔记生成/.test(t)) hints.push(el);
    }
    let best = null;
    let bestScore = 0;
    hints.forEach((el) => {
      const panel = expandToPanel(el);
      const r = visRect(panel);
      if (!r) return;
      const leftish = r.left < window.innerWidth * 0.55 ? 2 : 0;
      const sized = (r.width >= 260 && r.width <= 640 && r.height >= 240) ? 3 : 0;
      const score = leftish + sized + r.height / 800;
      if (score > bestScore) {
        best = panel;
        bestScore = score;
      }
    });
    return best;
  }

  function diandianHasAnswer(panel) {
    const root = panel || diandianPanel();
    if (!root) return false;
    const t = diandianDeepText(root).replace(/\s+/g, ' ');
    if (/ai总结|篇笔记生成|人推荐/.test(t)) return true;
    const stripped = t.replace(/搜或者问我任何问题|问点点|点点\s*ai|收集点点回答/gi, '');
    return stripped.length > 80;
  }

  function placeDiandian(el) {
    const panel = diandianPanel();
    const r = visRect(panel);
    const chipW = el.offsetWidth || 180;
    const chipH = el.offsetHeight || 48;
    const gap = 14;
    let left;
    let top;
    if (r) {
      const visBottom = Math.min(r.bottom, window.innerHeight);
      const visTop = Math.max(r.top, 0);
      left = r.left + r.width / 2 - chipW / 2;
      top = visBottom - chipH - gap;
      if (top < visTop + 8) top = visTop + 8;
    } else {
      left = Math.max(8, window.innerWidth * 0.22 - chipW / 2);
      top = window.innerHeight * 0.62;
    }
    el.style.removeProperty('transform');
    el.style.removeProperty('right');
    el.style.removeProperty('bottom');
    el.style.left = Math.round(Math.max(8, Math.min(left, window.innerWidth - chipW - 8))) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function placeLightboxChip(el) {
    const img = lightboxPhoto();
    if (!img) return;
    const r = img.getBoundingClientRect();
    const chipW = el.offsetWidth || 190;
    const chipH = el.offsetHeight || 48;
    const gap = 14;
    const visBottom = Math.min(r.bottom, window.innerHeight);
    const visTop = Math.max(r.top, 0);
    const left = r.left + r.width / 2 - chipW / 2;
    let top = visBottom - chipH - gap;
    if (top < visTop + 8) top = visTop + 8;
    el.style.removeProperty('transform');
    el.style.removeProperty('right');
    el.style.removeProperty('bottom');
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function placeOverlays() {
    const drift = document.getElementById('fg-drift');
    const save = document.getElementById('fg-savenote');
    const imgChip = document.getElementById('fg-lbchip');
    if (isLightboxOpen()) {
      if (save) hideSaveNote();
      if (drift) hideDrift();
      if (imgChip) placeLightboxChip(imgChip);
      const ddLb = document.getElementById('fg-diandian');
      if (ddLb) placeDiandian(ddLb);
      return;
    }
    if (drift) placeDrift(drift);
    if (save) placeSave(save);
    const dd = document.getElementById('fg-diandian');
    if (dd) placeDiandian(dd);
  }

  function ensurePlaceLoop() {
    if (window.__fgPlaceBound) return;
    window.__fgPlaceBound = true;
    window.addEventListener('resize', placeOverlays);
    window.addEventListener('scroll', placeOverlays, true);
  }

  function placeSoon() {
    ensurePlaceLoop();
    placeOverlays();
    requestAnimationFrame(placeOverlays);
    [50, 160, 400].forEach((ms) => setTimeout(placeOverlays, ms));
  }

  function showDrift({ onBack, onCorrect }) {
    if (isLightboxOpen()) return;
    injectStyles();
    hideSaveNote();
    hideLightboxChip();
    hideDrift();
    const wrap = document.createElement('div');
    wrap.id = 'fg-drift';
    wrap.className = 'fg-guess';
    wrap.innerHTML = `
      <div class="fg-guess-msg">
        <span class="fg-chip-ico"><img src="${asset('drift-wave.svg')}" alt="" /></span>
        <span>这篇好像和搜索无关，不要开小差！</span>
      </div>
      <div class="fg-guess-actions">
        <button class="fg-guess-back" id="fg-d-back" type="button">回到搜索</button>
        <button class="fg-guess-ok" id="fg-d-ok" type="button">有关，我自有考虑</button>
      </div>
    `;
    document.documentElement.appendChild(wrap);
    wrap.querySelector('#fg-d-back').addEventListener('click', () => {
      openSidePanelNow();
      onBack && onBack();
    });
    wrap.querySelector('#fg-d-ok').addEventListener('click', () => {
      openSidePanelNow();
      onCorrect && onCorrect();
    });
    placeSoon();
  }

  function hideDrift() {
    const el = document.getElementById('fg-drift');
    if (el) el.remove();
  }

  function showSaveNote(onSave) {
    if (isLightboxOpen()) return;
    injectStyles();
    hideDrift();
    hideLightboxChip();

    const el = mountChip('fg-savenote');
    el.innerHTML = chipHtml('collect-thumb.svg', '收集帖子与评论');
    placeSoon();
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('is-tap');
      setTimeout(() => el.classList.remove('is-tap'), 180);
      openSidePanelNow();
      onSave && onSave();
    };
  }

  function hideSaveNote() {
    const el = document.getElementById('fg-savenote');
    if (el) el.remove();
  }

  function showLightboxChip(onCollect) {
    injectStyles();
    hideSaveNote();
    hideDrift();
    const el = mountChip('fg-lbchip');
    if (!el) return;
    if (el.getAttribute('data-fg-ready') !== '1') {
      el.innerHTML = chipHtml('collect-thumb.svg', '收集并识别图片');
      el.setAttribute('data-fg-ready', '1');
      el.setAttribute('aria-label', '收集并识别图片');
    }
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    el.onmousedown = stop;
    el.onmouseup = stop;
    el.onclick = (e) => {
      stop(e);
      el.classList.add('is-tap');
      setTimeout(() => el.classList.remove('is-tap'), 180);
      openSidePanelNow();
      onCollect && onCollect();
    };
    placeSoon();
  }

  function hideLightboxChip() {
    const el = document.getElementById('fg-lbchip');
    if (el) el.remove();
  }

  function showDiandianChip(onCollect) {
    injectStyles();
    const el = mountChip('fg-diandian');
    if (el.getAttribute('data-fg-ready') !== '1') {
      el.innerHTML = chipHtml('collect-thumb.svg', '收集点点回答');
      el.setAttribute('data-fg-ready', '1');
      el.setAttribute('aria-label', '收集点点回答');
    }
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('is-tap');
      setTimeout(() => el.classList.remove('is-tap'), 180);
      openSidePanelNow();
      onCollect && onCollect();
    };
    placeSoon();
  }

  function hideDiandianChip() {
    const el = document.getElementById('fg-diandian');
    if (el) el.remove();
  }

  function showImgBadge() { stripCutImageUi(); }
  function showImgChip() { stripCutImageUi(); }
  function hideImgChip() { stripCutImageUi(); }
  function showOcrOverlay() { stripCutImageUi(); }
  function hideOcrOverlay() { stripCutImageUi(); }

  window.__fgUI = {
    injectStyles,
    showGate,
    hideGate,
    showFocusCard,
    hideFocusCard,
    showOpenPanelTab,
    hideOpenPanelTab,
    renderNotebook,
    hideNotebook,
    toggleNotebook,
    notebookOpen,
    showDrift,
    hideDrift,
    showSaveNote,
    hideSaveNote,
    showLightboxChip,
    hideLightboxChip,
    isLightboxOpen,
    lightboxPhoto,
    showDiandianChip,
    hideDiandianChip,
    diandianPanel,
    diandianHasAnswer,
    diandianDeepText,
    showImgBadge,
    showImgChip,
    hideImgChip,
    showOcrOverlay,
    hideOcrOverlay,
    showToast
  };
})();
