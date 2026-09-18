// ==================== Focus Guard Background ====================
// 时间统计 + 搜索会话 + 分类/摘要 LLM 代理
importScripts('/src/lib/fg-lib.js');

const SESSION_KEY = 'fg_session';
const BROWSE_SILENCE_KEY = 'fg_xhs_browse_silence';
const DRIFT_COOLDOWN_MS = 12 * 1000;
// 一条材料要装得下一整篇长笔记；20000 字约 40KB，比一张图还小
const MAX_CLIP_TEXT = 20000;
// 到顶了就明确拒绝并说清楚，绝不静默丢掉用户已经收下的东西
const MAX_CLIPS = 200;
const Lib = self.FocusGuardLib;

function emptySession() {
  return {
    id: null,
    noteId: '',
    productMode: 'search',
    intent: '',
    platform: '',
    startedAt: 0,
    clips: [],
    boards: [],
    summary: { bullets: [], checklist: [], source: 'none', updatedAt: 0 },
    driftEvents: [],
    positiveLabels: [],
    lastClassify: null,
    lastDriftPopupAt: 0,
    naggedNoteIds: [],
    candidate: null,
    organizing: false,
    proposals: [],
    lastDiff: null,
    lastRoundId: '',
    showRedo: false,
    keywords: [],
    finished: false,
    wrapup: null,
    lastActivityAt: 0,
    pendingSearch: ''
  };
}

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || {};
}

const CHANNEL_KEYS = ['home', 'diandian', 'red', 'live', 'publish', 'notify', 'message', 'profile'];

function normalizeFocusMode(v) {
  return v === 'on' || v === 'off' ? v : 'auto';
}

function normalizeChannelPolicy(raw) {
  const out = {};
  CHANNEL_KEYS.forEach((k) => {
    const v = raw && raw[k];
    out[k] = (v === 'block' || v === 'allow') ? v : 'auto';
  });
  return out;
}

function publicSettings(settings) {
  const s = settings || {};
  return {
    apiBase: s.apiBase || 'https://api.deepseek.com',
    apiModel: s.apiModel || 'deepseek-chat',
    hasKey: hasApiKey(s),
    interruptInterval: s.interruptInterval ?? 0,
    bilibiliLimit: s.bilibiliLimit ?? 60,
    xiaohongshuLimit: s.xiaohongshuLimit ?? 30,
    focusMode: normalizeFocusMode(s.focusMode),
    channelPolicy: normalizeChannelPolicy(s.channelPolicy)
  };
}

const CHANNEL_LABELS = { home: '首页', diandian: '点点', red: 'RED', live: '直播', publish: '发布', notify: '通知', message: '消息', profile: '我的' };
const DEFAULT_BLOCK_CHANNELS = { home: true, red: true, live: true, diandian: false, notify: false, message: false, publish: false, profile: false };

function focusToastText(mode, settings) {
  if (mode === 'browse') return '你可以随便逛了';
  const pol = normalizeChannelPolicy(settings && settings.channelPolicy);
  const names = CHANNEL_KEYS.filter((k) => {
    if (pol[k] === 'block') return true;
    if (pol[k] === 'allow') return false;
    return DEFAULT_BLOCK_CHANNELS[k];
  }).map((k) => CHANNEL_LABELS[k]);
  if (!names.length) return '专注已开，当前没有会拦截的栏目';
  return '切换到' + names.join('、') + '会被拦截';
}

function browseSilenceStore() {
  return (chrome.storage && chrome.storage.session) || chrome.storage.local;
}

async function getBrowseSilence() {
  const data = await browseSilenceStore().get(BROWSE_SILENCE_KEY);
  return Boolean(data[BROWSE_SILENCE_KEY]);
}

async function setBrowseSilence(on) {
  const store = browseSilenceStore();
  if (on) await store.set({ [BROWSE_SILENCE_KEY]: true });
  else await store.remove(BROWSE_SILENCE_KEY);
}

function tabLooksXhs(tab) {
  if (!tab) return false;
  return isNotebookSite(tab.url || '') || isNotebookSite(tab.pendingUrl || '');
}

async function maybeClearBrowseSilence() {
  const tabs = await chrome.tabs.query({});
  if (tabs.some(tabLooksXhs)) return;
  await setBrowseSilence(false);
}

function bindXhsBrowseSilenceWatch() {
  const kick = () => { maybeClearBrowseSilence().catch(() => {}); };
  chrome.tabs.onRemoved.addListener(kick);
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url) kick();
  });
  if (chrome.tabs.onReplaced) chrome.tabs.onReplaced.addListener(kick);
  kick();
}

async function broadcastApplyMode(mode) {
  const settings = await getSettings();
  const session = await getSession();
  const toast = focusToastText(mode, settings);
  const intent = String(session.intent || '').trim();
  const tabs = await chrome.tabs.query({});
  tabs.forEach((tab) => {
    if (!tab.id || !/xiaohongshu\.com/.test(tab.url || '')) return;
    chrome.tabs.sendMessage(tab.id, { type: 'APPLY_MODE', mode, toast, intent }, () => void chrome.runtime.lastError);
  });
}

async function getSession() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return Object.assign(emptySession(), data[SESSION_KEY] || {});
}

async function saveSession(session) {
  await chrome.storage.local.set({
    [SESSION_KEY]: session,
    session_intent: session.intent || '',
    session_mode: session.productMode === 'search' ? 'focus' : 'relax',
    session_platform: session.platform || ''
  });
  return session;
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function addTime(platform, mode, seconds) {
  if (!platform || !mode || seconds < 1) return;
  const today = new Date().toISOString().slice(0, 10);
  const key = `stats_${today}`;
  const data = await chrome.storage.local.get(key);
  const stats = data[key] || {};
  if (typeof stats[platform] === 'number') {
    stats[platform] = { active: 0, idle: stats[platform] };
  }
  if (!stats[platform] || typeof stats[platform] !== 'object') {
    stats[platform] = { active: 0, idle: 0 };
  }
  stats[platform][mode] = (stats[platform][mode] || 0) + seconds;
  await chrome.storage.local.set({ [key]: stats });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'focus_interrupt') return;
  const settings = await getSettings();
  if (!settings.interruptInterval || settings.interruptInterval <= 0) return;
  const session = await getSession();
  if (session.productMode !== 'search') return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const tab of tabs) {
    const platform = getPlatform(tab.url || '');
    if (platform) {
      chrome.tabs.sendMessage(tab.id, { type: 'FOCUS_INTERRUPT' }, () => void chrome.runtime.lastError);
    }
  }
});

function getPlatform(url) {
  if (/bilibili\.com/.test(url)) return 'bilibili';
  if (/xiaohongshu\.com/.test(url)) return 'xiaohongshu';
  if (/douyin\.com/.test(url)) return 'douyin';
  return null;
}

async function updateAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear('focus_interrupt');
  if (settings.interruptInterval && settings.interruptInterval > 0) {
    chrome.alarms.create('focus_interrupt', { periodInMinutes: settings.interruptInterval });
  }
}

