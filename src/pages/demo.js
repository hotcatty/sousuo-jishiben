function send(msg) {
  return new Promise((resolve) => {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ ok: false, mock: true });
      return;
    }
    chrome.runtime.sendMessage(msg, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || { ok: false });
    });
  });
}

const NOTES = [
  {
    id: 'itinerary',
    title: '广州三日游',
    tags: ['广州', '三日游'],
    match: ['广州三日游', '三日', '路线'],
    cover: '#111111',
    coverText: '三日路线',
    body: [
      '广州三日游',
      '第1站：花城广场→海心沙亚运公园→广州塔→珠江夜游码头→二沙岛艺术公园',
      '第2站：陈家祠→荔湾湖公园→永庆坊→上下九步行街→沙面岛',
      '第3站：中山纪念堂→越秀公园→南越王博物院→北京路步行街→大佛寺',
      '-',
      '✌广州美食',
      '🔥南村柴火鸡饭'
    ].join('\n')
  },
  {
    id: 'rank',
    title: '广州三日游别乱走｜本地人排的必去清单',
    tags: ['广州', '三日游', '攻略'],
    match: ['广州三日游', '广州 必去', '广州景点', '必去', '清单'],
    cover: '#c45c26',
    coverText: 'TOP 清单',
    body: [
      '别一上来就排 Day 1 Day 2。先看哪些点真的值得去：广州塔（新中轴）、陈家祠（老城）、越秀公园和镇海楼、沙面、永庆坊、珠江夜游。',
      '这份名单只解决「去哪」，不解决「怎么串」。很多人把塔、祠堂、沙面塞进同一天，走回头路。'
    ].join('\n\n')
  },
  {
    id: 'map',
    title: '一张图看懂广州：三天三个板块',
    tags: ['路线', '分区'],
    match: ['广州三日游', '分区', '路线', '珠江两岸', '新中轴', '老城'],
    cover: '#3f6b4e',
    coverText: '分区图',
    clue: true,
    body: [
      '作者把广州收成三块，建议三日游一天一块：',
      '珠江两岸：沙面、沿江路、夜游。适合晚上，不要和老城景点硬拼。',
      '老城（越秀 / 荔湾）：陈家祠、镇海楼、永庆坊。走路能串，博物馆要看闭馆日。',
      '新中轴：广州塔、花城广场。塔是地标也是亚运遗产，要不要上塔另说。',
      '这张图不是行程表，是骨架。先认不认这三块，再补每个点的故事和票。'
    ].join('\n\n')
  },
  {
    id: 'tower',
    title: '广州塔为什么叫小蛮腰？亚运遗产和夜景',
    tags: ['广州塔', '历史'],
    match: ['广州塔的由来', '广州塔', '小蛮腰', '亚运', '历史 故事'],
    cover: '#2c4c6e',
    coverText: '由来',
    body: [
      '2010 年亚运会前落成，造型像细腰，所以叫小蛮腰。它不只是网红打卡，是广州新中轴的超级工程。',
      '夜景从花城广场看和上塔看完全不是一回事。想了解「为什么这座塔在这里」，搜亚运、中轴、珠江新城比搜打卡机位更有用。'
    ].join('\n\n')
  },
  {
    id: 'chen',
    title: '陈家祠不是网红店，是广东装饰的百科',
    tags: ['陈家祠', '老城'],
    match: ['陈家祠的故事', '陈家祠', '荔湾', '老城'],
    cover: '#8a5a2b',
    coverText: '祠堂',
    body: [
      '陈家祠是广东民间装饰的集中展示：木雕、砖雕、陶塑。很多人只拍门口，十分钟走人。',
      '和分区图对上：它属于老城那一块，适合和永庆坊、沙面分开或紧挨着走，不要和新中轴的塔挤同一天。'
    ].join('\n\n')
  },
  {
    id: 'yuexiu',
    title: '越秀区一天：镇海楼、五羊、博物馆闭馆日',
    tags: ['越秀', '博物馆'],
    match: ['越秀区的历史', '越秀', '镇海楼', '博物馆', '闭馆'],
    cover: '#5a6b3e',
    coverText: '越秀',
    body: [
      '越秀是广州的老城底。镇海楼看城、五羊石像是城市符号，广东省博物馆和广州博物馆常常周一闭馆。',
      '如果你认「一天一块老城」，先查闭馆日再出门，比多搜两篇网红咖啡有用。'
    ].join('\n\n')
  },
  {
    id: 'ticket',
    title: '广州塔门票避坑：要不要上塔、几点去',
    tags: ['门票', '避坑'],
    match: ['广州塔门票', '门票', '避坑', '票价', '几点'],
    cover: '#a15c38',
    coverText: '避坑',
    body: [
      '上塔要单独买观光票，夜景票更贵。很多人在广场拍完就够了，不一定要上楼。',
      '日落前后人最多。工作日黄昏比周末晚上舒服。不要在官网和黄牛之间反复横跳，先决定「看不看塔顶」。'
    ].join('\n\n')
  },
  {
    id: 'beauty',
    title: '今日份身材｜夜拍也这么穿',
    tags: ['穿搭', '夜拍'],
    match: ['穿搭', '美女', '身材'],
    cover: '#c45c7a',
    coverText: '信息流',
    drift: true,
    body: '穿搭和夜拍机位。和三日游的骨架、票、故事都没关系，是信息流常见的带走。'
  }
];

