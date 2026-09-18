(function (root) {
  'use strict';

  const ASSET = 'panel-assets/';
  let opts = { send: null, onSearch: null, assetBase: ASSET };
  let rootEl = null;
  let tab = 'inbox';
  let sheet = '';
  let editing = null;
  let confirmDel = null;
  let notes = [];
  let ai = null;
  let session = { clips: [], boards: [], intent: '', productMode: 'search', showRedo: false };
  let toastTimer = 0;
  let openId = '';
  let renaming = null;
  let painting = false;
  let cardClickTimer = 0;
  let lastScrolledOpen = '';
  let histOpen = '';
  let histClickTimer = 0;
  let uiSettings = { hasKey: false, focusMode: 'auto', channelPolicy: {}, keyHint: '' };

  const CHANNELS = [
    ['home', '首页'],
    ['diandian', '点点'],
    ['red', 'RED'],
    ['live', '直播'],
    ['publish', '发布'],
    ['notify', '通知'],
    ['message', '消息'],
    ['profile', '我的']
  ];
  const CHANNEL_DEFAULT_ON = { home: true, red: true, live: true };

  function send(msg) {
    if (opts.send) return opts.send(msg);
    return new Promise((resolve) => {
      if (!chrome.runtime || !chrome.runtime.sendMessage) return resolve({ ok: false });
      chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r || { ok: false }); });
    });
  }
  function asset(name) { return (opts.assetBase || ASSET) + name; }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function unread() { return (session.clips || []).filter((c) => !c.analyzed); }
  function toast(msg) {
    const el = rootEl && rootEl.querySelector('.fgp-toast');
    if (!el) return;
    clearTimeout(toastTimer);
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.hidden = true;
    void el.offsetWidth;
    el.hidden = false;
    toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
  }
  function ackRedo() {
    if (!session.showRedo) return;
    session.showRedo = false;
    send({ type: 'ACK_REDO' });
    paint();
  }

  function mount(el, options) {
    rootEl = el;
    opts = Object.assign({ send: null, onSearch: null, assetBase: ASSET }, options || {});
    el.innerHTML = '<div class="fgp"></div>';
    el.addEventListener('click', onClick);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('input', onInput);
    el.addEventListener('focusout', onFocusOut);
    el.addEventListener('paste', onPaste);
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', onDrop);
    el.addEventListener('keydown', onKey);
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.fg_session) refresh();
      });
    }
    refresh();
    return api;
  }

  async function refresh() {
    const r = await send({ type: 'GET_SESSION' });
    session = (r && r.session) || session;
    ai = (r && r.ai) || ai;
    if (r && r.settings) {
      uiSettings = {
        hasKey: Boolean(r.hasKey || r.settings.hasKey),
        focusMode: r.settings.focusMode === 'on' || r.settings.focusMode === 'off' ? r.settings.focusMode : 'auto',
        channelPolicy: r.settings.channelPolicy || {},
        keyHint: r.keyHint || ''
      };
    }
    if (tab !== 'inbox' && !(session.boards || []).some((b) => b.id === tab)) tab = 'inbox';
    paint();
  }

  function paint() {
    if (!rootEl) return;
    painting = true;
    const host = rootEl.querySelector('.fgp') || rootEl;
    const prevBody = host.querySelector('.fgp-body');
    const prevScroll = prevBody ? prevBody.scrollTop : 0;
    const focusOn = session.productMode !== 'browse';
    const boards = session.boards || [];
    const pending = unread().length;
    const onInbox = tab === 'inbox';
    const board = boards.filter((b) => b.id === tab)[0];
    const showGo = onInbox && pending > 0;
    const showRedo = !onInbox && session.showRedo && !showGo;
    const bodyEmpty = onInbox
      ? !(session.clips || []).length
      : Boolean(board && !(board.cards || []).length && !clipsOnBoard(board).length);

    host.innerHTML = `
      <div class="fgp-head">
        <button type="button" class="fgp-focus" data-act="focus" data-tip="${focusOn ? '专注模式开着' : '专注模式关了'}">
          专注模式
          <img src="${asset(focusOn ? 'toggle-on.svg' : 'toggle-off.svg')}" alt="">
        </button>
        <div class="fgp-icons">${headIconsHtml()}</div>
      </div>
      <hr class="fgp-rule">
      <div class="fgp-tabs">${tabsInnerHtml()}</div>
      <div class="fgp-body${bodyEmpty ? ' is-empty' : ''}" data-act="body">
        ${onInbox ? inboxHtml() : boardHtml(board)}
      </div>
      ${showGo || showRedo ? `<div class="fgp-dock">
        ${showGo
          ? `<button type="button" class="fgp-pill is-go" data-act="organize" ${session.organizing ? 'disabled' : ''}>
              <span class="fgp-pill-row"><span class="fgp-pill-ico"><span class="fgp-pill-logo"><img src="${asset('icon-logo-black.svg')}" alt=""></span></span>${session.organizing ? '整理中…' : '快速整理'}</span>
            </button>`
          : `<button type="button" class="fgp-pill is-redo" data-act="redo">
              <span class="fgp-pill-row"><span class="fgp-pill-ico"><span class="fgp-pill-logo"><img src="${asset('icon-logo.svg')}" alt=""></span></span>重新生成本次整理</span>
            </button>`}
      </div>` : ''}
      ${sheet ? `<div class="fgp-sheet${sheet === 'history' || sheet === 'settings' ? ' is-page' : ''}${sheet === 'history' ? ' is-hist' : ''}${sheet === 'settings' ? ' is-set' : ''}">${sheetHtml()}</div>` : ''}
      ${confirmDel ? confirmHtml() : ''}
      <div class="fgp-toast" hidden></div>
    `;
    painting = false;
    const newBody = host.querySelector('.fgp-body');
    if (newBody) newBody.scrollTop = prevScroll;
    if (renaming) requestAnimationFrame(focusRename);
    else if (editing && editing.inline) requestAnimationFrame(focusCardEdit);
    else if (openId && openId !== lastScrolledOpen) requestAnimationFrame(scrollOpenCard);
    lastScrolledOpen = openId || '';
  }

  function iconBtn(act, tip, file) {
    return `<button type="button" class="fgp-icon" data-act="${act}" data-tip="${esc(tip)}"><img src="${asset(file)}" alt=""></button>`;
  }

  function headIconsHtml() {
    return iconBtn('export', '导出 Markdown', 'icon-export.svg')
      + iconBtn('new', '新建笔记', 'icon-new.svg')
      + iconBtn('history', '查看历史记录', 'icon-history.svg')
      + iconBtn('settings', '设置', 'icon-settings.svg');
  }

  function tabsInnerHtml() {
    const boards = session.boards || [];
    return `${tabHtml('inbox', '收集箱', false)}
        ${boards.map((b) => tabHtml(b.id, b.name, true)).join('')}
        ${renaming && renaming.isNew ? tabHtml('__new__', renaming.name, false) : ''}
        <button type="button" class="fgp-plus" data-act="add-tab"><img src="${asset('icon-plus.svg')}" alt=""></button>`;
  }

  function paintTabs(expandNew) {
    const tabsEl = rootEl && rootEl.querySelector('.fgp-tabs');
    if (!tabsEl) return paint();
    painting = true;
    tabsEl.innerHTML = tabsInnerHtml();
    painting = false;
    const neo = expandNew && tabsEl.querySelector('.fgp-tab.is-edit');
    if (neo) {
      neo.classList.add('is-grow');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          neo.classList.add('is-in');
          focusRename();
        });
      });
      return;
    }
    if (renaming) requestAnimationFrame(focusRename);
  }

  function applyCardOpen() {
    if (!rootEl) return;
    const editId = editing && editing.inline ? editing.id : '';
    rootEl.querySelectorAll('.fgp-card-wrap').forEach((wrap) => {
      const id = wrap.getAttribute('data-id');
      const on = openId === id;
      wrap.classList.toggle('is-on', on && id !== editId);
      wrap.classList.toggle('is-edit', id === editId);
      const card = wrap.querySelector('.fgp-card');
      if (card) card.classList.toggle('is-open', on || id === editId);
    });
    if (openId && openId !== lastScrolledOpen) requestAnimationFrame(scrollOpenCard);
    lastScrolledOpen = openId || '';
  }

  function applyHistOpen() {
    if (!rootEl) return;
    rootEl.querySelectorAll('.fgp-note-wrap').forEach((wrap) => {
      wrap.classList.toggle('is-on', wrap.getAttribute('data-id') === histOpen);
    });
  }

  function scrollOpenCard() {
    const body = rootEl && rootEl.querySelector('.fgp-body');
    const card = rootEl && rootEl.querySelector('.fgp-card.is-open');
    if (!body || !card) return;
    const top = body.scrollTop + card.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function tabHtml(id, name, canDelete) {
    const editingThis = renaming && renaming.id === id;
    const on = editingThis || (!renaming && tab === id);
    if (editingThis) {
      const empty = !String(renaming.name || '').length;
      return `<span class="fgp-tab is-on is-edit${empty ? ' is-empty' : ''}">
        <input class="fgp-tab-input" data-act="rename-input" data-tab="${esc(id)}" value="${esc(renaming.name)}" maxlength="16" spellcheck="false">
        <span class="fgp-tab-caret" aria-hidden="true"><img src="${asset('tab-caret.svg')}" alt=""></span>
      </span>`;
    }
    return `<button type="button" class="fgp-tab${on ? ' is-on' : ''}" data-act="tab" data-tab="${esc(id)}" data-name="${esc(name)}">
      <span class="fgp-tab-name">${esc(name)}</span>
      ${canDelete ? `<span class="fgp-tab-x" data-act="del-tab" data-tab="${esc(id)}" data-name="${esc(name)}" title="删除分区"><img src="${asset('icon-delete.svg')}" alt=""></span>` : ''}
    </button>`;
  }

  function focusRename() {
    const input = rootEl && rootEl.querySelector('.fgp-tab-input');
    if (!input) return;
    input.focus();
    const n = input.value.length;
    try { input.setSelectionRange(n, n); } catch (_) {}
  }

  function sizeCardEdit(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, 48) + 'px';
  }

  function focusCardEdit() {
    const el = rootEl && rootEl.querySelector('[data-act="card-edit"]');
    if (!el) return;
    el.focus();
    sizeCardEdit(el);
    try {
      const n = el.value.length;
      el.setSelectionRange(n, n);
    } catch (_) {}
  }

  function findCard(id) {
    let card = null;
    (session.boards || []).forEach((b) => {
      (b.cards || []).forEach((c) => { if (c.id === id) card = c; });
    });
    return card;
  }

  function beginInlineEdit(id) {
    if (!id) return;
    clearTimeout(cardClickTimer);
    cardClickTimer = 0;
    if (editing && editing.inline && editing.id === id) return;
    const clip = (session.clips || []).filter((x) => x.id === id)[0];
    if (clip) {
      ackRedo();
      openId = id;
      editing = { kind: 'clip', id, title: clip.title, text: clip.text || '', inline: true };
      return paint();
    }
    const card = findCard(id);
    if (!card) return;
    ackRedo();
    openId = id;
    editing = { kind: 'card', id, title: card.title || '', body: card.body || '', inline: true };
    return paint();
  }

  async function commitCardEdit() {
    if (!editing || !editing.inline) return;
    const el = rootEl && rootEl.querySelector('[data-act="card-edit"]');
    const raw = el ? el.value : (editing.kind === 'clip' ? editing.text : (editing.title ? editing.title + '\n' + editing.body : editing.body));
    const was = editing;
    editing = null;
    if (was.kind === 'clip') {
      const prev = String(was.text || '');
      if (raw === prev) return paint();
      await send({ type: 'EDIT_CLIP', clipId: was.id, text: raw });
      return refresh();
    }
    let title = was.title;
    let body = raw;
    if (was.title) {
      const i = raw.indexOf('\n');
      title = i === -1 ? raw : raw.slice(0, i);
      body = i === -1 ? '' : raw.slice(i + 1);
    }
    if (title === was.title && body === was.body) return paint();
    await send({ type: 'EDIT_CARD', cardId: was.id, title: title, body: body });
    return refresh();
  }

  function cancelCardEdit() {
    if (!editing || !editing.inline) return;
    editing = null;
    paint();
  }

  function byNewest(a, b) {
    return (b.at || 0) - (a.at || 0);
  }

  function inboxClips() {
    const clips = (session.clips || []).slice();
    const fresh = clips.filter((c) => !c.analyzed).sort(byNewest);
    const read = clips.filter((c) => c.analyzed).sort(byNewest);
    return fresh.concat(read);
  }

  function inboxHtml() {
    const clips = inboxClips();
    if (!clips.length) return `<p class="fgp-hint">粘贴图片或文字到这里</p>`;
    return `<div class="fgp-list">${clips.map(clipCard).join('')}</div>`;
  }

  function clipsOnBoard(board) {
    if (!board) return [];
    const used = Object.create(null);
    (board.cards || []).forEach((card) => {
      (card.fromClipIds || []).forEach((id) => { used[id] = true; });
    });
    return (board.clipIds || []).map((id) => {
      const clip = (session.clips || []).filter((c) => c.id === id)[0];
      return clip && !used[clip.id] ? clip : null;
    }).filter(Boolean).sort(byNewest);
  }

  function pasteBoardId() {
    if (tab === 'inbox') return '';
    const board = (session.boards || []).filter((b) => b.id === tab)[0];
    return board ? board.id : '';
  }

  function capDelBtn(act, id) {
    return `<button type="button" class="fgp-cap-btn" data-act="${act}" data-id="${esc(id)}">
            <img src="${asset('icon-trash.svg')}" alt="">删除
          </button>`;
  }

  function clipCard(c) {
    const text = String(c.text || '').trim() || (c.image ? '一张图（没识别出文字）' : (c.title || '一条摘录'));
    const onEdit = editing && editing.inline && editing.id === c.id;
    const open = openId === c.id || onEdit;
    const long = !open && (text.length > 90 || (text.split('\n').length > 4) || c.image);
    const body = onEdit
      ? `<textarea class="fgp-card-edit" data-act="card-edit" rows="4">${esc(editing.text != null ? editing.text : text)}</textarea>`
      : `<p class="fgp-card-b">${esc(text)}</p>`;
    return `<div class="fgp-card-wrap${open && !onEdit ? ' is-on' : ''}${onEdit ? ' is-edit' : ''}" data-id="${esc(c.id)}">
      <article class="fgp-card${c.analyzed ? ' is-read' : ''}${open ? ' is-open' : ''}" data-act="open-card" data-id="${esc(c.id)}">
      ${c.image ? `<img class="fgp-card-img" src="${esc(c.image.dataUrl)}" alt="">` : ''}
      ${body}
      ${long ? '<div class="fgp-fade"></div>' : ''}
    </article>
      <div class="fgp-cap-slot" aria-hidden="${open && !onEdit ? 'false' : 'true'}">
        <div class="fgp-cap-slot-inner">
          ${capDelBtn('del-clip', c.id)}
        </div>
      </div>
    </div>`;
  }

  function boardHtml(board) {
    if (!board) return `<p class="fgp-hint">这个分区不在了</p>`;
    const cards = (board.cards || []).slice().sort(byNewest);
    const placed = clipsOnBoard(board);
    if (!cards.length && !placed.length) {
      return `<p class="fgp-hint">粘贴图片或文字到这里</p>`;
    }
    const words = (board.keywords || []).length
      ? board.keywords
      : ((session.summary && session.summary.next_searches) || []).map((x) => x.keyword || x).filter(Boolean);
    return `
      <div class="fgp-list">${placed.map(clipCard).join('')}${cards.map(aiCard).join('')}</div>
      ${words.length ? `<div class="fgp-sug">
        <p class="fgp-sug-t">建议继续搜：</p>
        <div class="fgp-chips">${words.map((w) => `<button type="button" class="fgp-chip" data-act="search" data-q="${esc(w)}">${esc(w)}</button>`).join('')}</div>
      </div>` : ''}
    `;
  }

  function aiCard(c) {
    const onEdit = editing && editing.inline && editing.id === c.id;
    const open = openId === c.id || onEdit;
    const long = !open && String(c.body || '').length > 80;
    const editVal = onEdit
      ? (c.title ? String(editing.title || '') + '\n' + String(editing.body || '') : String(editing.body || ''))
      : '';
    return `<div class="fgp-card-wrap${open && !onEdit ? ' is-on' : ''}${onEdit ? ' is-edit' : ''}" data-id="${esc(c.id)}">
      <article class="fgp-card${c.stale ? ' is-stale' : ''}${open ? ' is-open' : ''}" data-act="open-card" data-id="${esc(c.id)}">
      ${onEdit
        ? `<textarea class="fgp-card-edit" data-act="card-edit" rows="6">${esc(editVal)}</textarea>`
        : `<div class="fgp-card-copy">
            ${c.title ? `<p class="fgp-card-t">${esc(c.title)}</p>` : ''}
            <p class="fgp-card-b">${esc(c.body || '')}</p>
          </div>`}
      ${long ? '<div class="fgp-fade"></div>' : ''}
    </article>
      <div class="fgp-cap-slot" aria-hidden="${open && !onEdit ? 'false' : 'true'}">
        <div class="fgp-cap-slot-inner">
          ${capDelBtn('del-card', c.id)}
          <button type="button" class="fgp-cap-btn is-regen" data-act="regen-card" data-card="${esc(c.id)}">
            <span class="fgp-hbtn-ico"><span class="fgp-hbtn-logo"><img src="${asset('icon-logo.svg')}" alt=""></span></span>重新整理
          </button>
        </div>
      </div>
    </div>`;
  }

  function fmtNoteDate(ts) {
    const d = new Date(ts || 0);
    if (!ts || isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function noteHtml(n) {
    const on = histOpen === n.id;
    const boards = (n.boardNames || []).filter(Boolean).join('/');
    return `<div class="fgp-note-wrap${on ? ' is-on' : ''}" data-id="${esc(n.id)}">
      <article class="fgp-note" data-act="hist-card" data-id="${esc(n.id)}">
        <div class="fgp-note-top">
          <p class="fgp-note-t">${esc(n.intent || '未命名')}</p>
          <p class="fgp-note-d">${esc(fmtNoteDate(n.updatedAt))}</p>
        </div>
        ${boards ? `<p class="fgp-note-b">${esc(boards)}</p>` : ''}
      </article>
      <div class="fgp-cap-slot">
        <div class="fgp-cap-slot-inner">
          <button type="button" class="fgp-cap-btn" data-act="del-note" data-id="${esc(n.id)}">
            <img src="${asset('icon-trash.svg')}" alt="">删除
          </button>
        </div>
      </div>
    </div>`;
  }

  function sheetHtml() {
    if (sheet === 'history') {
      return `<div class="fgp-sheet-head">
          <button type="button" class="fgp-back" data-act="close-sheet">
            <img src="${asset('icon-back.svg')}" alt="">返回
          </button>
          <div class="fgp-icons">${headIconsHtml()}</div>
        </div>
        <hr class="fgp-rule">
        <div class="fgp-hist-list">
          ${(notes || []).length
            ? notes.map(noteHtml).join('')
            : '<p class="fgp-hint">还没有存过笔记。整理过的会自动出现在这里。</p>'}
        </div>`;
    }
    if (sheet === 'settings') {
      const pol = uiSettings.channelPolicy || {};
      const rows = CHANNELS.map(([key, name], i) => {
        const on = pol[key] === 'block' || (pol[key] !== 'allow' && CHANNEL_DEFAULT_ON[key]);
        return `${i ? '<hr class="fgp-set-line">' : ''}
            <div class="fgp-set-row">
              <span>${name}</span>
              <button type="button" class="fgp-switch" data-act="set-channel" data-ch="${key}" data-on="${on ? '1' : '0'}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${name}">
                <img src="${asset(on ? 'toggle-on.svg' : 'toggle-off.svg')}" alt="">
              </button>
            </div>`;
      }).join('');
      return `<div class="fgp-sheet-head">
          <button type="button" class="fgp-back" data-act="close-sheet">
            <img src="${asset('icon-back.svg')}" alt="">返回
          </button>
        </div>
        <hr class="fgp-rule">
        <div class="fgp-set">
          <section class="fgp-set-block">
            <p class="fgp-set-k">拦截频道</p>
            <div class="fgp-set-card">${rows}</div>
          </section>
          <section class="fgp-set-block">
            <div class="fgp-set-krow">
              <p class="fgp-set-k">API Key</p>
              <span class="fgp-info" tabindex="0">
                <img src="${asset('icon-info.svg')}" alt="">
                <span class="fgp-info-pop">接上大模型后，整理和搜索推荐会更准。</span>
              </span>
            </div>
            <input class="fgp-set-input" id="fgp-key" type="password" placeholder="${uiSettings.hasKey ? '已保存，要换再贴一条' : '请填写 API Key'}" autocomplete="off" spellcheck="false">
            ${ai && ai.error ? `<p class="fgp-set-err">${esc(ai.error)}</p>` : ''}
            <p class="fgp-set-guide">主流 AI 大模型 API 申请指南<img src="${asset('icon-chevron.svg')}" alt=""></p>
          </section>
        </div>`;
    }
    if (sheet === 'edit' && editing) {
      const title = editing.kind === 'card' ? (editing.title || '') : (editing.title || '');
      const body = editing.kind === 'card' ? (editing.body || '') : (editing.text || '');
      return `<button type="button" class="fgp-back" data-act="close-sheet">← 返回</button>
        <h3>编辑</h3>
        ${editing.kind === 'card' ? `<input class="fgp-field" id="fgp-title" value="${esc(title)}" placeholder="标题">` : ''}
        <textarea class="fgp-edit" id="fgp-body">${esc(body)}</textarea>
        <button type="button" class="fgp-save" data-act="save-edit" style="margin-top:12px">保存</button>`;
    }
    return '';
  }

  function confirmHtml() {
    return `<div class="fgp-confirm"><div class="fgp-confirm-box">
      <p>确认删除整个分区及内容吗？</p>
      <div class="fgp-row">
        <button type="button" class="yes" data-act="del-yes">删除</button>
        <button type="button" class="no" data-act="del-no">取消</button>
      </div>
    </div></div>`;
  }

  async function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) {
      if (sheet === 'history' && histOpen) { histOpen = ''; applyHistOpen(); }
      else if (openId && !(editing && editing.inline)) { openId = ''; applyCardOpen(); }
      return;
    }
    const act = t.getAttribute('data-act');
    if (act === 'focus') {
      const next = session.productMode === 'browse' ? 'search' : 'browse';
      await send({ type: 'SET_PRODUCT_MODE', mode: next });
      await refresh();
      return;
    }
    if (act === 'export') {
      const r = await send({ type: 'EXPORT_MD' });
      if (!r.ok) return toast(r.error || '现在还导不出来');
      const blob = new Blob([r.markdown], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = r.filename || 'note.md';
      a.click();
      toast('已导出 ' + a.download);
      return;
    }
    if (act === 'history') {
      const r = await send({ type: 'LIST_NOTES' });
      notes = (r && r.notes) || [];
      sheet = 'history';
      histOpen = '';
      return paint();
    }
    if (act === 'settings') { sheet = 'settings'; return paint(); }
    if (act === 'close-sheet') { sheet = ''; editing = null; histOpen = ''; return paint(); }
    if (act === 'new') {
      await send({ type: 'NEW_SESSION' });
      tab = 'inbox';
      sheet = '';
      toast('已开一条新的');
      return refresh();
    }
    if (act === 'hist-card') {
      if (e.detail > 1) return;
      const id = t.getAttribute('data-id');
      histOpen = histOpen === id ? '' : id;
      applyHistOpen();
      return;
    }
    if (act === 'del-note') {
      e.stopPropagation();
      clearTimeout(histClickTimer);
      histClickTimer = 0;
      await send({ type: 'DELETE_NOTE', id: t.getAttribute('data-id') });
      const r = await send({ type: 'LIST_NOTES' });
      notes = (r && r.notes) || [];
      histOpen = '';
      return paint();
    }
    if (act === 'del-clip') {
      e.stopPropagation();
      const id = t.getAttribute('data-id');
      await send({ type: 'REMOVE_CLIP', clipId: id });
      if (openId === id) openId = '';
      if (editing && editing.id === id) editing = null;
      return refresh();
    }
    if (act === 'del-card') {
      e.stopPropagation();
      const id = t.getAttribute('data-id');
      await send({ type: 'DELETE_CARD', cardId: id });
      if (openId === id) openId = '';
      if (editing && editing.id === id) editing = null;
      return refresh();
    }
    if (act === 'open-note') {
      await send({ type: 'REOPEN_NOTE', id: t.getAttribute('data-id') });
      tab = 'inbox';
      sheet = '';
      histOpen = '';
      return refresh();
    }
    if (act === 'save-key') {
      await saveApiKey();
      return;
    }
    if (act === 'set-focus-mode') {
      const v = t.getAttribute('data-v');
      uiSettings.focusMode = v;
      t.parentElement.querySelectorAll('.fgp-seg').forEach((b) => b.classList.toggle('is-on', b === t));
      await send({ type: 'SAVE_SETTINGS', focusMode: v });
      if (v === 'on') {
        await send({ type: 'SET_PRODUCT_MODE', mode: 'search' });
        await refresh();
      } else if (v === 'off') {
        await send({ type: 'SET_PRODUCT_MODE', mode: 'browse' });
        await refresh();
      }
      return;
    }
    if (act === 'set-channel') {
      const ch = t.getAttribute('data-ch');
      const on = t.getAttribute('data-on') === '1';
      const next = on ? 'allow' : 'block';
      uiSettings.channelPolicy = Object.assign({}, uiSettings.channelPolicy, { [ch]: next });
      t.setAttribute('data-on', on ? '0' : '1');
      t.setAttribute('aria-pressed', on ? 'false' : 'true');
      const img = t.querySelector('img');
      if (img) img.src = asset(on ? 'toggle-off.svg' : 'toggle-on.svg');
      await send({ type: 'SAVE_SETTINGS', channelPolicy: { [ch]: next } });
      return;
    }
    if (act === 'tab') {
      const id = t.getAttribute('data-tab');
      if (renaming && renaming.id !== id) await commitRename();
      if (tab === id) return;
      tab = id;
      openId = '';
      if (tab === 'inbox') ackRedo();
      return paint();
    }
    if (act === 'add-tab') {
      if (renaming) return;
      renaming = { id: '__new__', name: '', isNew: true };
      return paintTabs(true);
    }
    if (act === 'body') {
      if (openId && !(editing && editing.inline)) { openId = ''; applyCardOpen(); }
      return;
    }
    if (act === 'open-card') {
      if (editing && editing.inline && editing.id === t.getAttribute('data-id')) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length) return;
      if (e.detail > 1) return;
      const id = t.getAttribute('data-id');
      if (editing && editing.inline) return;
      openId = openId === id ? '' : id;
      applyCardOpen();
      return;
    }
    if (act === 'card-edit') return;
    if (act === 'del-tab') {
      e.stopPropagation();
      confirmDel = { id: t.getAttribute('data-tab'), name: t.getAttribute('data-name') };
      return paint();
    }
    if (act === 'del-yes') {
      await send({ type: 'DELETE_BOARD', boardId: confirmDel.id });
      if (tab === confirmDel.id) tab = 'inbox';
      confirmDel = null;
      return refresh();
    }
    if (act === 'del-no') { confirmDel = null; return paint(); }
    if (act === 'organize') {
      toast('正在整理…');
      const r = await send({ type: 'ORGANIZE_NOW' });
      if (!r.ok) return toast(r.error === 'NOTHING_TO_ORGANIZE' ? '没有要整理的' : (r.error || '没整理成'));
      const first = ((r.session && r.session.boards) || [])[0];
      if (first) tab = first.id;
      toast('整理好了');
      return refresh();
    }
    if (act === 'redo') {
      toast('按另一套分法重做…');
      const r = await send({ type: 'REDO_ROUND' });
      if (!r.ok) return toast(r.error === 'NO_ROUND' ? '这一轮已经没得重做了' : (r.error || '没做成'));
      const first = ((r.session && r.session.boards) || [])[0];
      if (first) tab = first.id;
      return refresh();
    }
    if (act === 'search') {
      ackRedo();
      const q = t.getAttribute('data-q');
      await send({ type: 'SEARCH_KEYWORD', keyword: q });
      if (opts.onSearch) opts.onSearch(q);
      return;
    }
    if (act === 'regen-card') {
      if (editing && editing.inline) editing = null;
      toast('重写这张…');
      await send({ type: 'REGEN_CARD', cardId: t.getAttribute('data-card') });
      return refresh();
    }
    if (act === 'save-edit') {
      const body = (rootEl.querySelector('#fgp-body') || {}).value || '';
      const title = (rootEl.querySelector('#fgp-title') || {}).value;
      if (editing.kind === 'clip') await send({ type: 'EDIT_CLIP', clipId: editing.id, text: body });
      else await send({ type: 'EDIT_CARD', cardId: editing.id, title: title, body: body });
      sheet = '';
      editing = null;
      toast('已保存');
      return refresh();
    }
  }

  function onDbl(e) {
    const tabEl = e.target.closest('.fgp-tab');
    if (tabEl) {
      if (e.target.closest('.fgp-tab-x')) return;
      if (tabEl.getAttribute('data-tab') === 'inbox') return;
      if (tabEl.getAttribute('data-tab') !== tab) return;
      if (renaming) return;
      const id = tabEl.getAttribute('data-tab');
      if (!id || id === '__new__') return;
      e.preventDefault();
      renaming = { id, name: tabEl.getAttribute('data-name') || '', isNew: false };
      return paintTabs();
    }
    if (e.target.closest('[data-act="regen-card"], [data-act="del-card"], [data-act="del-clip"]')) return;
    const histCard = e.target.closest('[data-act="hist-card"]');
    if (histCard) {
      if (e.target.closest('[data-act="del-note"]')) return;
      e.preventDefault();
      clearTimeout(histClickTimer);
      histClickTimer = 0;
      const id = histCard.getAttribute('data-id');
      send({ type: 'REOPEN_NOTE', id }).then(() => {
        tab = 'inbox';
        sheet = '';
        histOpen = '';
        refresh();
      });
      return;
    }
    const card = e.target.closest('.fgp-card');
    if (!card) return;
    e.preventDefault();
    beginInlineEdit(card.getAttribute('data-id'));
  }

  function onInput(e) {
    const t = e.target.closest('[data-act="rename-input"]');
    if (t && renaming) {
      renaming.name = t.value;
      const wrap = t.closest('.fgp-tab');
      if (wrap) wrap.classList.toggle('is-empty', !String(t.value || '').length);
      return;
    }
    const edit = e.target.closest('[data-act="card-edit"]');
    if (edit && editing && editing.inline) {
      if (editing.kind === 'clip') editing.text = edit.value;
      else {
        const raw = edit.value;
        if (editing.title) {
          const i = raw.indexOf('\n');
          editing.title = i === -1 ? raw : raw.slice(0, i);
          editing.body = i === -1 ? '' : raw.slice(i + 1);
        } else editing.body = raw;
      }
      sizeCardEdit(edit);
    }
  }

  async function saveApiKey(el) {
    const input = el || (rootEl && rootEl.querySelector('#fgp-key'));
    if (!input) return;
    const key = String(input.value || '').trim();
    if (!key) return;
    const r = await send({ type: 'SAVE_API_CONFIG', apiKey: key });
    uiSettings.hasKey = Boolean(r.hasKey);
    ai = r.ai || ai;
    input.value = '';
    input.placeholder = uiSettings.hasKey ? '已保存，要换再贴一条' : '请填写 API Key';
    const err = rootEl.querySelector('.fgp-set-err');
    if (r.ok) {
      if (err) err.remove();
      toast('已接上');
    } else {
      const msg = r.error || '没连上';
      if (err) err.textContent = msg;
      else {
        const p = document.createElement('p');
        p.className = 'fgp-set-err';
        p.textContent = msg;
        input.insertAdjacentElement('afterend', p);
      }
      toast(msg);
    }
  }

  function onFocusOut(e) {
    if (painting) return;
    if (renaming) {
      const t = e.target && e.target.closest && e.target.closest('[data-act="rename-input"]');
      if (t) commitRename();
    }
    if (editing && editing.inline) {
      const card = e.target && e.target.closest && e.target.closest('.fgp-card');
      const next = e.relatedTarget;
      if (next && card && card.contains(next)) return;
      commitCardEdit();
    }
    if (e.target && e.target.id === 'fgp-key') saveApiKey(e.target);
  }

  async function commitRename() {
    if (!renaming) return;
    const was = renaming;
    const name = String(was.name || '').trim();
    renaming = null;
    if (was.isNew) {
      if (!name) return paintTabs();
      const r = await send({ type: 'CREATE_BOARD', name });
      if (r.ok && r.board) tab = r.board.id;
      return refresh();
    }
    const board = (session.boards || []).filter((b) => b.id === was.id)[0];
    if (!name || (board && name === board.name)) return paintTabs();
    await send({ type: 'RENAME_BOARD', boardId: was.id, name });
    return refresh();
  }

  async function onPaste(e) {
    if (sheet) return;
    if (e.target && e.target.closest && e.target.closest('textarea, input, [contenteditable="true"]')) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const boardId = pasteBoardId();
    const img = [].find.call(cd.items || [], (it) => /^image\//.test(it.type));
    if (img) {
      e.preventDefault();
      ackRedo();
      const file = img.getAsFile();
      const dataUrl = await readFile(file);
      toast('正在收图…');
      const r = await send({ type: 'ADD_IMAGE_CLIP', dataUrl, title: '粘贴进来的图', boardId });
      toast(r.ok ? '图收进来了' : (r.error || '图没进去'));
      return refresh();
    }
    const text = String(cd.getData('text/plain') || '').trim();
    if (!text) return;
    e.preventDefault();
    ackRedo();
    const r = await send({ type: 'ADD_CLIP', clip: { title: '', text, source: 'paste', boardId } });
    toast(r.ok ? ('收下了 ' + text.length + ' 字') : (r.error || '没收进去'));
    return refresh();
  }

  async function onDrop(e) {
    e.preventDefault();
    if (sheet) return;
    ackRedo();
    const dt = e.dataTransfer;
    if (!dt) return;
    const boardId = pasteBoardId();
    let clue = '';
    try { clue = dt.getData('application/fg-clue'); } catch (_) {}
    if (clue) {
      const parsed = JSON.parse(clue);
      toast('正在收图…');
      const r = await send({ type: 'ADD_IMAGE_CLIP', url: parsed.src, title: parsed.title || '', text: parsed.text || '', boardId });
      toast(r.ok ? '图收进来了' : (r.error || '图没进去'));
      return refresh();
    }
    if (dt.files && dt.files[0] && /^image\//.test(dt.files[0].type)) {
      const dataUrl = await readFile(dt.files[0]);
      const r = await send({ type: 'ADD_IMAGE_CLIP', dataUrl, title: dt.files[0].name, boardId });
      toast(r.ok ? '图收进来了' : (r.error || '图没进去'));
      return refresh();
    }
    const text = String(dt.getData('text/plain') || '').trim();
    if (!text) return;
    const r = await send({ type: 'ADD_CLIP', clip: { title: '', text, source: 'drag', boardId } });
    toast(r.ok ? ('收下了 ' + text.length + ' 字') : (r.error || '没收进去'));
    return refresh();
  }

  function onKey(e) {
    if (e.target && e.target.id === 'fgp-key' && e.key === 'Enter') {
      e.preventDefault();
      saveApiKey(e.target);
      return;
    }
    if (editing && editing.inline && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      commitCardEdit();
      return;
    }
    if (renaming && e.key === 'Enter') {
      e.preventDefault();
      commitRename();
      return;
    }
    if (e.key === 'Escape') {
      if (editing && editing.inline) { cancelCardEdit(); return; }
      if (renaming) {
        renaming = null;
        paintTabs();
      } else if (confirmDel) { confirmDel = null; paint(); }
      else if (sheet === 'history' && histOpen) { histOpen = ''; applyHistOpen(); }
      else if (sheet) { sheet = ''; editing = null; histOpen = ''; paint(); }
      else if (openId) { openId = ''; applyCardOpen(); }
    }
  }

  function readFile(file) {
    return new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(file);
    });
  }

  const api = {
    mount,
    refresh,
    paint,
    getTab: () => tab,
    setTab: (id) => { tab = id; paint(); },
    openSheet: (name) => { sheet = name || ''; paint(); }
  };
  root.FocusGuardPanel = api;
})(window);