async function biliApiProxy(apiUrl) {
  const cookieNames = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5'];
  const cookies = await Promise.all(
    cookieNames.map(name =>
      chrome.cookies.get({ url: 'https://www.bilibili.com', name }).catch(() => null)
    )
  );
  const cookieStr = cookies.filter(c => c && c.value).map(c => `${c.name}=${c.value}`).join('; ');
  if (!cookieStr.includes('SESSDATA')) return { ok: false, error: 'NOT_LOGIN' };
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        Cookie: cookieStr,
        Referer: 'https://www.bilibili.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Origin: 'https://www.bilibili.com'
      }
    });
    const json = await resp.json();
    if (json.code !== 0) return { ok: false, error: json.message || `code ${json.code}` };
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function normalizeKey(k) {
  return String(k || '').trim().replace(/^Bearer\s+/i, '');
}

function hasApiKey(settings) {
  const k = normalizeKey((settings && settings.apiKey) || '');
  return k.length > 12 && !k.includes('在此填入');
}

function keyHint(settings) {
  const k = normalizeKey((settings && settings.apiKey) || '');
  if (!hasApiKey(settings)) return '';
  return k.slice(0, 3) + '…' + k.slice(-4);
}

function humanizeApiError(status, body) {
  const t = String(body || '');
  if (status === 401) return 'Key 无效或已过期（401）';
  if (status === 402 || /insufficient|balance|quota/i.test(t)) return '账户余额不足（' + status + '）';
  if (status === 429) return '请求太频繁（429），稍后再试';
  if (status === 404) return '接口连不上（404）。确认 Key 对应的服务地址是否正确';
  if (!status) return t || '网络失败';
  return 'HTTP ' + status + (t ? '：' + t.slice(0, 80) : '');
}

async function probeRemote(settings) {
  const key = normalizeKey(settings.apiKey);
  if (!key) return { ok: false, error: '还没有 key' };
  const base = String(settings.apiBase || 'https://api.deepseek.com').replace(/\/$/, '');
  try {
    const resp = await fetch(base + '/v1/models', {
      headers: { Authorization: 'Bearer ' + key }
    });
    const t = await resp.text().catch(() => '');
    if (!resp.ok) return { ok: false, error: humanizeApiError(resp.status, t) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '连不上 ' + base + '：' + (e.message || e) };
  }
}

async function writeApiStatus(patch) {
  const data = await chrome.storage.local.get('settings');
  const settings = Object.assign({}, data.settings || {}, {
    apiStatus: Object.assign({ at: Date.now() }, patch)
  });
  await chrome.storage.local.set({ settings });
  return settings;
}

let onDeviceCache = { at: 0, available: false };

async function probeOnDevice() {
  if (Date.now() - onDeviceCache.at < 60 * 1000) return onDeviceCache.available;
  const LM = globalThis.LanguageModel;
  if (!LM || typeof LM.availability !== 'function') {
    onDeviceCache = { at: Date.now(), available: false };
    return false;
  }
  try {
    const status = await LM.availability();
    onDeviceCache = { at: Date.now(), available: status !== 'unavailable' };
  } catch (_) {
    onDeviceCache = { at: Date.now(), available: false };
  }
  return onDeviceCache.available;
}

async function describeAi() {
  const settings = await getSettings();
  const status = settings.apiStatus || {};
  if (hasApiKey(settings) && status.ok) {
    return {
      mode: 'remote',
      ready: true,
      label: '大模型已接通（' + keyHint(settings) + '）',
      hint: keyHint(settings),
      error: ''
    };
  }
  if (hasApiKey(settings) && status.error) {
    return {
      mode: 'remote',
      ready: false,
      label: 'Key 已保存，但还没接通：' + status.error,
      hint: keyHint(settings),
      error: status.error
    };
  }
  if (hasApiKey(settings)) {
    return {
      mode: 'remote',
      ready: false,
      label: 'Key 已保存，正在确认能否连上',
      hint: keyHint(settings),
      error: ''
    };
  }
  if (await probeOnDevice()) {
    return { mode: 'ondevice', ready: true, label: '正在用 Chrome 本机模型', hint: '', error: '' };
  }
  return { mode: 'heuristic', ready: false, label: '还没配可用的模型，先只能本地归类', hint: '', error: '' };
}

function messagesToPrompt(messages) {
  return (messages || []).map((m) => {
    const role = m.role === 'system' ? '系统' : '用户';
    return '【' + role + '】\n' + (m.content || '');
  }).join('\n\n') + '\n\n只输出 JSON，不要解释。';
}