const MAP_SRC = '../../assets/demo/guangzhou-map.jpg';
const MAP_HTML = `
  <img class="map" id="clue-map" src="${MAP_SRC}" alt="广州可以分为3个板块" draggable="true"
       title="可以直接拖到右边任意板块" />
  <p class="draghint">↑ 这张图可以直接拖到右边某个板块里。存进去会压到 600px 宽（约 83KB），小字还读得清。</p>`;

let query = '广州三日游';
let currentId = null;
let activeBoardId = '';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function blobOf(note) {
  return [note.title, note.body, (note.tags || []).join(' '), (note.match || []).join(' ')].join(' ').toLowerCase();
}

function matchesQuery(note, q) {
  const n = String(q || '').trim().toLowerCase();
  if (!n) return true;
  const blob = blobOf(note);
  return n.split(/\s+/).filter((t) => t.length >= 2).some((tok) => blob.indexOf(tok) !== -1);
}

function visibleNotes() {
  const hits = NOTES.filter((n) => !n.drift && matchesQuery(n, query));
  const distractor = NOTES.find((n) => n.drift);
  if (distractor && query === '广州三日游') hits.push(distractor);
  return hits;
}

async function coachText() {
  const data = await send({ type: 'GET_SESSION' });
  const clips = (data.session && data.session.clips) || [];
  const pending = clips.filter((c) => !c.analyzed).length;
  const titles = clips.map((c) => c.title || '').join(' ');
  if (!clips.length) {
    return '先点开左边笔记，把内容复制粘贴进右边收集箱。攒几条之后点「快速整理」，AI 会写成带标题的卡片，原文还在收集箱里。';
  }
  if (pending >= 2) {
    return '攒了 ' + pending + ' 条未读。点右边「快速整理」，原文会置灰，整理结果出现在新的分区里。';
  }
  if (titles.indexOf('分区') === -1 && titles.indexOf('图') === -1) {
    return '名单有了。那张三分区图适合当线索收下——它是骨架，不是行程表。';
  }
  if (titles.indexOf('由来') === -1 && titles.indexOf('祠') === -1) {
    return '骨架有了。点右边「建议接着搜」里的词，或自己改顶部搜索。也可以故意点开那条夜拍笔记，看会不会拦你。';
  }
  if (titles.indexOf('门票') === -1 && titles.indexOf('避坑') === -1) {
    return '背景有了。循环没变，只是查询更细：门票、闭馆日、要不要上塔。';
  }
  return '材料已经能收成一篇自己的笔记。导出、历史、设置都在右上角。新建会自动把当前这条存进历史。';
}

async function renderCoach() {
  document.getElementById('coach').textContent = await coachText();
}

function renderFeed() {
  currentId = null;
  const list = visibleNotes();
  document.getElementById('view').innerHTML = list.length
    ? `<div class="cards">${list.map((n) => `
        <button class="card" type="button" data-id="${n.id}">
          <div class="cover" style="background:${n.cover}">${esc(n.coverText)}</div>
          <div class="body"><h3>${esc(n.title)}</h3><p>${esc(n.body.slice(0, 72))}…</p></div>
        </button>`).join('')}</div>`
    : '<p class="empty-feed">这条搜索词在 Demo 里没有对应笔记。换一个右边给出的词，或改回「广州三日游」。</p>';
  document.getElementById('view').querySelectorAll('.card').forEach((el) => {
    el.addEventListener('click', () => openNote(el.getAttribute('data-id')));
  });
}

