
(function () {
  const Lib = window.FocusGuardLib;
  // 跟 background 里的上限保持一致
  const MAX_CLIP_TEXT = 20000;
  const MAX_CLIPS = 200;
  const blankSession = () => ({
    noteId: '', intent: '', productMode: 'search', clips: [], boards: [], summary: {},
    keywords: [], finished: false, wrapup: null, pendingSearch: '',
    proposals: [], lastDiff: null, lastRoundId: '', showRedo: false
  });
  let session = blankSession();
  let notes = [];
  let uiSettings = { hasKey: true, focusMode: 'auto', channelPolicy: {} };
  const listeners = [];
  let seq = 0;
  const uid = (p) => p + '_' + (++seq);

  function clipNoteKey(c) {
    const id = String((c && c.noteId) || '').trim();
    if (id) return 'id:' + id;
    const u = String((c && c.url) || '');
    const m = u.match(/\/(?:explore|discovery\/item|search_result)\/([A-Za-z0-9]+)/);
    if (m) return 'id:' + m[1];
    return '';
  }

  function refresh(nudge) {
    const prev = session.summary || {};
    const base = Lib.summaryFor(session.intent, session.clips, session.boards);
    session.summary = Object.assign(base, {
      next_searches: (prev.next_searches || []).length ? prev.next_searches : base.next_searches,
      emerging_intent: prev.emerging_intent || '',
      quiet_nudge: nudge || ''
    });
    session.keywords = Lib.suggestKeywords(session.intent, session.clips, session.summary);
  }

  // 壳子里没有真模型，用一个确定性的假模型吐出同样格式的 JSON，
  // 这样 mergeOrganizeResult 走的是线上那条真路径。
  function fakeModel(prompt, boards, pending) {
    const refOfClip = {};
    prompt.clipRef.forEach((id, i) => { refOfClip[id] = '#' + (i + 1); });
    const local = Lib.localOrganize(session.intent, boards, pending, { roundId: 'rd_fake' });
    const place = [];
    const newBoards = [];
    const cards = [];
    const updates = [];
    local.boards.forEach((b) => {
      const got = (local.diff.newClips[b.id] || []).map((cid) => refOfClip[cid]).filter(Boolean);
      const newCardIds = local.diff.newCards[b.id] || [];
      newCardIds.forEach((cid) => {
        const card = (b.cards || []).filter((c) => c.id === cid)[0];
        if (!card) return;
        cards.push({
          board: prompt.boardRef[b.id] || b.name,
          title: card.title,
          body: card.body,
          clips: (card.fromClipIds || []).map((id) => refOfClip[id]).filter(Boolean)
        });
      });
      if (!got.length) return;
      const ref = prompt.boardRef[b.id];
      if (ref) {
        got.forEach((r) => place.push({ clip: r, board: ref }));
        updates.push({ board: ref, keywords: [b.name + ' 细节'] });
      } else {
        newBoards.push({ name: b.name, clips: got });
      }
    });
    return {
      place, new_boards: newBoards, cards, updates, proposals: [],
      next_searches: [{ keyword: session.intent + ' 门票', why: '把可执行细节补上' }],
      still_open: [], emerging_intent: '', intent_ready: false, quiet_nudge: ''
    };
  }

  function organize(extra) {
    const dirty = session.clips.filter((c) => !c.analyzed);
    if (!dirty.length) return { ok: false, error: 'NOTHING_TO_ORGANIZE', session };
    const prompt = Lib.buildOrganizePrompt(session.intent, session.boards, session.clips, dirty, extra || {});
    const roundId = Lib.newRoundId();
    const merged = Lib.mergeOrganizeResult(fakeModel(prompt, session.boards, dirty), {
      intent: session.intent,
      clips: session.clips,
      boards: session.boards,
      pending: dirty,
      clipRef: prompt.clipRef,
      boardRef: prompt.boardRef,
      unsettledRef: prompt.unsettledRef,
      roundId
    });
    session.boards = merged.boards;
    session.lastDiff = merged.diff;
    session.lastRoundId = merged.roundId || roundId;
    session.showRedo = true;
    session.proposals = (session.proposals || []).concat(merged.proposals || []).slice(-6);
    session.clips = session.clips.map((c) => (c.analyzed ? c : Object.assign({}, c, { analyzed: true })));
    persist();
    refresh('');
    fire();
    return { ok: true, organized: dirty.length, diff: merged.diff, session };
  }

  async function toDataUrl(url) {
    const blob = await (await fetch(url)).blob();
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }

  // 壳子里真的压一次图，这样量出来的体积是真的
  async function addImageClip(msg) {
    const raw = msg.dataUrl && msg.dataUrl.indexOf('data:') === 0
      ? msg.dataUrl
      : await toDataUrl(msg.url);
    const shrunk = await shrink(raw, 600, 0.6);
    const bytes = Math.round((shrunk.dataUrl.length - shrunk.dataUrl.indexOf(',') - 1) * 0.75);
    const image = {
      dataUrl: shrunk.dataUrl, width: shrunk.width, height: shrunk.height,
      bytes, srcUrl: msg.url || '', origW: shrunk.origW, origH: shrunk.origH
    };
    const boardId = session.boards.some((b) => b.id === msg.boardId) ? msg.boardId : '';
    const clip = {
      id: uid('clip'), title: msg.title || '', text: String(msg.text || '').trim(),
      topics: msg.topics || [], url: msg.srcUrl || '', source: 'image',
      boardId, image, analyzed: false, at: Date.now()
    };
    session.clips = [clip].concat(session.clips);
    if (boardId) Lib.placeClip(session.boards, clip.id, boardId);
    refresh(boardId ? '放进板块了，点「整理」AI 才会读' : '先存着，点「整理」才交给 AI');
    fire();
    // 壳子里没有 Chrome 本机模型，所以必然识别不出文字，和没开 flag 的真实浏览器一致
    return { ok: true, clip, session, hasText: Boolean(clip.text), ocrError: clip.text ? '' : '壳子里没有本机模型' };
  }

  async function shrink(dataUrl, maxW, quality) {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = bitmap.width > maxW ? maxW / bitmap.width : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const url = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(out);
    });
    return { dataUrl: url, width: w, height: h, origW: bitmap.width, origH: bitmap.height };
  }

  function persist() {
    if (!(session.clips || []).length) return null;
    const note = Lib.buildNote(session);
    if (!note.id) note.id = session.noteId || uid('note');
    session.noteId = note.id;
    const prev = notes.filter((n) => n.id === note.id)[0];
    if (prev) note.startedAt = prev.startedAt || note.startedAt;
    notes = notes.filter((n) => n.id !== note.id).concat([note]);
    return note;
  }

  function fire() {
    listeners.forEach((fn) => fn({ fg_session: { newValue: session } }, 'local'));
  }

  const handlers = {
    START_SEARCH_SESSION(msg) {
      session = blankSession();
      session.intent = msg.intent || '';
      refresh('');
      return { ok: true, session };
    },
    GET_SESSION() {
      return {
        ok: true,
        session,
        progress: { nudge: '', clipCount: session.clips.length },
        ai: { ready: true, mode: 'remote', label: '壳子：本地归类代替模型', error: '' },
        hasKey: true,
        settings: Object.assign({ hasKey: true, focusMode: 'auto', channelPolicy: {} }, uiSettings)
      };
    },
    ADD_CLIP(msg) {
      const c = msg.clip || {};
      if (!String(c.text || '').trim()) return { ok: false, error: 'EMPTY_CLIP' };
      const noteKey = clipNoteKey(c);
      if (noteKey && String(c.source || '') === 'note') {
        const hit = session.clips.some((x) => String(x.source || '') === 'note' && clipNoteKey(x) === noteKey);
        if (hit) return { ok: true, duplicate: true, session };
      }
      if (session.clips.length >= MAX_CLIPS) {
        return { ok: false, error: '这次已经收了 ' + MAX_CLIPS + ' 条，装不下了。先收工存成笔记，再开一次新的搜索。', session };
      }
      const raw = String(c.text);
      const boardId = session.boards.some((b) => b.id === c.boardId) ? c.boardId : '';
      const clip = {
        id: uid('clip'), title: c.title || '', text: raw.slice(0, MAX_CLIP_TEXT), topics: c.topics || [],
        url: c.url || '', source: c.source || 'paste', boardId, analyzed: false,
        truncated: raw.length > MAX_CLIP_TEXT ? raw.length : 0,
        noteId: String(c.noteId || '').trim(), at: Date.now()
      };
      session.clips = [clip].concat(session.clips);
      if (boardId) Lib.placeClip(session.boards, clip.id, boardId);
      refresh(boardId ? '放进板块了，点「整理」AI 才会读' : '先存着，点「整理」才交给 AI');
      fire();
      return { ok: true, clip, session };
    },
    ORGANIZE_NOW() { return organize(); },
    RESUMMARIZE_NOW() { return organize(); },
    REDO_ROUND() {
      if (!session.lastRoundId) return { ok: false, error: 'NO_ROUND', session };
      const stripped = Lib.stripRound(session.boards, session.lastRoundId);
      session.boards = stripped.boards;
      session.clips = session.clips.map((c) =>
        (stripped.unreadClipIds.indexOf(c.id) === -1 ? c : Object.assign({}, c, { analyzed: false })));
      session.showRedo = false;
      session.lastRoundId = '';
      return organize({ avoidNames: stripped.avoidNames });
    },
    REGENERATE_ALL() {
      if (!session.lastRoundId) return { ok: false, error: 'NO_ROUND', session };
      const stripped = Lib.stripRound(session.boards, session.lastRoundId);
      session.boards = stripped.boards;
      session.clips = session.clips.map((c) =>
        (stripped.unreadClipIds.indexOf(c.id) === -1 ? c : Object.assign({}, c, { analyzed: false })));
      session.showRedo = false;
      session.lastRoundId = '';
      return organize({ avoidNames: stripped.avoidNames });
    },
    ACK_REDO() { session.showRedo = false; fire(); return { ok: true, session }; },
    EDIT_CLIP(msg) {
      const clip = session.clips.filter((c) => c.id === msg.clipId)[0];
      if (!clip) return { ok: false, error: 'NO_CLIP' };
      if (msg.text != null) clip.text = String(msg.text);
      if (msg.title != null) clip.title = String(msg.title);
      clip.analyzed = false;
      session.boards = Lib.markSourceEdited(session.boards, clip.id);
      session.showRedo = false;
      fire();
      return { ok: true, session };
    },
    EDIT_CARD(msg) {
      let card = null;
      session.boards.forEach((b) => {
        (b.cards || []).forEach((c) => { if (c.id === msg.cardId) card = c; });
      });
      if (!card) return { ok: false, error: 'NO_CARD' };
      if (msg.title != null) card.title = String(msg.title);
      if (msg.body != null) card.body = String(msg.body);
      card.edited = true;
      card.stale = false;
      session.showRedo = false;
      fire();
      return { ok: true, session };
    },
    REGEN_CARD(msg) {
      let from = [];
      session.boards.forEach((b) => {
        const hit = (b.cards || []).filter((c) => c.id === msg.cardId)[0];
        if (!hit) return;
        from = hit.fromClipIds || [];
        b.cards = (b.cards || []).filter((c) => c.id !== msg.cardId);
      });
      session.clips = session.clips.map((c) =>
        (from.indexOf(c.id) === -1 ? c : Object.assign({}, c, { analyzed: false })));
      return organize();
    },
    NEW_SESSION() {
      const note = persist();
      const next = blankSession();
      next.productMode = session.productMode;
      next.intent = session.intent;
      session = next;
      fire();
      return { ok: true, note, session };
    },
    EXPORT_MD() {
      return { ok: true, markdown: Lib.exportMarkdown(session), filename: (session.intent || 'note') + '.md' };
    },
    RENAME_BOARD(msg) {
      const b = session.boards.filter((x) => x.id === msg.boardId)[0];
      const name = String(msg.name || '').trim();
      if (!b || !name) return { ok: false, error: 'NO_BOARD' };
      b.name = name;
      refresh('改名了');
      fire();
      return { ok: true, session };
    },
    DELETE_BOARD(msg) {
      const b = session.boards.filter((x) => x.id === msg.boardId)[0];
      if (!b) return { ok: false, error: 'NO_BOARD' };
      session.boards = session.boards.filter((x) => x.id !== b.id);
      fire();
      return { ok: true, session };
    },
    REMOVE_CLIP(msg) {
      session.clips = session.clips.filter((c) => c.id !== msg.clipId);
      session.boards.forEach((b) => { b.clipIds = (b.clipIds || []).filter((x) => x !== msg.clipId); });
      session.boards = session.boards.filter((b) => b.pinned || (b.cards || []).length || (b.clipIds || []).length);
      refresh('删掉一条材料');
      fire();
      return { ok: true, session };
    },
    DELETE_CARD(msg) {
      let found = false;
      session.boards.forEach((b) => {
        const next = (b.cards || []).filter((c) => c.id !== msg.cardId);
        if (next.length !== (b.cards || []).length) found = true;
        b.cards = next;
      });
      if (!found) return { ok: false, error: 'NO_CARD' };
      session.showRedo = false;
      refresh('删掉一张卡片');
      fire();
      return { ok: true, session };
    },
    EDIT_FACT(msg) {
      const b = session.boards.filter((x) => x.id === msg.boardId)[0];
      if (!b) return { ok: false, error: 'NO_BOARD' };
      const key = msg.kind === 'unsettled' ? 'unsettled' : 'settled';
      const text = String(msg.text || '').trim();
      if (msg.action === 'remove') b[key] = (b[key] || []).filter((x) => x !== msg.text);
      else if (text && (b[key] || []).indexOf(text) === -1) b[key] = (b[key] || []).concat([text]);
      refresh('');
      fire();
      return { ok: true, session };
    },
    APPLY_PROPOSAL(msg) {
      const p = (session.proposals || []).filter((x) => x.id === msg.id)[0];
      if (!p) return { ok: false, error: 'NO_PROPOSAL' };
      const applied = Lib.applyProposal(session.boards, p);
      if (!applied.ok) return { ok: false, error: 'CANNOT_APPLY' };
      session.boards = applied.boards;
      session.proposals = session.proposals.filter((x) => x.id !== msg.id);
      session.clips = session.clips.map((c) => Object.assign({}, c, { boardId: Lib.ownerOf(session.boards, c.id) }));
      refresh('按你的意思改了');
      fire();
      return { ok: true, session };
    },
    DISMISS_PROPOSAL(msg) {
      session.proposals = (session.proposals || []).filter((x) => x.id !== msg.id);
      fire();
      return { ok: true, session };
    },
    ADD_IMAGE_CLIP(msg) {
      return addImageClip(msg).catch((e) => ({ ok: false, error: '图片读不出来：' + (e && e.message) }));
    },
    STORAGE_USAGE() {
      const used = JSON.stringify({ session, notes }).length;
      return { ok: true, usage: { used, budget: 9 * 1024 * 1024, left: 9 * 1024 * 1024 - used } };
    },
    ASSIGN_CLIP(msg) {
      const board = session.boards.filter((b) => b.id === msg.boardId)[0];
      if (!board) return { ok: false, error: 'NO_BOARD' };
      let moved = false;
      session.clips = session.clips.map((c) => {
        if (c.id !== msg.clipId) return c;
        moved = true;
        return Object.assign({}, c, { boardId: board.id });
      });
      if (!moved) return { ok: false, error: 'NO_CLIP' };
      Lib.placeClip(session.boards, msg.clipId, board.id);
      refresh('挪进「' + board.name + '」了');
      fire();
      return { ok: true, session };
    },
    CREATE_BOARD(msg) {
      const name = String(msg.name || '').trim() || '新板块';
      let board = session.boards.filter((b) => b.name === name)[0];
      if (!board) {
        board = Lib.emptyBoard(name, true);
        session.boards = session.boards.concat([board]);
        fire();
      }
      return { ok: true, board, session };
    },
    CLASSIFY_NOTE(msg) {
      const r = Lib.classifyHeuristic(session.intent, msg.note || {});
      return Object.assign({ ok: true, popup: r.label === 'drifting' }, r);
    },
    OPEN_SIDE_PANEL() { return { ok: true }; },
    FINISH_SEARCH() {
      if (!session.clips.length) return { ok: false, error: 'EMPTY_SESSION' };
      const stray = Lib.pendingClips(session).length;
      const note = Lib.buildNote(session);
      note.stray = stray;
      if (!note.id) note.id = uid('note');
      const prev = notes.filter((n) => n.id === note.id)[0];
      if (prev) note.startedAt = prev.startedAt || note.startedAt;
      notes = notes.filter((n) => n.id !== note.id).concat([note]);
      session = blankSession();
      fire();
      return { ok: true, note, session };
    },
    LIST_NOTES() {
      return { ok: true, notes: notes.map((n) => Lib.noteIndexEntry(n)).sort((a, b) => b.updatedAt - a.updatedAt) };
    },
    REOPEN_NOTE(msg) {
      const note = notes.filter((n) => n.id === msg.id)[0];
      if (!note) return { ok: false, error: 'NO_NOTE' };
      session = Object.assign(blankSession(), Lib.sessionFromNote(note), { productMode: 'search' });
      fire();
      return { ok: true, note, session };
    },
    DELETE_NOTE(msg) {
      notes = notes.filter((n) => n.id !== msg.id);
      fire();
      return { ok: true };
    },
    ACCEPT_EMERGING_INTENT(msg) { session.intent = msg.intent || session.intent; refresh(''); fire(); return { ok: true, session }; },
    DRIFT_ACTION() { return { ok: true }; },
    SEARCH_KEYWORD() { return { ok: true, demo: true }; },
    SET_PRODUCT_MODE(msg) { session.productMode = msg.mode; fire(); return { ok: true, session }; },
    SAVE_SETTINGS(msg) {
      if (msg.focusMode) uiSettings.focusMode = msg.focusMode;
      if (msg.channelPolicy) uiSettings.channelPolicy = Object.assign({}, uiSettings.channelPolicy, msg.channelPolicy);
      return { ok: true, settings: uiSettings };
    },
    RESUME_SEARCH() { session.finished = false; return { ok: true, session }; },
    SAVE_API_CONFIG() { return { ok: true, ai: { ready: true, label: '壳子里不连网' } }; }
  };

  window.chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => p,
      sendMessage(msg, cb) {
        const fn = handlers[msg && msg.type];
        const out = fn ? fn(msg) : { ok: false, error: 'NO_HANDLER:' + (msg && msg.type) };
        window.__fgCalls = (window.__fgCalls || []).concat([msg && msg.type]);
        if (cb) Promise.resolve(out).then((v) => setTimeout(() => cb(v), 0));
      },
      onMessage: { addListener() {} }
    },
    storage: {
      local: { get: (k, cb) => (cb ? cb({}) : Promise.resolve({})), set: () => Promise.resolve() },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    },
    tabs: { query: () => Promise.resolve([{ id: 1, title: '壳子', url: 'about:blank' }]), create() {}, sendMessage() {} }
  };
})();