async function chatOnDevice(messages) {
  const LM = globalThis.LanguageModel;
  if (!LM || typeof LM.create !== 'function') return { ok: false, error: 'NO_ONDEVICE' };
  try {
    const status = await LM.availability();
    if (status === 'unavailable') return { ok: false, error: 'UNAVAILABLE' };
    const session = await LM.create();
    const raw = await session.prompt(messagesToPrompt(messages));
    if (session.destroy) session.destroy();
    const parsed = Lib.parseJsonFromModel(raw);
    if (!parsed) return { ok: false, error: 'BAD_JSON', raw: String(raw || '').slice(0, 400) };
    return { ok: true, data: parsed, source: 'ondevice' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function chatRemote(messages, maxTokens) {
  const settings = await getSettings();
  if (!hasApiKey(settings)) return { ok: false, error: 'NO_KEY' };
  const base = String(settings.apiBase || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = settings.apiModel || 'deepseek-chat';
  const body = {
    model,
    temperature: 0.2,
    max_tokens: maxTokens || 500,
    response_format: { type: 'json_object' },
    messages
  };
  async function post(payload) {
    const resp = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + normalizeKey(settings.apiKey)
      },
      body: JSON.stringify(payload)
    });
    const text = await resp.text().catch(() => '');
    return { status: resp.status, ok: resp.ok, text };
  }

  let raw;
  try {
    raw = await post(body);
    if (!raw.ok && raw.status === 400) {
      const plain = Object.assign({}, body);
      delete plain.response_format;
      raw = await post(plain);
    }
  } catch (e) {
    return { ok: false, error: '连不上 ' + base + '：' + (e.message || e) };
  }
  if (!raw.ok) {
    return { ok: false, error: humanizeApiError(raw.status, raw.text) };
  }
  let json;
  try {
    json = JSON.parse(raw.text);
  } catch (_) {
    return { ok: false, error: '返回不是 JSON', detail: raw.text.slice(0, 160) };
  }
  const choice = (json.choices && json.choices[0]) || {};
  const text = choice.message && choice.message.content;
  const parsed = Lib.parseJsonFromModel(text);
  if (!parsed) {
    if (choice.finish_reason === 'length') {
      return { ok: false, error: '模型输出被截断（材料太多），已换本地归类' };
    }
    return { ok: false, error: '模型没返回可用 JSON', detail: String(text || '').slice(0, 160) };
  }
  return { ok: true, data: parsed, source: 'remote' };
}

async function chatJson(messages, maxTokens) {
  const settings = await getSettings();
  if (hasApiKey(settings)) {
    const remote = await chatRemote(messages, maxTokens);
    if (remote.ok) {
      await writeApiStatus({ ok: true, error: '' });
      return remote;
    }
    await writeApiStatus({ ok: false, error: remote.error + (remote.detail ? ' ' + String(remote.detail).slice(0, 80) : '') });
    return remote;
  }
  const local = await chatOnDevice(messages);
  if (local.ok) return local;
  return { ok: false, error: local.error || 'NO_MODEL' };
}

function progressFrom(session) {
  const summary = session.summary || {};
  return Lib.computeProgress({
    clips: session.clips,
    checklist: summary.checklist || [],
    stillOpen: summary.still_open || [],
    sessionStartedAt: session.startedAt,
    now: Date.now()
  });
}

async function startSearchSession(intent, platform, opts) {
  const mode = (opts && opts.productMode === 'browse') ? 'browse' : 'search';
  if (mode !== 'browse' && !(opts && opts.keepBrowseSilence)) await setBrowseSilence(false);
  const session = emptySession();
  session.id = uid('sess');
  session.productMode = mode;
  session.intent = String(intent || '').trim();
  session.platform = platform || 'xiaohongshu';
  session.startedAt = Date.now();
  session.summary = Lib.summaryFor(session.intent, [], []);
  session.keywords = Lib.suggestKeywords(session.intent, [], session.summary);
  session.finished = false;
  session.wrapup = null;
  session.lastActivityAt = Date.now();
  await saveSession(session);
  return session;
}

// 重算摘要时不能把 AI 上一轮给的结论和推荐词冲掉
function refreshSummary(session, nudge) {
  const prev = session.summary || {};
  const base = Lib.summaryFor(session.intent, session.clips, session.boards);
  session.summary = Object.assign(base, {
    next_searches: (prev.next_searches || []).length ? prev.next_searches : base.next_searches,
    still_open: (prev.still_open || []).length ? prev.still_open : base.still_open,
    emerging_intent: prev.emerging_intent || '',
    intent_ready: Boolean(prev.intent_ready),
    source: prev.source && prev.source !== 'local' ? prev.source : base.source,
    error: prev.error || '',
    thinking: false,
    quiet_nudge: nudge || ''
  });
  session.keywords = Lib.suggestKeywords(session.intent, session.clips, session.summary);
  session.lastActivityAt = Date.now();
  return session;
}

async function addClip(clip) {
  const session = await getSession();
  const text = String(clip.text || '').trim();
  const image = clip.image && clip.image.dataUrl ? clip.image : null;
  // 只有图、没识别出文字也算一条有效材料
  if (!text && !image) return { ok: false, error: 'EMPTY_CLIP', session, progress: progressFrom(session) };
  const noteKey = clipNoteKey(clip);
  if (noteKey && String(clip.source || '') === 'note') {
    const hit = (session.clips || []).some((c) => String(c.source || '') === 'note' && clipNoteKey(c) === noteKey);
    if (hit) return { ok: true, duplicate: true, session, progress: progressFrom(session) };
  }
  if ((session.clips || []).length >= MAX_CLIPS) {
    return {
      ok: false,
      error: '这次已经收了 ' + MAX_CLIPS + ' 条，装不下了。先收工存成笔记，再开一次新的搜索。',
      session,
      progress: progressFrom(session)
    };
  }
  if (!session.startedAt) {
    session.id = uid('sess');
    session.startedAt = Date.now();
    session.productMode = session.productMode || 'search';
    session.platform = session.platform || 'xiaohongshu';
  }
  if (!session.intent) session.intent = String(clip.title || '').trim() || '边搜边明确';
  const target = (session.boards || []).filter((b) => b.id === String(clip.boardId || ''))[0];
  const item = {
    id: uid('clip'),
    title: String(clip.title || '').trim().slice(0, 120),
    text: text.slice(0, MAX_CLIP_TEXT),
    topics: clip.topics || [],
    url: clip.url || '',
    source: clip.source || 'paste',
    boardId: target ? target.id : '',
    image: image,
    analyzed: false,
    // 真被砍了就记下来，界面上明说，不装作收全了
    truncated: text.length > MAX_CLIP_TEXT ? text.length : 0,
    noteId: String(clip.noteId || '').trim(),
    at: Date.now()
  };
  session.clips = [item].concat(session.clips || []);
  if (target) Lib.placeClip(session.boards, item.id, target.id);
  session.candidate = null;
  session.finished = false;
  session.wrapup = null;
  session.showRedo = false;
  refreshSummary(session, target
    ? ('也放进了「' + target.name + '」，点「快速整理」AI 才会读')
    : '先存着，点「快速整理」才交给 AI');
  await saveSession(session);
  persistNote(session).catch(() => {});
  return { ok: true, clip: item, session, progress: progressFrom(session) };
}

function clipNoteKey(c) {
  const id = String((c && c.noteId) || '').trim();
  if (id) return 'id:' + id;
  const u = String((c && c.url) || '');
  const m = u.match(/\/(?:explore|discovery\/item|search_result)\/([A-Za-z0-9]+)/);
  if (m) return 'id:' + m[1];
  return '';
}

/* ---------- 整理：只有用户点了才跑，而且只增不改 ---------- */

async function organizeNow(opts) {
  let session = await getSession();
  const dirty = (session.clips || []).filter((c) => !c.analyzed);
  if (!dirty.length) {
    return { ok: false, error: 'NOTHING_TO_ORGANIZE', session, progress: progressFrom(session) };
  }
  session.organizing = true;
  session.summary = Object.assign({}, session.summary || {}, { thinking: true });
  await saveSession(session);

  const settings = await getSettings();
  const canModel = hasApiKey(settings) || (await probeOnDevice());
  const roundId = Lib.newRoundId();
  const extra = { avoidNames: (opts && opts.avoidNames) || [] };
  const prompt = canModel
    ? Lib.buildOrganizePrompt(session.intent, session.boards, session.clips, dirty, extra)
    : null;
  const result = prompt ? await chatJson(prompt.messages, 2600) : { ok: false, error: '还没有可用模型，先用本地关键词归类' };

  session = await getSession();
  const merged = (result.ok && result.data)
    ? Lib.mergeOrganizeResult(result.data, {
        intent: session.intent,
        clips: session.clips,
        boards: session.boards,
        pending: dirty,
        clipRef: prompt.clipRef,
        boardRef: prompt.boardRef,
        unsettledRef: prompt.unsettledRef,
        roundId
      })
    : Lib.localOrganize(session.intent, session.boards, dirty, { roundId, avoidNames: extra.avoidNames });

  session.boards = merged.boards;
  session.lastDiff = merged.diff;
  session.lastRoundId = merged.roundId || roundId;
  session.showRedo = Boolean((merged.diff && merged.diff.newCards && Object.keys(merged.diff.newCards).length) || (merged.diff && merged.diff.newBoards && merged.diff.newBoards.length));
  session.proposals = (session.proposals || []).concat(merged.proposals || []).slice(-6);
  session.clips = (session.clips || []).map((c) => {
    if (c.analyzed) return c;
    return Object.assign({}, c, { analyzed: true });
  });
  session.summary = (result.ok && result.data)
    ? Lib.summaryFromOrganize(result.data, session.intent, session.clips, session.boards)
    : Lib.summaryFor(session.intent, session.clips, session.boards);
  if (result.ok && result.source === 'ondevice') session.summary.source = 'ondevice';
  session.summary.error = result.ok ? '' : (result.error || '模型没返回结果');
  session.organizing = false;
  session.keywords = Lib.suggestKeywords(session.intent, session.clips, session.summary);
  session.lastActivityAt = Date.now();
  await saveSession(session);
  persistNote(session).catch(() => {});
  return {
    ok: true,
    organized: dirty.length,
    usedModel: Boolean(result.ok),
    error: session.summary.error,
    diff: session.lastDiff,
    session,
    progress: progressFrom(session)
  };
}

async function redoRound() {
  const session = await getSession();
  const roundId = session.lastRoundId;
  if (!roundId) return { ok: false, error: 'NO_ROUND', session, progress: progressFrom(session) };
  const stripped = Lib.stripRound(session.boards, roundId);
  session.boards = stripped.boards;
  session.clips = (session.clips || []).map((c) =>
    (stripped.unreadClipIds.indexOf(c.id) === -1 ? c : Object.assign({}, c, { analyzed: false })));
  session.showRedo = false;
  session.lastRoundId = '';
  await saveSession(session);
  return organizeNow({ avoidNames: stripped.avoidNames });
}

async function persistNote(session) {
  if (!(session && (session.clips || []).length)) return null;
  const note = Lib.buildNote(session);
  if (!note.id) note.id = session.noteId || uid('note');
  session.noteId = note.id;
  const prev = await readNote(note.id);
  if (prev) note.startedAt = prev.startedAt || note.startedAt;
  await writeNote(note);
  return note;
}

async function classifyNote(note) {
  const session = await getSession();
  if (session.productMode !== 'search' || !session.intent) {
    return { label: 'unknown', confidence: 'low', reason: '无搜索目的', source: 'skip', popup: false, session };
  }
  if (Lib.matchesPositiveLabel(note, session.positiveLabels)) {
    const result = { label: 'on_goal', confidence: 'high', reason: '你刚说过类似笔记就是要的', source: 'feedback', popup: false };
    return afterClassify(session, note, result);
  }
  const heuristic = Lib.classifyHeuristic(session.intent, note);
  const settings = await getSettings();
  let result = Object.assign({ source: 'heuristic' }, heuristic);
  const canModel = hasApiKey(settings) || (await probeOnDevice());
  if (canModel) {
    const llm = await chatJson(Lib.buildClassifyPrompt(session.intent, note, session.positiveLabels), 220);
    if (llm.ok && llm.data) {
      let label = Lib.normalizeLabel(llm.data.label);
      if (String(llm.data.confidence).toLowerCase() === 'low') label = 'unknown';
      result = {
        label,
        confidence: llm.data.confidence === 'high' ? 'high' : 'low',
        reason: String(llm.data.reason || '').slice(0, 60),
        source: llm.source || 'llm'
      };
    } else {
      result.source = 'heuristic_fallback';
    }
  }
  return afterClassify(session, note, result);
}

async function afterClassify(session, note, result) {
  const now = Date.now();
  session.lastClassify = {
    url: note.url || '',
    noteId: note.noteId || '',
    title: note.title || '',
    label: result.label,
    reason: result.reason,
    source: result.source,
    at: now
  };
  session.candidate = {
    title: note.title || '',
    topics: note.topics || [],
    snippet: note.snippet || '',
    url: note.url || '',
    noteId: note.noteId || ''
  };
  const nagged = session.naggedNoteIds || [];
  const sameNote = note.noteId && nagged.indexOf(note.noteId) !== -1;
  const cooled = now - (session.lastDriftPopupAt || 0) < DRIFT_COOLDOWN_MS;
  const popup = result.label === 'drifting' && result.confidence !== 'low' && !sameNote && !cooled;
  if (popup) {
    session.lastDriftPopupAt = now;
    if (note.noteId) session.naggedNoteIds = nagged.concat([note.noteId]).slice(-40);
    session.driftEvents = (session.driftEvents || []).concat([{
      at: now,
      title: note.title || '',
      url: note.url || '',
      label: 'drifting',
      reason: result.reason
    }]).slice(-20);
  }
  await saveSession(session);
  const progress = progressFrom(session);
  return Object.assign({}, result, { popup, progress, session, searchUrl: searchUrlFor(session) });
}

function searchUrlFor(session) {
  const kw = encodeURIComponent(session.intent || '');
  return 'https://www.xiaohongshu.com/search_result?keyword=' + kw + '&source=web_explore_feed';
}

async function handleDriftAction(action, payload) {
  const session = await getSession();
  const title = (payload && payload.title) || (session.lastClassify && session.lastClassify.title) || '';
  const topics = (payload && payload.topics) || [];
  const url = (payload && payload.url) || '';
  if (action === 'correct' || action === 'related') {
    session.positiveLabels = (session.positiveLabels || []).concat([{ title, topics, url, at: Date.now() }]).slice(-20);
    session.lastClassify = Object.assign({}, session.lastClassify || {}, { label: 'on_goal', reason: action === 'related' ? '用户判断：有关，我自有考虑' : '用户纠正：这就是我要的' });
    await saveSession(session);
    const extract = String((payload && (payload.snippet || payload.text)) || title || '').trim();
    if (action === 'correct' && extract) {
      await addClip({
        title,
        text: extract,
        topics,
        url,
        source: 'correct'
      });
    }
  } else if (action === 'change_intent') {
    const next = String((payload && payload.intent) || title || '').trim();
    if (next) {
      session.intent = next;
      session.positiveLabels = (session.positiveLabels || []).concat([{ title, topics, url, at: Date.now() }]);
      session.lastClassify = Object.assign({}, session.lastClassify || {}, { label: 'on_goal', reason: '目的已改' });
      refreshSummary(session, '目的换了，板块留着不动。想让 AI 按新目的重排，点「全部重新生成」');
      await saveSession(session);
    }
  } else if (action === 'back_to_search') {
    session.driftEvents = (session.driftEvents || []).concat([{
      at: Date.now(), title, url, label: 'pulled_back', reason: '回搜索'
    }]).slice(-20);
    await saveSession(session);
  }
  const fresh = await getSession();
  return { session: fresh, progress: progressFrom(fresh), searchUrl: searchUrlFor(fresh) };
}

function isNotebookSite(url) {
  try {
    return /(^|\.)xiaohongshu\.com$/i.test(new URL(url).hostname);
  } catch (_) {
    return false;
  }
}

async function applySidePanelForTab(tab, tryOpen) {
  if (!chrome.sidePanel || !chrome.sidePanel.setOptions || !tab || tab.id == null) return;
  const onSite = isNotebookSite(tab.url || '');
  try {
    if (onSite) {
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'src/pages/sidepanel.html',
        enabled: true
      });
      if (tryOpen && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      }
    } else {
      await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
    }
  } catch (_) {}
}