async function openNote(id) {
  const note = NOTES.find((n) => n.id === id);
  if (!note) return;
  currentId = id;
  const classifyNote = {
    title: note.title,
    topics: note.tags,
    snippet: note.body.slice(0, 280),
    url: 'https://www.xiaohongshu.com/explore/demo-' + note.id,
    noteId: 'demo-' + note.id
  };
  document.getElementById('view').innerHTML = `
    <article class="note">
      <button class="back" id="back" type="button">← 返回搜索</button>
      <h1>${esc(note.title)}</h1>
      <div class="tags">${note.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      ${note.clue ? MAP_HTML : ''}
      ${note.body.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('')}
      <div class="actions">
        <button class="fg-btn fg-btn-ink" id="save" type="button">收入这篇</button>
        ${note.clue ? '<button class="fg-btn fg-btn-ghost" id="save-clue" type="button">把这张图当线索收下</button>' : ''}
      </div>
    </article>`;
  document.getElementById('back').addEventListener('click', () => { renderFeed(); renderCoach(); });
  document.getElementById('save').addEventListener('click', () => saveNote(note, false));
  const clueMap = document.getElementById('clue-map');
  if (clueMap) clueMap.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/fg-clue', JSON.stringify({
      title: note.title,
      src: clueMap.src,
      text: ''
    }));
    e.dataTransfer.effectAllowed = 'copy';
  });
  const clueBtn = document.getElementById('save-clue');
  if (clueBtn) clueBtn.addEventListener('click', () => saveNote(note, true));

  const r = await send({ type: 'CLASSIFY_NOTE', note: classifyNote });
  if (r.label === 'drifting') {
    const save = document.getElementById('save');
    if (save) save.hidden = true;
    if (clueBtn) clueBtn.hidden = true;
    showDrift(note, classifyNote, r);
  }
}

async function saveNote(note, asClue) {
  const text = asClue
    ? ('【图线索】' + note.body.replace(/\n+/g, ' '))
    : (note.title + '\n' + note.body);
  const r = await send({
    type: 'ADD_CLIP',
    clip: {
      title: note.title,
      text,
      topics: note.tags,
      url: 'https://www.xiaohongshu.com/explore/demo-' + note.id,
      source: asClue ? 'image-clue' : 'note'
    }
  });
  const btn = document.getElementById(asClue ? 'save-clue' : 'save');
  if (btn) btn.textContent = r.ok ? '已收入右边收集箱' : (r.error || '没进去，再点一次');
  renderCoach();
}

