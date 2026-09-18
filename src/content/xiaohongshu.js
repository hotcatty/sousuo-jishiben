// ==================== Focus Guard: 小红书 Content Script ====================
// 搜索模式：进站问目的 → 去搜索 → 首页推荐流拦截 → 详情页语义监工
(function () {
  'use strict';

  const STORAGE_KEY_KEYWORD = 'xhs_keyword_' + new Date().toDateString();
  const UI = () => window.__fgUI;
  // 和后台的上限保持一致：一条材料存得下一整篇长笔记
  const MAX_CLIP_TEXT = 20000;

  let gateDecision = null; // 'search' | 'browse' | null
  let searchKeyword = '';
  let currentMode = 'idle';
  let liveBound = false;
  let lastCounted = Date.now();
  let lastClassifyLabel = null;
  let noteWatchTimer = null;
  let lastNoteKey = '';
  let focusModePref = 'auto';
  let channelPolicy = {};
  let collectingNote = '';
  let collectingImage = false;
  let lbCloseTimer = 0;
  const DEFAULT_BLOCK = { home: true, red: true, live: true, diandian: false, notify: false, message: false, publish: false, profile: false };

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          void chrome.runtime.lastError;
          resolve(resp || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  function ensureSidePanel() {
    send({ type: 'OPEN_SIDE_PANEL' });
  }

  function isNotePage() {
    const p = location.pathname;
    if (/^\/explore\/[A-Za-z0-9]+/.test(p)) return true;
    if (/^\/discovery\/item\//.test(p)) return true;
    if (/^\/search_result\/[A-Za-z0-9]+/.test(p)) return true;
    if (/^\/user\/profile\/[^/]+\/[A-Za-z0-9]+/.test(p)) return true;
    return false;
  }

  function isHomeFeed() {
    const p = location.pathname;
    return /^\/$/.test(p) || /^\/explore\/?$/.test(p);
  }

  function isRedChannel() {
    const p = location.pathname;
    return /^\/red(_video)?/.test(p) || /\/edison\/red/.test(p);
  }

  function isLiveChannel() {
    const p = location.pathname;
    return /^\/live/.test(p) || /livestream/.test(p);
  }

  function isNotifyChannel() {
    return /notification/.test(location.pathname);
  }

  function isMessageChannel() {
    return /\/message|\/messages|\/im\b/.test(location.pathname);
  }

  function isPublishChannel() {
    return /publish|upload|creation/.test(location.pathname);
  }

  function isProfileChannel() {
    const p = location.pathname;
    if (isNotePage()) return false;
    return /^\/user\/profile(\/[^/]+)?\/?$/.test(p) || /^\/(mine|me)\/?$/.test(p);
  }

  function isDiandianChannel() {
    const blob = location.pathname + location.search + location.hash;
    if (/diandian|dotdot|ask_ai|aichat|ai-chat|web_search\/ask/i.test(blob)) return true;
    const input = diandianFields()[0];
    if (!input) return false;
    const r = input.getBoundingClientRect();
    return r.width > 40 && r.height > 16 && r.bottom > 0 && r.top < window.innerHeight;
  }

  function currentChannelKey() {
    if (isHomeFeed()) return 'home';
    if (isRedChannel()) return 'red';
    if (isLiveChannel()) return 'live';
    if (isNotifyChannel()) return 'notify';
    if (isMessageChannel()) return 'message';
    if (isPublishChannel()) return 'publish';
    if (isProfileChannel()) return 'profile';
    return '';
  }

  function channelDecision(key) {
    const v = (channelPolicy && channelPolicy[key]) || 'auto';
    if (v === 'block' || v === 'allow') return v;
    return DEFAULT_BLOCK[key] ? 'block' : 'allow';
  }

  // 默认：首页 / RED / 直播强制隔断。点点、消息、通知、发布、我不拦。设置里可改。
  function isForcedFocusChannel() {
    if (isDiandianChannel() && channelDecision('diandian') === 'block') return true;
    if (isNotePage() || /^\/search_result/.test(location.pathname)) return false;
    const key = currentChannelKey();
    if (!key) return false;
    return channelDecision(key) === 'block';
  }

  function applyFocusSettings(s) {
    if (!s) return;
    focusModePref = s.focusMode === 'on' || s.focusMode === 'off' ? s.focusMode : 'auto';
    channelPolicy = s.channelPolicy || {};
  }

  function isHomepageFeed() {
    return isHomeFeed() || isRedChannel();
  }

  function searchUrl() {
    const kw = encodeURIComponent(searchKeyword || '');
    return kw
      ? 'https://www.xiaohongshu.com/search_result?keyword=' + kw + '&source=web_explore_feed'
      : 'https://www.xiaohongshu.com/search_result';
  }

  function getModeForCurrentPage() {
    if (gateDecision !== 'search') return 'idle';
    const path = location.pathname;
    if (/^\/search_result/.test(path)) return 'active';
    if (isNotePage()) {
      if (lastClassifyLabel === 'on_goal') return 'active';
      return 'idle';
    }
    return 'idle';
  }

  function setMode(newMode) {
    if (newMode === currentMode) return;
    forceReport();
    currentMode = newMode;
  }

  function updateMode() {
    setMode(getModeForCurrentPage());
  }

  function forceReport() {
    const now = Date.now();
    const seconds = Math.floor((now - lastCounted) / 1000);
    if (seconds < 1) return;
    chrome.runtime.sendMessage(
      { type: 'ADD_TIME', platform: 'xiaohongshu', mode: currentMode, seconds },
      () => void chrome.runtime.lastError
    );
    lastCounted = now;
  }

  function reportTime() {
    if (document.visibilityState !== 'visible') return;
    forceReport();
  }

  function meta(sel, attr) {
    const el = document.querySelector(sel);
    return el ? (el.getAttribute(attr) || el.content || '').trim() : '';
  }

  // 正文容器在小红书上有好几种写法，而且同一页可能命中多个空壳，取最长的那个
  function noteBodyText() {
    let best = '';
    ['.note-content', '#detail-desc', '.note-text', '.desc', 'article'].forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        const t = (el.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (t.length > best.length) best = t;
      });
    });
    return best;
  }

  function extractNoteSignals() {
    const ogTitle = meta('meta[property="og:title"]', 'content') || meta('meta[name="og:title"]', 'content');
    const ogDesc = meta('meta[property="og:description"]', 'content') || meta('meta[name="description"]', 'content');
    const h1 = (document.querySelector('#detail-title, .note-content .title, .title') || {}).textContent || '';
    let title = ogTitle || h1.trim() || document.title.replace(/\s*[-|｜].*$/, '').trim();
    title = title.replace(/ - 小红书$/, '').trim();
    const topics = [];
    document.querySelectorAll('a[href*="keyword="], a[href*="/search_result"], .tag, .hash-tag, a.tag').forEach((a) => {
      const t = (a.textContent || '').trim().replace(/^#/, '');
      if (t && t.length < 20 && topics.indexOf(t) === -1) topics.push(t);
    });
    const full = noteBodyText() || ogDesc || '';
    const parts = location.pathname.split('/').filter(Boolean);
    const noteId = parts[parts.length - 1] || '';
    return {
      title: title.slice(0, 160),
      topics: topics.slice(0, 8),
      // snippet 只喂跑偏判定，短的就够；body 是收录用的全文，不能砍
      snippet: [ogDesc, full].filter(Boolean).join(' ').trim().slice(0, 400),
      body: full.slice(0, MAX_CLIP_TEXT),
      url: location.href,
      noteId
    };
  }

  function noteKey(note) {
    return (note.noteId || '') + '|' + (note.title || '');
  }

  function refreshNotebook() {
    if (!UI()) return;
    UI().hideNotebook();
    UI().hideOpenPanelTab && UI().hideOpenPanelTab();
  }

  async function addSelection(text, boardId, source) {
    const sel = String(text || '').trim();
    if (!sel) {
      UI().showToast('先选中一段文字');
      return { ok: false };
    }
    const note = isNotePage() ? extractNoteSignals() : {};
    const r = await send({
      type: 'ADD_CLIP',
      boardId: boardId || '',
      clip: {
        title: note.title || '',
        text: sel,
        topics: note.topics || [],
        url: note.url || location.href,
        noteId: note.noteId || '',
        source: source || 'selection',
        boardId: boardId || ''
      }
    });
    if (r && r.duplicate) return r;
    if (!r.ok) {
      UI().showToast(r.error === 'EMPTY_CLIP' ? '这段是空的' : '没收入去，再点一次');
      return r;
    }
    if (source !== 'note') {
      const board = ((r.session && r.session.boards) || []).filter((b) => b.id === boardId)[0];
      UI().showToast(board ? ('已放进「' + board.name + '」，点整理时 AI 才会读它') : '已收入，在右侧「待整理」里等着');
    }
    refreshNotebook();
    return r;
  }

  async function addWholeNote() {
    ensureSidePanel();
    const key = location.pathname;
    if (key && collectingNote === key) return;
    collectingNote = key;
    try {
      const note = extractNoteSignals();
      const comments = noteCommentsText();
      const text = [note.title, note.body || note.snippet, comments ? ('【评论】\n' + comments) : '']
        .filter(Boolean).join('\n\n');
      if (!text || text.length < 4) {
        UI().showToast('这篇还没加载出文字，稍后再收');
        return;
      }
      await addSelection(text, '', 'note');
    } finally {
      collectingNote = '';
    }
  }

  function noteCommentsText() {
    const bits = [];
    const seen = {};
    document.querySelectorAll('.comment-item, .comment-inner, [class*="comment-item"], [class*="CommentItem"]').forEach((el) => {
      const t = (el.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (!t || t.length < 4 || t.length > 2500) return;
      if (seen[t]) return;
      seen[t] = 1;
      bits.push(t);
    });
    if (!bits.length) {
      const box = document.querySelector('.comments-container, .comment-list, #comments, [class*="comments"]');
      if (box) {
        const t = (box.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
        if (t.length > 8) bits.push(t.slice(0, MAX_CLIP_TEXT - 2000));
      }
    }
    return bits.slice(0, 40).join('\n\n').slice(0, MAX_CLIP_TEXT - 2000);
  }

  function hideNoteSurfaces() {
    if (!UI()) return;
    UI().hideSaveNote && UI().hideSaveNote();
    UI().hideDrift && UI().hideDrift();
    UI().hideImgChip && UI().hideImgChip();
  }

  function hideLightboxSurface() {
    if (!UI()) return;
    UI().hideLightboxChip && UI().hideLightboxChip();
  }

  async function saveAndOcrImage(img) {
    if (!img || collectingImage) return;
    const src = img.currentSrc || img.src;
    if (!src) {
      UI().showToast('没找到这张图');
      return;
    }
    collectingImage = true;
    UI().showToast('正在收集并识别这张图…');
    try {
      const note = isNotePage() ? extractNoteSignals() : {};
      const payload = {
        type: 'ADD_IMAGE_CLIP',
        title: note.title || '',
        topics: note.topics || [],
        srcUrl: location.href
      };
      if (src.indexOf('data:') === 0) {
        payload.dataUrl = src;
      } else if (src.indexOf('blob:') === 0) {
        try {
          const blob = await fetch(src).then((r) => r.blob());
          payload.dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          });
        } catch (_) {
          UI().showToast('这张图读不出来');
          return;
        }
      } else {
        payload.url = src;
      }
      const r = await send(payload);
      if (!r.ok) {
        UI().showToast(r.error || '这张图没收进去');
        return;
      }
      const kb = r.clip && r.clip.image ? Math.round(r.clip.image.bytes / 1024) : 0;
      UI().showToast(r.hasText
        ? '图已收，图里的字也抽出来了（' + kb + 'KB）'
        : '图已收（' + kb + 'KB），但没认出文字');
      refreshNotebook();
    } finally {
      collectingImage = false;
    }
  }

  function collectLightboxImage() {
    const img = UI() && UI().lightboxPhoto && UI().lightboxPhoto();
    saveAndOcrImage(img);
  }

  function restoreNoteSurface() {
    if (!isNotePage()) return;
    if (gateDecision === 'browse') showCollectChip();
    else if (gateDecision === 'search' && lastClassifyLabel === 'drifting') {
      showDriftChip(extractNoteSignals(), null);
    } else if (gateDecision === 'search' && lastClassifyLabel) {
      showCollectChip();
    }
  }

  function syncLightboxSurface() {
    if (!UI() || !UI().isLightboxOpen) return false;
    if (gateDecision !== 'search' && gateDecision !== 'browse') {
      hideLightboxSurface();
      return false;
    }
    if (UI().isLightboxOpen()) {
      if (lbCloseTimer) {
        clearTimeout(lbCloseTimer);
        lbCloseTimer = 0;
      }
      UI().hideSaveNote && UI().hideSaveNote();
      UI().hideDrift && UI().hideDrift();
      UI().showLightboxChip && UI().showLightboxChip(collectLightboxImage);
      return true;
    }
    if (!document.getElementById('fg-lbchip')) return false;
    if (lbCloseTimer) return false;
    lbCloseTimer = setTimeout(() => {
      lbCloseTimer = 0;
      if (UI().isLightboxOpen && UI().isLightboxOpen()) return;
      hideLightboxSurface();
      restoreNoteSurface();
    }, 160);
    return false;
  }

  function bindLightbox() {
    if (window.__fgLbBound) return;
    window.__fgLbBound = true;
    let tick = 0;
    const kick = () => {
      if (tick) return;
      tick = setTimeout(() => {
        tick = 0;
        syncLightboxSurface();
      }, 80);
    };
    document.addEventListener('click', () => {
      kick();
      [80, 200, 450].forEach((ms) => setTimeout(syncLightboxSurface, ms));
    }, true);
    document.addEventListener('keydown', kick, true);
    window.addEventListener('resize', kick);
    const mo = new MutationObserver(kick);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function showCollectChip() {
    if (!UI()) return;
    if (UI().isLightboxOpen && UI().isLightboxOpen()) {
      syncLightboxSurface();
      return;
    }
    UI().hideDrift && UI().hideDrift();
    UI().showSaveNote(() => addWholeNote());
  }

  function showDriftChip(note, result) {
    if (!UI()) return;
    if (UI().isLightboxOpen && UI().isLightboxOpen()) {
      syncLightboxSurface();
      return;
    }
    UI().hideSaveNote && UI().hideSaveNote();
    UI().showDrift({
      onBack: () => {
        ensureSidePanel();
        send({ type: 'DRIFT_ACTION', action: 'back_to_search', payload: note });
        UI().hideDrift();
        location.href = (result && result.searchUrl) || searchUrl();
      },
      onCorrect: async () => {
        await send({ type: 'DRIFT_ACTION', action: 'related', payload: note });
        lastClassifyLabel = 'on_goal';
        showCollectChip();
        updateMode();
        refreshNotebook();
      }
    });
  }

  async function classifyCurrentNote() {
    if (gateDecision !== 'search' || !isNotePage()) return;
    const note = extractNoteSignals();
    const key = noteKey(note);
    if (!note.title && !note.snippet) return;
    if (key === lastNoteKey) return;
    const result = await send({ type: 'CLASSIFY_NOTE', note });
    lastNoteKey = key;
    lastClassifyLabel = (result && result.label) || 'unknown';
    updateMode();
    refreshNotebook();
    if (lastClassifyLabel === 'drifting') showDriftChip(note, result);
    else showCollectChip();
  }

  function scheduleNoteWatch() {
    if (noteWatchTimer) clearTimeout(noteWatchTimer);
    let tries = 0;
    const tick = () => {
      tries += 1;
      const note = extractNoteSignals();
      if (note.title || tries >= 6) classifyCurrentNote();
      else noteWatchTimer = setTimeout(tick, 450);
    };
    lastNoteKey = '';
    noteWatchTimer = setTimeout(tick, 400);
  }

  function syncNoteCapture() {
    if (!isNotePage() || (gateDecision !== 'search' && gateDecision !== 'browse')) {
      hideNoteSurfaces();
      hideLightboxSurface();
      return;
    }
    if (syncLightboxSurface()) return;
    if (gateDecision === 'browse') {
      showCollectChip();
      return;
    }
    hideNoteSurfaces();
    scheduleNoteWatch();
  }

  function startSearchMode() {
    send({ type: 'GET_SESSION' }).then((data) => {
      if (data && data.settings) applyFocusSettings(data.settings);
      checkAndBlockHomepage();
    });
    refreshNotebook();
    syncNoteCapture();
    if (liveBound) return;
    liveBound = true;

    let lastHref = location.href;
    const observer = new MutationObserver(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      lastClassifyLabel = null;
      hideNoteSurfaces();
      hideLightboxSurface();
      UI() && UI().hideDiandianChip && UI().hideDiandianChip();
      updateMode();
      setTimeout(checkAndBlockHomepage, 300);
      syncNoteCapture();
      if (!isNotePage()) refreshNotebook();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    bindDiandian();
    bindLightbox();
  }

  const MAX_DIANDIAN_IMAGES = 6;
  const MAX_DIANDIAN_FILL_TRIES = 2;
  let lastDiandianKw = '';
  let diandianPanelOpen = false;
  let diandianOpenGen = 0;
  let diandianFillT1 = 0;
  let diandianFillT2 = 0;

  function fieldText(el) {
    if (!el) return '';
    if (el.isContentEditable) return String(el.textContent || '').trim();
    return String(el.value || '').trim();
  }

  // 点点编辑器里常夹着「+」按钮文案；比较时去掉，避免误判成用户已输入
  function diandianFieldValue(el) {
    return fieldText(el).replace(/[＋+]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isKeywordNoise(cur, kw) {
    if (!kw) return !cur;
    if (!cur) return true;
    if (cur === kw) return true;
    const compact = cur.replace(/\s+/g, '');
    const k = String(kw).replace(/\s+/g, '');
    if (!k) return false;
    if (compact === k) return true;
    return compact.length % k.length === 0 && compact.split(k).join('') === '';
  }

  function assignField(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const tracker = el._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue('');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    }
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function nativeFill(el, value) {
    if (!el) return false;
    const want = String(value || '');
    if (diandianFieldValue(el) === want.trim()) return true;
    el.focus();
    let selected = false;
    try {
      if (typeof el.select === 'function') {
        el.select();
        selected = true;
      } else if (el.isContentEditable) {
        selected = document.execCommand('selectAll', false, null);
      }
    } catch (_) {}
    // 已有内容时绝不能裸 insertText：选区没盖住就会往后面拼
    const empty = !fieldText(el);
    if (empty || selected) {
      try {
        if (document.execCommand('insertText', false, want) && diandianFieldValue(el) === want.trim()) return true;
      } catch (_) {}
    }
    assignField(el, want);
    return diandianFieldValue(el) === want.trim();
  }

  function looksLikeDiandianField(el) {
    const ph = [
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-placeholder'),
      el.dataset && el.dataset.placeholder
    ].join(' ');
    return /点点|问点点|搜或者|任何问题/.test(ph.replace(/\s+/g, ''));
  }

  function diandianFields() {
    const nodes = document.querySelectorAll('input, textarea, [contenteditable="true"]');
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      if (looksLikeDiandianField(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function visibleDiandianFields() {
    return diandianFields().filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 16 && r.bottom > 0 && r.top < window.innerHeight;
    });
  }

  function fillDiandian() {
    const kw = (searchKeyword || '').trim();
    if (!kw) return false;
    const fields = visibleDiandianFields();
    fields.forEach((el) => {
      const cur = diandianFieldValue(el);
      if (cur === kw) {
        lastDiandianKw = kw;
        return;
      }
      const ours = !cur || isKeywordNoise(cur, lastDiandianKw) || isKeywordNoise(cur, kw);
      if (!ours) return;
      nativeFill(el, kw);
      if (diandianFieldValue(el) === kw || isKeywordNoise(diandianFieldValue(el), kw)) {
        lastDiandianKw = kw;
      }
    });
    return fields.length > 0;
  }

  function attemptDiandianFill() {
    if (shouldBlockDiandian()) {
      checkAndBlockHomepage();
      return true;
    }
    const fields = visibleDiandianFields();
    if (!fields.length) return false;
    const kw = (searchKeyword || '').trim();
    if (kw && diandianFieldValue(fields[0]) === kw) {
      lastDiandianKw = kw;
      return true;
    }
    fillDiandian();
    return !kw || diandianFieldValue(fields[0]) === kw;
  }

  function scheduleDiandianOpenFill() {
    diandianOpenGen += 1;
    const gen = diandianOpenGen;
    let tries = 0;
    const run = () => {
      if (gen !== diandianOpenGen) return;
      if (tries >= MAX_DIANDIAN_FILL_TRIES) return;
      if (shouldBlockDiandian()) {
        checkAndBlockHomepage();
        return;
      }
      if (!visibleDiandianFields().length) return;
      tries += 1;
      attemptDiandianFill();
    };
    if (diandianFillT1) clearTimeout(diandianFillT1);
    if (diandianFillT2) clearTimeout(diandianFillT2);
    diandianFillT1 = setTimeout(run, 360);
    diandianFillT2 = setTimeout(run, 1200);
  }

  function showDiandianCollect() {
    if (!UI() || !UI().showDiandianChip) return;
    UI().showDiandianChip(() => collectDiandian());
  }

  function isDiandianTrigger(el) {
    let node = el;
    for (let i = 0; i < 6 && node && node !== document.body; i += 1) {
      const aria = (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) || '';
      const own = Array.prototype.filter.call(node.childNodes || [], (n) => n.nodeType === 3)
        .map((n) => String(n.textContent || '').trim()).join('');
      const label = (own || aria).replace(/\s+/g, '');
      if (label && label.length <= 10 && /点点/.test(label)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function bindDiandian() {
    document.addEventListener('click', (e) => {
      if (gateDecision !== 'search' && gateDecision !== 'browse') return;
      if (!isDiandianTrigger(e.target)) return;
      scheduleDiandianOpenFill();
    }, true);
    let tick = 0;
    const watch = new MutationObserver(() => {
      if (tick) return;
      tick = setTimeout(() => {
        tick = 0;
        if (gateDecision !== 'search' && gateDecision !== 'browse') return;
        if (shouldBlockDiandian()) {
          diandianPanelOpen = false;
          UI() && UI().hideDiandianChip && UI().hideDiandianChip();
          checkAndBlockHomepage();
          return;
        }
        const panel = UI() && UI().diandianPanel && UI().diandianPanel();
        const fields = visibleDiandianFields();
        const open = Boolean(panel) || fields.length > 0;
        if (!open) {
          if (diandianPanelOpen) {
            diandianPanelOpen = false;
            UI() && UI().hideDiandianChip && UI().hideDiandianChip();
          }
          return;
        }
        const justOpened = !diandianPanelOpen;
        diandianPanelOpen = true;
        if (justOpened) scheduleDiandianOpenFill();
        const answered = (UI().diandianHasAnswer && UI().diandianHasAnswer(panel))
          || scrapeDiandian().text.length >= 40;
        if (answered) showDiandianCollect();
        else UI() && UI().hideDiandianChip && UI().hideDiandianChip();
      }, 280);
    });
    watch.observe(document.documentElement, { childList: true, subtree: true });
  }

  function shouldBlockDiandian() {
    const searching = gateDecision === 'search';
    const active = searching && (focusModePref === 'on' || focusModePref === 'auto');
    return active && isDiandianChannel() && channelDecision('diandian') === 'block';
  }

  function scrapeDiandian() {
    const ui = UI() || {};
    let root = ui.diandianPanel && ui.diandianPanel();
    const input = diandianFields()[0];
    if (!root && input) {
      root = input.closest('aside, [class*="drawer"], [class*="side"], [class*="panel"], [class*="assistant"]');
    }
    if (!root && input) {
      root = input.parentElement;
      while (root && root !== document.body && (root.innerText || '').length < 240) {
        root = root.parentElement;
      }
    }
    if (!root || root === document.body) return { text: '', imgs: [] };
    const raw = (ui.diandianDeepText && ui.diandianDeepText(root))
      || (root.innerText || '');
    const text = raw.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CLIP_TEXT);
    const imgs = [];
    const seen = {};
    const collectImgs = (node) => {
      if (!node || !node.querySelectorAll) return;
      node.querySelectorAll('img').forEach((img) => {
        if (imgs.length >= MAX_DIANDIAN_IMAGES) return;
        const src = img.currentSrc || img.src;
        if (!src || seen[src]) return;
        if ((img.naturalWidth || img.width || 0) < 80) return;
        seen[src] = 1;
        imgs.push(src);
      });
      node.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) collectImgs(el.shadowRoot);
      });
    };
    collectImgs(root);
    return { text, imgs };
  }

  async function collectDiandian() {
    ensureSidePanel();
    const pack = scrapeDiandian();
    if (!pack.text || pack.text.length < 8) {
      UI().showToast('点点还没给出内容，稍后再收');
      return;
    }
    UI().showToast('正在收入点点回答…');
    const note = isNotePage() ? extractNoteSignals() : {};
    const textR = await send({
      type: 'ADD_CLIP',
      clip: {
        title: (searchKeyword || note.title || '') + '（点点）',
        text: pack.text,
        topics: note.topics || [],
        url: location.href,
        source: 'diandian'
      }
    });
    if (!textR.ok) {
      UI().showToast(textR.error || '点点回答没收进去');
      return;
    }
    let imgOk = 0;
    for (let i = 0; i < pack.imgs.length; i += 1) {
      const r = await send({
        type: 'ADD_IMAGE_CLIP',
        url: pack.imgs[i],
        title: (searchKeyword || '') + '（点点配图）',
        srcUrl: location.href
      });
      if (r && r.ok) imgOk += 1;
      else break;
    }
    UI().showToast(imgOk
      ? ('点点回答已收，顺带收了 ' + imgOk + ' 张图')
      : '点点回答已收');
    refreshNotebook();
  }

  function enterBrowseQuietly(kw) {
    const next = String(kw || searchKeyword || '').trim();
    if (next) searchKeyword = next;
    gateDecision = 'browse';
    sessionStorage.setItem('fg_xhs_decision', 'browse');
    if (searchKeyword) sessionStorage.setItem('fg_xhs_keyword', searchKeyword);
    currentMode = 'idle';
    UI() && UI().hideGate && UI().hideGate();
    UI() && UI().hideFocusCard && UI().hideFocusCard();
    startSearchMode();
  }

  function promptPurposeGate(fallbackKw) {
    chrome.storage.local.get(STORAGE_KEY_KEYWORD).then((data) => {
      UI().showGate({
        defaultKeyword: data[STORAGE_KEY_KEYWORD] || fallbackKw || searchKeyword || '',
        onSearch: beginSearch,
        onBrowse: beginBrowse
      });
    }).catch(() => {
      UI().showGate({
        defaultKeyword: fallbackKw || searchKeyword || '',
        onSearch: beginSearch,
        onBrowse: beginBrowse
      });
    });
  }

  function applyLiveMode(mode, toast, intent) {
    hideNoteSurfaces();
    if (mode === 'browse') {
      enterBrowseQuietly(intent || searchKeyword);
    } else {
      const kw = String(intent || searchKeyword || '').trim();
      UI() && UI().hideFocusCard && UI().hideFocusCard();
      if (!kw) {
        gateDecision = null;
        sessionStorage.removeItem('fg_xhs_decision');
        currentMode = 'idle';
        promptPurposeGate('');
      } else {
        searchKeyword = kw;
        gateDecision = 'search';
        sessionStorage.setItem('fg_xhs_decision', 'search');
        sessionStorage.setItem('fg_xhs_keyword', kw);
        UI() && UI().hideGate && UI().hideGate();
        currentMode = getModeForCurrentPage();
        startSearchMode();
        checkAndBlockHomepage();
      }
    }
    if (toast && UI() && UI().showToast) UI().showToast(toast);
    updateMode();
    refreshNotebook();
    syncNoteCapture();
  }

  function checkAndBlockHomepage() {
    const searching = gateDecision === 'search';
    const active = searching && (focusModePref === 'on' || focusModePref === 'auto');
    if (gateDecision === 'browse' || focusModePref === 'off' || !active || !isForcedFocusChannel()) {
      UI() && UI().hideFocusCard && UI().hideFocusCard();
      return;
    }
    send({ type: 'GET_SESSION' }).then((data) => {
      if (data && data.settings) applyFocusSettings(data.settings);
      const keywords = (data && data.session && data.session.keywords) || [];
      UI().showFocusCard({
        intent: searchKeyword,
        keywords,
        onContinue: () => {
          ensureSidePanel();
          UI().hideFocusCard();
          location.href = searchUrl();
        },
        onKeyword: (kw) => {
          ensureSidePanel();
          UI().hideFocusCard();
          followKeyword(kw);
        }
      });
    });
  }

  function followKeyword(kw) {
    const next = String(kw || '').trim();
    if (!next) return;
    ensureSidePanel();
    searchKeyword = next;
    sessionStorage.setItem('fg_xhs_keyword', next);
    chrome.storage.local.set({ [STORAGE_KEY_KEYWORD]: next });
    send({ type: 'DRIFT_ACTION', action: 'change_intent', payload: { intent: next } });
    location.href = searchUrl();
  }

  async function beginSearch(kw) {
    ensureSidePanel();
    searchKeyword = kw;
    gateDecision = 'search';
    sessionStorage.setItem('fg_xhs_decision', 'search');
    sessionStorage.setItem('fg_xhs_keyword', kw);
    chrome.storage.local.set({ [STORAGE_KEY_KEYWORD]: kw });
    await send({ type: 'START_SEARCH_SESSION', intent: kw, platform: 'xiaohongshu' });
    UI().hideGate();
    currentMode = 'active';
    location.href = searchUrl();
  }

  async function beginBrowse(kw) {
    ensureSidePanel();
    searchKeyword = kw || searchKeyword || '';
    if (searchKeyword) {
      chrome.storage.local.set({ [STORAGE_KEY_KEYWORD]: searchKeyword });
    }
    enterBrowseQuietly(searchKeyword);
    const entryP = send({ type: 'GET_XHS_ENTRY' });
    const modeP = send({ type: 'SET_PRODUCT_MODE', mode: 'browse' });
    const data = await entryP;
    await modeP;
    if (!data.startedAt) {
      await send({
        type: 'START_SEARCH_SESSION',
        intent: searchKeyword || '',
        platform: 'xiaohongshu',
        keepBrowseSilence: true,
        productMode: 'browse'
      });
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_LIVE_SECONDS') {
      const seconds = Math.floor((Date.now() - lastCounted) / 1000);
      sendResponse({ seconds, mode: currentMode });
    }
    if (msg.type === 'FG_SESSION_UPDATED') {
      refreshNotebook();
    }
    if (msg.type === 'APPLY_MODE') {
      applyLiveMode(msg.mode, msg.toast, msg.intent);
    }
    if (msg.type === 'ADD_SELECTION') {
      addSelection(msg.text || '');
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.fg_session) refreshNotebook();
    if (area === 'local' && changes.settings) {
      applyFocusSettings((changes.settings.newValue) || {});
      checkAndBlockHomepage();
    }
  });

  function init() {
    const prevDecision = sessionStorage.getItem('fg_xhs_decision');
    const prevKw = sessionStorage.getItem('fg_xhs_keyword') || '';
    if (prevDecision === 'search' || prevDecision === 'browse') {
      gateDecision = prevDecision;
      searchKeyword = prevKw;
      currentMode = getModeForCurrentPage();
      startSearchMode();
      return;
    }
    send({ type: 'GET_XHS_ENTRY', forInit: true }).then((data) => {
      if (data && data.browseSilence) {
        enterBrowseQuietly(prevKw || (data.intent || ''));
        return;
      }
      promptPurposeGate(prevKw || (data && data.intent) || '');
    });
  }

  function boot() {
    if (!UI()) return setTimeout(boot, 30);
    UI().injectStyles();
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') forceReport();
    else lastCounted = Date.now();
  });
  window.addEventListener('pagehide', forceReport);
  setInterval(reportTime, 15000);
})();