let sidePanelBound = false;

function bindNotebookSidePanel() {
  if (!chrome.sidePanel || sidePanelBound) return;
  sidePanelBound = true;
  if (chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  if (!chrome.sidePanel.setOptions) return;

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab) return;
    if (!info.url && info.status !== 'complete') return;
    const shouldOpen = Boolean(tab.active && isNotebookSite(tab.url || ''));
    applySidePanelForTab(tab, shouldOpen);
  });

  chrome.tabs.onActivated.addListener(async (active) => {
    try {
      const tab = await chrome.tabs.get(active.tabId);
      await applySidePanelForTab(tab, isNotebookSite(tab.url || ''));
    } catch (_) {}
  });

  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      try {
        const [tab] = await chrome.tabs.query({ active: true, windowId });
        if (tab) await applySidePanelForTab(tab, isNotebookSite(tab.url || ''));
      } catch (_) {}
    });
  }
}

async function openSidePanel(sender) {
  try {
    const tab = sender && sender.tab;
    const tabId = tab && tab.id;
    if (tabId) {
      // 必须先 open：await setOptions 会吃掉用户手势，关掉的侧栏就再也打不开
      if (chrome.sidePanel.setOptions) {
        chrome.sidePanel.setOptions({
          tabId,
          path: 'src/pages/sidepanel.html',
          enabled: true
        });
      }
      await chrome.sidePanel.open({ tabId });
      return { ok: true };
    }
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && active.windowId) {
      if (chrome.sidePanel.setOptions && active.id != null) {
        chrome.sidePanel.setOptions({
          tabId: active.id,
          path: 'src/pages/sidepanel.html',
          enabled: true
        });
      }
      await chrome.sidePanel.open({ windowId: active.windowId });
      return { ok: true };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: false, error: 'NO_TAB' };
}