function showDrift(note, payload, result) {
  const old = document.getElementById('fg-drift');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'fg-drift';
  wrap.className = 'fg-guess';
  wrap.innerHTML = `
    <div class="fg-guess-msg">
      <span>这篇好像和搜索无关，不要开小差！</span>
    </div>
    <div class="fg-guess-actions">
      <button class="fg-guess-back" id="d-back" type="button">回到搜索</button>
      <button class="fg-guess-ok" id="d-ok" type="button">有关，我自有考虑</button>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#d-back').addEventListener('click', () => {
    wrap.remove();
    query = '广州三日游';
    document.getElementById('q').value = query;
    renderFeed();
    renderCoach();
    send({ type: 'DRIFT_ACTION', action: 'back_to_search', payload });
  });
  wrap.querySelector('#d-ok').addEventListener('click', async () => {
    wrap.remove();
    const save = document.getElementById('save');
    const clueBtn = document.getElementById('save-clue');
    if (save) save.hidden = false;
    if (clueBtn) clueBtn.hidden = false;
    await send({ type: 'DRIFT_ACTION', action: 'related', payload: Object.assign({}, payload, { snippet: note.body }) });
    renderCoach();
  });
}

function applyQuery(next) {
  query = String(next || '').trim() || '广州三日游';
  document.getElementById('q').value = query;
  document.getElementById('top-meta').textContent = '正在搜：' + query + ' · 点开笔记再收入，右边会跟着转';
  renderFeed();
  renderCoach();
}


function renderNb() {
  if (window.FocusGuardPanel) return FocusGuardPanel.refresh();
}

function imgSrcFromHtml(html) {
  const m = /<img[^>]+src="([^"]+)"/i.exec(String(html || ''));
  return m ? m[1] : '';
}

// 左边拖出来的东西：图片文件、页面里的图、选中的文字，或板块之间挪材料
async function dragPayload(dt) {
  const clipId = dt.getData('application/fg-clip');
  if (clipId) return { kind: 'move', clipId };

  const files = [].slice.call(dt.files || []).filter((f) => /^image\//.test(f.type));
  if (files.length) {
    return { kind: 'image', dataUrl: await fileToDataUrl(files[0]), title: files[0].name };
  }

  const clue = dt.getData('application/fg-clue');
  if (clue) {
    const parsed = JSON.parse(clue);
    return { kind: 'image', url: parsed.src, title: parsed.title, text: parsed.text };
  }

  const uri = dt.getData('text/uri-list') || imgSrcFromHtml(dt.getData('text/html'));
  if (uri && (/^data:image\//.test(uri) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(uri))) {
    return { kind: 'image', url: uri, title: '' };
  }

  const text = dt.getData('text/plain');
  if (text && text.trim()) return { kind: 'text', text: text.trim() };
  return null;
}

// 重绘会把这行提示冲掉，所以存下来跟着一起渲染
let dropMsg = '';

function dropNote(message) {
  dropMsg = message || '';
  const el = document.getElementById('drop-note');
  if (el) el.textContent = dropMsg;
}

async function dropInto(boardId, payload) {
  if (!payload) return;
  const note = NOTES.filter((n) => n.id === currentId)[0];

  if (payload.kind === 'move') {
    await send({ type: 'ASSIGN_CLIP', clipId: payload.clipId, boardId });
    return;
  }

  if (payload.kind === 'image') {
    dropNote('正在压缩这张图并识别文字…');
    const r = await send({
      type: 'ADD_IMAGE_CLIP',
      boardId,
      dataUrl: payload.dataUrl || '',
      url: payload.url || '',
      text: payload.text || '',
      title: payload.title || (note ? note.title : '拖进来的图'),
      topics: note ? note.tags : [],
      srcUrl: note ? 'https://www.xiaohongshu.com/explore/demo-' + note.id : ''
    });
    if (!r.ok) {
      dropNote(r.error || '这张图没收进去');
      return;
    }
    const kb = r.clip && r.clip.image ? Math.round(r.clip.image.bytes / 1024) : 0;
    dropNote(r.hasText
      ? `图收进来了（${kb}KB），文字也识别出来了。点「整理」时 AI 才会拿它去补这一块。`
      : `图收进来了（${kb}KB）。没识别出文字（${r.ocrError || '本机模型不可用'}），AI 只能把它当配图 —— 想让它参与推理，把图里的关键信息打在下面的输入框里收一条。`);
    return;
  }

  const r = await send({
    type: 'ADD_CLIP',
    boardId,
    clip: {
      boardId,
      title: payload.title || (note ? note.title : '手动拖入'),
      text: payload.text,
      topics: note ? note.tags : [],
      url: note ? 'https://www.xiaohongshu.com/explore/demo-' + note.id : '',
      source: 'drag'
    }
  });
  if (!r.ok) dropNote(r.error || '这段没收进去');
  else dropNote('收下了 ' + payload.text.trim().length + ' 字，全文都在。');
}

function wireDropTargets(nb) {
  nb.querySelectorAll('.mat').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/fg-clip', el.getAttribute('data-clip'));
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  nb.querySelectorAll('.board').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('button')) return;
      const id = el.getAttribute('data-board');
      activeBoardId = activeBoardId === id ? '' : id;
      renderNb();
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('over');
      const payload = await dragPayload(e.dataTransfer);
      if (!payload) {
        dropNote('这个东西认不出来。可以拖图片、页面里的图，或者选中的文字。');
        return;
      }
      await dropInto(el.getAttribute('data-board'), payload);
      renderNb();
    });
  });

  const dropnew = nb.querySelector('#dropnew');
  if (!dropnew) return;
  dropnew.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropnew.classList.add('over');
  });
  dropnew.addEventListener('dragleave', () => dropnew.classList.remove('over'));
  dropnew.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropnew.classList.remove('over');
    const payload = await dragPayload(e.dataTransfer);
    if (!payload) return;
    const name = window.prompt('新板块叫什么？', '新板块');
    if (!name) return;
    const created = await send({ type: 'CREATE_BOARD', name: name.trim() });
    if (!created.ok) return;
    await dropInto(created.board.id, payload);
    renderNb();
  });
}

document.getElementById('q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyQuery(e.target.value);
});

// 粘贴图片：进当前选中的板块，没选就让 AI 自己归
document.addEventListener('paste', async (e) => {
  if (e.target && e.target.closest && e.target.closest('.fgp')) return;
  const items = [].slice.call((e.clipboardData && e.clipboardData.items) || []);
  const img = items.filter((it) => /^image\//.test(it.type))[0];
  if (!img) return;
  const file = img.getAsFile();
  if (!file) return;
  e.preventDefault();
  await dropInto('', { kind: 'image', dataUrl: await fileToDataUrl(file), title: '粘贴进来的图' });
  renderNb();
});

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.fg_session) {
      const nextSession = changes.fg_session.newValue || {};
      if (nextSession.pendingSearch && nextSession.pendingSearch !== query) applyQuery(nextSession.pendingSearch);
      renderCoach();
    }
    if (changes.fg_session || changes.settings) renderNb();
  });
}

async function boot() {
  FocusGuardPanel.mount(document.getElementById('nb'), {
    send: send,
    onSearch: applyQuery,
    assetBase: 'panel-assets/'
  });
  await send({ type: 'START_SEARCH_SESSION', intent: '广州三日游', platform: 'xiaohongshu' });
  applyQuery('广州三日游');
  await FocusGuardPanel.refresh();
  if (new URLSearchParams(location.search).get('sheet') === 'settings' && FocusGuardPanel.openSheet) {
    FocusGuardPanel.openSheet('settings');
  }
}

boot();