/* ---------- 历史笔记：一条一个键，索引单独放小的那个 ---------- */

const NOTE_INDEX_KEY = 'fg_note_index';
const noteKeyOf = (id) => 'fg_note_' + id;

async function listNotes() {
  const data = await chrome.storage.local.get(NOTE_INDEX_KEY);
  const list = data[NOTE_INDEX_KEY] || [];
  return list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function readNote(id) {
  if (!id) return null;
  const data = await chrome.storage.local.get(noteKeyOf(id));
  return data[noteKeyOf(id)] || null;
}

async function writeNote(note) {
  await chrome.storage.local.set({ [noteKeyOf(note.id)]: note });
  const list = await listNotes();
  const entry = Lib.noteIndexEntry(note);
  const next = list.filter((x) => x.id !== note.id).concat([entry]);
  await chrome.storage.local.set({ [NOTE_INDEX_KEY]: next });
  return note;
}

async function deleteNote(id) {
  await chrome.storage.local.remove(noteKeyOf(id));
  const list = await listNotes();
  await chrome.storage.local.set({ [NOTE_INDEX_KEY]: list.filter((x) => x.id !== id) });
  return { ok: true };
}

// 结束 = 存成笔记并清空，但随时能重新打开接着补
async function finishSearch() {
  const session = await getSession();
  if (!(session.clips || []).length) {
    return { ok: false, error: 'EMPTY_SESSION', session, progress: progressFrom(session) };
  }
  const stray = Lib.pendingClips(session).length;
  const note = Lib.buildNote(session);
  if (!note.id) note.id = uid('note');
  // 重新打开过的笔记要更新原来那条，不能又存一条新的
  const prev = await readNote(note.id);
  if (prev) note.startedAt = prev.startedAt || note.startedAt;
  await writeNote(note);
  await saveSession(emptySession());
  return { ok: true, note, stray, session: emptySession(), progress: progressFrom(emptySession()) };
}

async function reopenNote(id) {
  const note = await readNote(id);
  if (!note) return { ok: false, error: 'NO_NOTE' };
  const session = Object.assign(emptySession(), Lib.sessionFromNote(note), {
    productMode: 'search',
    lastActivityAt: Date.now()
  });
  session.keywords = Lib.suggestKeywords(session.intent, session.clips, session.summary);
  await saveSession(session);
  return { ok: true, note, session, progress: progressFrom(session) };
}

function enableSidePanelOnAction() {
  bindNotebookSidePanel();
}

async function fetchImageDataUrl(url) {
  if (!url) throw new Error('NO_URL');
  if (String(url).indexOf('data:') === 0) return url;
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const mime = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return 'data:' + mime + ';base64,' + btoa(binary);
}

/* ---------- 图片：存 600px 能读清小字的版本，原图只留链接 ---------- */

const IMAGE_MAX_W = 600;
const IMAGE_QUALITY = 0.6;
const STORAGE_BUDGET = 9 * 1024 * 1024; // 配额约 10MB，留 1MB 余量

async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(binary);
}

async function downscaleDataUrl(dataUrl, maxW, quality) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return { dataUrl, width: 0, height: 0 };
  }
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = bitmap.width > maxW ? maxW / bitmap.width : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
  return { dataUrl: await blobToDataUrl(out), width: w, height: h, origW: bitmap.width, origH: bitmap.height };
}

function dataUrlBytes(dataUrl) {
  const i = String(dataUrl || '').indexOf(',');
  if (i < 0) return 0;
  return Math.round((dataUrl.length - i - 1) * 0.75);
}

async function storageUsage() {
  let used = 0;
  try {
    used = await chrome.storage.local.getBytesInUse(null);
  } catch (_) { /* 有些版本不支持，当 0 处理 */ }
  return { used, budget: STORAGE_BUDGET, left: Math.max(0, STORAGE_BUDGET - used) };
}

// 图片既要存，又不能把配额撑爆，所以存之前先算一次
async function prepareImage(source) {
  const raw = source.dataUrl && String(source.dataUrl).indexOf('data:') === 0
    ? source.dataUrl
    : await fetchImageDataUrl(source.url || source.dataUrl);
  const shrunk = await downscaleDataUrl(raw, IMAGE_MAX_W, IMAGE_QUALITY);
  const bytes = dataUrlBytes(shrunk.dataUrl);
  const room = await storageUsage();
  if (bytes > room.left) {
    return {
      ok: false,
      error: '本地空间快满了（已用 ' + Math.round(room.used / 1024 / 1024 * 10) / 10
        + 'MB / 约 9MB）。删掉几条旧笔记再收这张图。',
      raw
    };
  }
  return {
    ok: true,
    raw,
    image: {
      dataUrl: shrunk.dataUrl,
      width: shrunk.width,
      height: shrunk.height,
      bytes,
      srcUrl: source.url || '',
      origW: shrunk.origW || 0,
      origH: shrunk.origH || 0
    }
  };
}

async function cropDataUrl(dataUrl, crop) {
  if (!dataUrl) throw new Error('NO_IMAGE');
  if (!crop || crop.full || !(crop.w > 8 && crop.h > 8)) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return dataUrl;
  const bitmap = await createImageBitmap(blob);
  const imgW = Number(crop.imgW) || bitmap.width;
  const imgH = Number(crop.imgH) || bitmap.height;
  const scaleX = bitmap.width / imgW;
  const scaleY = bitmap.height / imgH;
  const sx = Math.max(0, Math.round(Number(crop.x) * scaleX));
  const sy = Math.max(0, Math.round(Number(crop.y) * scaleY));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(Number(crop.w) * scaleX)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(Number(crop.h) * scaleY)));
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const buf = await out.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return 'data:image/jpeg;base64,' + btoa(binary);
}

async function ocrDataUrl(dataUrl) {
  const LM = globalThis.LanguageModel;
  if (LM && typeof LM.create === 'function') {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const availability = await LM.availability({
        expectedInputs: [{ type: 'image' }, { type: 'text' }]
      }).catch(() => LM.availability());
      if (availability !== 'unavailable') {
        const session = await LM.create({
          expectedInputs: [{ type: 'image' }, { type: 'text' }]
        }).catch(() => LM.create());
        let raw = '';
        try {
          raw = await session.prompt([
            {
              role: 'user',
              content: [
                { type: 'text', value: '请只提取图片中的文字，保持原顺序，不要总结、不要翻译。' },
                { type: 'image', value: blob }
              ]
            }
          ]);
        } catch (_) {
          raw = await session.prompt('请提取用户稍后会粘贴的图中文字。若看不到图，回复空。');
        }
        if (session.destroy) session.destroy();
        const text = String(raw || '').trim();
        if (text && text.length > 4) return { ok: true, text: text.slice(0, 4000), source: 'ondevice' };
      }
    } catch (e) {
      /* fall through */
    }
  }
  return { ok: false, error: 'NO_OCR' };
}

function setupContextMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'fg-add-clip',
      title: '收入记事本',
      contexts: ['selection'],
      documentUrlPatterns: ['https://www.xiaohongshu.com/*']
    });
  });
}

chrome.contextMenus && chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'fg-add-clip' || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, {
    type: 'ADD_SELECTION',
    text: info.selectionText || ''
  }, () => void chrome.runtime.lastError);
});


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (p) => p.then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));

  if (msg.type === 'ADD_TIME') {
    reply(addTime(msg.platform, msg.mode || 'idle', msg.seconds).then(() => ({ ok: true })));
    return true;
  }
  if (msg.type === 'UPDATE_SETTINGS') {
    updateAlarm();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'GET_STATS') {
    const today = new Date().toISOString().slice(0, 10);
    chrome.storage.local.get(`stats_${today}`).then((data) => {
      sendResponse({ stats: data[`stats_${today}`] || {} });
    });
    return true;
  }
  if (msg.type === 'OPEN_BILIBILI_CLEAN') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/bilibili-clean.html') });
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'OPEN_STATS') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/stats.html') });
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'BILI_API') {
    reply(biliApiProxy(msg.url));
    return true;
  }
  if (msg.type === 'GET_SESSION') {
    reply(getSession().then(async (session) => {
      let settings = await getSettings();
      if (hasApiKey(settings) && !(settings.apiStatus && settings.apiStatus.at)) {
        const probe = await probeRemote(settings);
        settings = await writeApiStatus({ ok: probe.ok, error: probe.ok ? '' : probe.error });
      }
      const ai = await describeAi();
      return {
        ok: true,
        session,
        progress: progressFrom(session),
        hasKey: hasApiKey(settings),
        ai,
        keyHint: keyHint(settings),
        settings: publicSettings(settings),
        browseSilence: await getBrowseSilence()
      };
    }));
    return true;
  }
  if (msg.type === 'GET_XHS_ENTRY') {
    reply((async () => {
      const session = await getSession();
      let browseSilence = await getBrowseSilence();
      if (msg.forInit && browseSilence) {
        const tabs = await chrome.tabs.query({});
        const senderId = sender.tab && sender.tab.id;
        const others = tabs.filter(tabLooksXhs).filter((t) => t.id !== senderId);
        if (!others.length) {
          await setBrowseSilence(false);
          browseSilence = false;
        }
      }
      return {
        ok: true,
        browseSilence,
        intent: session.intent || '',
        productMode: session.productMode,
        startedAt: session.startedAt || 0
      };
    })());
    return true;
  }
  if (msg.type === 'SET_PRODUCT_MODE') {
    reply((async () => {
      const session = await getSession();
      const mode = msg.mode === 'browse' ? 'browse' : 'search';
      session.productMode = mode;
      if (mode === 'search' && !session.intent && msg.intent) {
        session.intent = String(msg.intent).trim();
      }
      await setBrowseSilence(mode === 'browse');
      await saveSession(session);
      await broadcastApplyMode(mode);
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'START_SEARCH_SESSION') {
    reply(startSearchSession(msg.intent, msg.platform, {
      keepBrowseSilence: msg.keepBrowseSilence,
      productMode: msg.productMode
    }).then((session) => ({
      ok: true, session, progress: progressFrom(session)
    })));
    return true;
  }
  if (msg.type === 'ADD_CLIP') {
    reply(addClip(msg.clip || msg).then((r) => Object.assign({ ok: r.ok !== false }, r)));
    return true;
  }
  if (msg.type === 'ADD_IMAGE_CLIP') {
    reply((async () => {
      const prepared = await prepareImage({ dataUrl: msg.dataUrl, url: msg.url }).catch((e) => ({
        ok: false, error: '图片读不出来：' + (e.message || e)
      }));
      if (!prepared.ok) return { ok: false, error: prepared.error };

      // OCR 靠 Chrome 本机模型，经常不可用；失败不影响图片入库
      let text = String(msg.text || '').trim();
      let ocrError = '';
      if (!text) {
        const ocr = await ocrDataUrl(prepared.raw).catch((e) => ({ ok: false, error: e.message || String(e) }));
        if (ocr && ocr.ok && ocr.text) text = String(ocr.text).trim();
        else ocrError = (ocr && ocr.error) || '没识别出文字';
      }
      const r = await addClip({
        title: msg.title || '',
        text: text ? ('【图线索】' + text) : '',
        topics: msg.topics || [],
        url: msg.srcUrl || msg.url || '',
        source: 'image',
        boardId: msg.boardId || '',
        image: prepared.image
      });
      return Object.assign({ ok: r.ok !== false, ocrError, hasText: Boolean(text) }, r);
    })());
    return true;
  }
  if (msg.type === 'STORAGE_USAGE') {
    reply(storageUsage().then((u) => ({ ok: true, usage: u })));
    return true;
  }
  if (msg.type === 'CREATE_BOARD') {
    reply((async () => {
      const session = await getSession();
      const name = String(msg.name || '').trim().slice(0, 40) || '新板块';
      const existing = (session.boards || []).filter((b) => b.name === name)[0];
      if (existing) return { ok: true, board: existing, session };
      const board = Lib.emptyBoard(name, true);
      session.boards = (session.boards || []).concat([board]);
      await saveSession(session);
      return { ok: true, board, session };
    })());
    return true;
  }
  if (msg.type === 'ASSIGN_CLIP') {
    reply((async () => {
      const session = await getSession();
      const board = (session.boards || []).filter((b) => b.id === msg.boardId)[0];
      if (!board) return { ok: false, error: 'NO_BOARD' };
      const clip = (session.clips || []).filter((c) => c.id === msg.clipId)[0];
      if (!clip) return { ok: false, error: 'NO_CLIP' };
      Lib.placeClip(session.boards, clip.id, board.id);
      session.clips = (session.clips || []).map((c) =>
        (c.id === clip.id ? Object.assign({}, c, { boardId: board.id }) : c));
      refreshSummary(session, '挪进「' + board.name + '」了。这块的结论要等下次「整理」才会更新');
      await saveSession(session);
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'ORGANIZE_NOW' || msg.type === 'RESUMMARIZE_NOW') {
    reply(organizeNow().then(async (r) => Object.assign(r, { ai: await describeAi() })));
    return true;
  }
  if (msg.type === 'REDO_ROUND' || msg.type === 'REGENERATE_ALL') {
    reply(redoRound().then(async (r) => Object.assign(r, { ai: await describeAi(), redone: true })));
    return true;
  }
  if (msg.type === 'RENAME_BOARD') {
    reply((async () => {
      const session = await getSession();
      const name = String(msg.name || '').trim().slice(0, 40);
      const board = (session.boards || []).filter((b) => b.id === msg.boardId)[0];
      if (!board || !name) return { ok: false, error: 'NO_BOARD' };
      board.name = name;
      board.updatedAt = Date.now();
      refreshSummary(session, '改名了。AI 以后只会沿用这个名字');
      await saveSession(session);
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'DELETE_BOARD') {
    reply((async () => {
      const session = await getSession();
      const board = (session.boards || []).filter((b) => b.id === msg.boardId)[0];
      if (!board) return { ok: false, error: 'NO_BOARD' };
      session.boards = (session.boards || []).filter((b) => b.id !== board.id);
      session.showRedo = false;
      refreshSummary(session, '「' + board.name + '」删了，收集箱里的原文还在');
      await saveSession(session);
      persistNote(session).catch(() => {});
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'REMOVE_CLIP') {
    reply((async () => {
      const session = await getSession();
      session.clips = (session.clips || []).filter((c) => c.id !== msg.clipId);
      (session.boards || []).forEach((b) => {
        b.clipIds = (b.clipIds || []).filter((x) => x !== msg.clipId);
      });
      session.boards = (session.boards || []).filter((b) =>
        b.pinned || (b.cards || []).length || (b.clipIds || []).length
      );
      refreshSummary(session, '删掉一条材料');
      await saveSession(session);
      persistNote(session).catch(() => {});
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'DELETE_CARD') {
    reply((async () => {
      const session = await getSession();
      let found = false;
      (session.boards || []).forEach((b) => {
        const next = (b.cards || []).filter((c) => c.id !== msg.cardId);
        if (next.length !== (b.cards || []).length) found = true;
        b.cards = next;
      });
      if (!found) return { ok: false, error: 'NO_CARD' };
      session.showRedo = false;
      refreshSummary(session, '删掉一张卡片');
      await saveSession(session);
      persistNote(session).catch(() => {});
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'EDIT_FACT') {
    reply((async () => {
      const session = await getSession();
      const board = (session.boards || []).filter((b) => b.id === msg.boardId)[0];
      if (!board) return { ok: false, error: 'NO_BOARD' };
      const key = msg.kind === 'unsettled' ? 'unsettled' : 'settled';
      const text = String(msg.text || '').trim().slice(0, 160);
      if (msg.action === 'remove') {
        board[key] = (board[key] || []).filter((x) => x !== msg.text);
      } else if (text && (board[key] || []).indexOf(text) === -1) {
        board[key] = (board[key] || []).concat([text]).slice(0, 10);
      }
      board.updatedAt = Date.now();
      refreshSummary(session, msg.action === 'remove' ? '删掉一条结论' : '加了一条你自己的结论');
      await saveSession(session);
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'APPLY_PROPOSAL') {
    reply((async () => {
      const session = await getSession();
      const proposal = (session.proposals || []).filter((p) => p.id === msg.id)[0];
      if (!proposal) return { ok: false, error: 'NO_PROPOSAL' };
      const applied = Lib.applyProposal(session.boards, proposal);
      if (!applied.ok) return { ok: false, error: 'CANNOT_APPLY' };
      session.boards = applied.boards;
      session.proposals = (session.proposals || []).filter((p) => p.id !== msg.id);
      session.clips = (session.clips || []).map((c) =>
        Object.assign({}, c, { boardId: Lib.ownerOf(session.boards, c.id) }));
      refreshSummary(session, '按你的意思改了：' + proposal.text);
      await saveSession(session);
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'DISMISS_PROPOSAL') {
    reply((async () => {
      const session = await getSession();
      session.proposals = (session.proposals || []).filter((p) => p.id !== msg.id);
      await saveSession(session);
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'ACK_REDO') {
    reply((async () => {
      const session = await getSession();
      session.showRedo = false;
      await saveSession(session);
      return { ok: true, session };
    })());
    return true;
  }
  if (msg.type === 'EDIT_CLIP') {
    reply((async () => {
      const session = await getSession();
      const clip = (session.clips || []).filter((c) => c.id === msg.clipId)[0];
      if (!clip) return { ok: false, error: 'NO_CLIP' };
      if (msg.text != null) clip.text = String(msg.text).slice(0, MAX_CLIP_TEXT);
      if (msg.title != null) clip.title = String(msg.title).trim().slice(0, 120);
      clip.analyzed = false;
      session.boards = Lib.markSourceEdited(session.boards, clip.id);
      session.showRedo = false;
      refreshSummary(session, '原文改了，会重新进整理');
      await saveSession(session);
      persistNote(session).catch(() => {});
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'EDIT_CARD') {
    reply((async () => {
      const session = await getSession();
      let card = null;
      (session.boards || []).forEach((b) => {
        (b.cards || []).forEach((c) => { if (c.id === msg.cardId) card = c; });
      });
      if (!card) return { ok: false, error: 'NO_CARD' };
      if (msg.title != null) card.title = String(msg.title).trim().slice(0, 40);
      if (msg.body != null) card.body = String(msg.body);
      card.edited = true;
      card.stale = false;
      session.showRedo = false;
      await saveSession(session);
      persistNote(session).catch(() => {});
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'REGEN_CARD') {
    reply((async () => {
      const session = await getSession();
      let from = [];
      session.boards = (session.boards || []).map((b) => {
        const hit = (b.cards || []).filter((c) => c.id === msg.cardId)[0];
        if (!hit) return b;
        from = (hit.fromClipIds || []).slice();
        b.cards = (b.cards || []).filter((c) => c.id !== msg.cardId);
        return b;
      });
      session.clips = (session.clips || []).map((c) =>
        (from.indexOf(c.id) === -1 ? c : Object.assign({}, c, { analyzed: false })));
      session.showRedo = false;
      await saveSession(session);
      return organizeNow();
    })());
    return true;
  }
  if (msg.type === 'NEW_SESSION') {
    reply((async () => {
      const session = await getSession();
      let note = null;
      if ((session.clips || []).length) note = await persistNote(session);
      const next = emptySession();
      next.productMode = session.productMode;
      next.intent = session.intent;
      next.platform = session.platform;
      await saveSession(next);
      return { ok: true, note, session: next, progress: progressFrom(next) };
    })());
    return true;
  }
  if (msg.type === 'EXPORT_MD') {
    reply((async () => {
      const session = await getSession();
      return { ok: true, markdown: Lib.exportMarkdown(session), filename: (session.intent || '搜索笔记') + '.md' };
    })());
    return true;
  }
  if (msg.type === 'ACCEPT_EMERGING_INTENT') {
    reply((async () => {
      const session = await getSession();
      const next = String(msg.intent || (session.summary && session.summary.emerging_intent) || '').trim();
      if (!next) return { ok: false, error: 'NO_INTENT' };
      session.intent = next;
      session.summary = Object.assign({}, session.summary || {}, { intent_ready: false });
      session.keywords = Lib.suggestKeywords(session.intent, session.clips, session.summary);
      await saveSession(session);
      return { ok: true, session, progress: progressFrom(session) };
    })());
    return true;
  }
  if (msg.type === 'CLASSIFY_NOTE') {
    reply(classifyNote(msg.note || msg).then((r) => Object.assign({ ok: true }, r)));
    return true;
  }
  if (msg.type === 'DRIFT_ACTION') {
    reply(handleDriftAction(msg.action, msg.payload || {}).then((r) => Object.assign({ ok: true }, r)));
    return true;
  }
  if (msg.type === 'SAVE_API_CONFIG') {
    reply((async () => {
      const data = await chrome.storage.local.get('settings');
      const rawKey = msg.apiKey != null ? normalizeKey(msg.apiKey) : normalizeKey((data.settings || {}).apiKey);
      const settings = Object.assign({}, data.settings || {}, {
        apiKey: rawKey,
        apiBase: msg.apiBase || (data.settings || {}).apiBase || 'https://api.deepseek.com',
        apiModel: msg.apiModel || (data.settings || {}).apiModel || 'deepseek-chat',
        apiStatus: { at: Date.now(), ok: false, error: '' }
      });
      await chrome.storage.local.set({ settings });
      if (!rawKey) {
        await writeApiStatus({ ok: false, error: '' });
        return { ok: true, hasKey: false, cleared: true, ai: await describeAi() };
      }
      const probe = await probeRemote(settings);
      await writeApiStatus({ ok: probe.ok, error: probe.ok ? '' : probe.error });
      return {
        ok: probe.ok,
        hasKey: hasApiKey(settings),
        error: probe.error || '',
        ai: await describeAi()
      };
    })());
    return true;
  }
  if (msg.type === 'SAVE_SETTINGS') {
    reply((async () => {
      const data = await chrome.storage.local.get('settings');
      const next = Object.assign({}, data.settings || {});
      if (msg.focusMode != null) next.focusMode = normalizeFocusMode(msg.focusMode);
      if (msg.channelPolicy) next.channelPolicy = normalizeChannelPolicy(Object.assign({}, next.channelPolicy, msg.channelPolicy));
      await chrome.storage.local.set({ settings: next });
      return { ok: true, settings: publicSettings(next) };
    })());
    return true;
  }
  if (msg.type === 'OPEN_SIDE_PANEL') {
    reply(openSidePanel(sender));
    return true;
  }
  if (msg.type === 'FINISH_SEARCH') {
    reply(finishSearch());
    return true;
  }
  if (msg.type === 'LIST_NOTES') {
    reply(listNotes().then((notes) => ({ ok: true, notes })));
    return true;
  }
  if (msg.type === 'GET_NOTE') {
    reply(readNote(msg.id).then((note) => ({ ok: Boolean(note), note })));
    return true;
  }
  if (msg.type === 'REOPEN_NOTE') {
    reply(reopenNote(msg.id));
    return true;
  }
  if (msg.type === 'DELETE_NOTE') {
    reply(deleteNote(msg.id).then(() => listNotes()).then((notes) => ({ ok: true, notes })));
    return true;
  }
  if (msg.type === 'RESUME_SEARCH') {
    reply(getSession().then((s) => {
      s.finished = false;
      return saveSession(s).then(() => ({ ok: true, session: s, progress: progressFrom(s) }));
    }));
    return true;
  }
  if (msg.type === 'SEARCH_KEYWORD') {
    reply((async () => {
      const keyword = String(msg.keyword || '').trim();
      const session = await getSession();
      session.pendingSearch = keyword;
      await saveSession(session);
      const demoPath = chrome.runtime.getURL('src/pages/demo.html');
      const tabs = await chrome.tabs.query({});
      const demoTab = tabs.find((t) => (t.url || '').indexOf(demoPath) === 0);
      if (demoTab) return { ok: true, demo: true, keyword };
      const url = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword) + '&source=web_explore_feed';
      const tabId = sender.tab && sender.tab.id;
      if (tabId) {
        await chrome.tabs.update(tabId, { url });
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) await chrome.tabs.update(tab.id, { url });
      }
      return { ok: true, url };
    })());
    return true;
  }
  if (msg.type === 'OPEN_DEMO') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/demo.html') });
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'DISMISS_CANDIDATE') {
    reply(getSession().then((s) => {
      s.candidate = null;
      return saveSession(s).then(() => ({ ok: true, session: s }));
    }));
    return true;
  }
  if (msg.type === 'FETCH_IMAGE') {
    reply(fetchImageDataUrl(msg.url).then((dataUrl) => ({ ok: true, dataUrl })).catch((e) => ({ ok: false, error: e.message })));
    return true;
  }
  if (msg.type === 'OCR_IMAGE') {
    reply((async () => {
      const src = msg.dataUrl || '';
      if (!src || src.indexOf('data:') !== 0) {
        return { ok: false, error: 'NO_IMAGE' };
      }
      let dataUrl = src;
      try {
        dataUrl = await cropDataUrl(src, msg.crop);
      } catch (e) {
        dataUrl = src;
      }
      return ocrDataUrl(dataUrl);
    })());
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  enableSidePanelOnAction();
  setupContextMenu();
  const data = await chrome.storage.local.get('settings');
  const settings = Object.assign({ interruptInterval: 0 }, data.settings || {});
  if (data.settings == null) await chrome.storage.local.set({ settings });
});

enableSidePanelOnAction();
setupContextMenu();
updateAlarm();
bindXhsBrowseSilenceWatch();
