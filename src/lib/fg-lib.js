// Focus Guard shared logic — runs in service worker (importScripts) and Node (eval).
(function (root) {
  'use strict';

  const ENTERTAINMENT_HINTS = [
    '美女', '帅哥', '颜值', '写真', '美妆', '口红', '眼影', '穿搭', 'ootd',
    '身材', '热舞', '清凉', '性感', '福利姬',
    '八卦', '恋情', '吃瓜', '明星', '追星', '爱豆', 'idol', '综艺',
    '王者荣耀', '英雄联盟', '游戏高光', '精彩集锦',
    '吃播', '探店', '演唱会', '甜宠', '磕cp', '娱乐圈'
  ];

  const DOMAINS = [
    {
      name: 'home',
      intent: ['家居', '家具', '装修', '收纳', '独居', '小户型', '北欧', '沙发', '餐桌', '出租屋', '改造'],
      note: ['家居', '家具', '装修', '收纳', '沙发', '餐桌', '改造', '出租屋', '小户型', '宜家', '开箱', '好物', '客厅', '卧室', '灯', '床', '柜', '尺寸', '避雷', '单品'],
      off: ENTERTAINMENT_HINTS
    },
    {
      name: 'study',
      intent: ['考研', '英语', '单词', '四级', '六级', '雅思', '托福', '论文', '复习'],
      note: ['考研', '英语', '单词', '真题', '阅读', '语法', '记忆', '笔记', '复习', '四级', '六级'],
      off: ENTERTAINMENT_HINTS.concat(['游戏', '王者', '吃播', '穿搭'])
    },
    {
      name: 'diet',
      intent: ['减脂', '食谱', '健身餐', '轻食', '热量', '蛋白质'],
      note: ['减脂', '食谱', '便当', '鸡胸', '沙拉', '热量', '轻食', '一周', '备餐'],
      off: ['吃播', '探店', '火锅', '烧烤', '夜宵', '奶茶'].concat(ENTERTAINMENT_HINTS)
    },
    {
      name: 'digital',
      intent: ['macbook', '笔记本', '电脑', '选购', '手机', '数码'],
      note: ['macbook', 'air', 'pro', 'm3', 'm4', '对比', '评测', '学生党', '选购', '数码', '笔记本'],
      off: ENTERTAINMENT_HINTS.concat(['穿搭', '追星', '演唱会'])
    },
    {
      name: 'skincare',
      intent: ['护肤', '成分', '精华', '屏障', '维a', '酸'],
      note: ['护肤', '成分', '精华', '屏障', '表活', '保湿'],
      off: ENTERTAINMENT_HINTS
    },
    {
      name: 'career',
      intent: ['招聘', '岗位', '求职', '设计师', '产品经理', '产品设计师', '面试', '转行', '校招', '社招', 'hc'],
      note: ['招聘', '岗位', '要求', '职责', '面试', '转行', 'figma', 'hc', '设计师', '产品', '作品集', 'jd', '能力', '经验', '薪'],
      off: ENTERTAINMENT_HINTS
    },
    {
      name: 'travel',
      intent: ['旅游', '三日', '攻略', '景点', '游玩', '旅行'],
      note: ['景点', '路线', '门票', '攻略', '避坑', '博物馆', '分区', '祠', '必去'],
      off: ENTERTAINMENT_HINTS
    }
  ];

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[|｜·•、，。！？!?,.：:；;（）()【】\[\]{}<>《》""''`~\-_/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(s) {
    const t = normalize(s);
    if (!t) return [];
    const out = [];
    const seen = Object.create(null);
    function add(tok) {
      if (!tok || tok.length < 1) return;
      if (tok.length === 1 && /[a-z0-9]/.test(tok)) return;
      if (seen[tok]) return;
      seen[tok] = 1;
      out.push(tok);
    }
    t.split(' ').forEach((part) => {
      if (/[a-z0-9]/.test(part)) add(part);
      const chars = Array.from(part);
      chars.forEach((ch) => {
        if (/[\u4e00-\u9fff]/.test(ch)) add(ch);
      });
      for (let i = 0; i < chars.length - 1; i++) {
        if (/[\u4e00-\u9fff]/.test(chars[i]) && /[\u4e00-\u9fff]/.test(chars[i + 1])) {
          add(chars[i] + chars[i + 1]);
        }
      }
    });
    return out;
  }

  function includesAny(text, list) {
    const n = normalize(text);
    if (!n) return [];
    return list.filter((w) => n.includes(normalize(w)));
  }

  function domainForIntent(intent) {
    const n = normalize(intent);
    let best = null;
    let score = 0;
    DOMAINS.forEach((d) => {
      const hits = d.intent.filter((w) => n.includes(normalize(w))).length;
      if (hits > score) {
        score = hits;
        best = d;
      }
    });
    return score > 0 ? best : null;
  }

  function overlapScore(intent, noteText) {
    const a = tokenize(intent);
    const b = new Set(tokenize(noteText));
    if (!a.length || !b.size) return 0;
    let hit = 0;
    a.forEach((tok) => {
      if (tok.length >= 2 && b.has(tok)) hit += 1;
    });
    const denom = a.filter((tok) => tok.length >= 2).length || a.length;
    return hit / denom;
  }

  function noteBlob(note) {
    const topics = Array.isArray(note.topics) ? note.topics.join(' ') : (note.topics || '');
    return [note.title, topics, note.snippet].filter(Boolean).join(' ');
  }

  /**
   * Conservative local classifier. Uncertain → unknown (do not nag).
   */
  function classifyHeuristic(intent, note) {
    const title = (note && note.title) || '';
    const blob = noteBlob(note || {});
    if (!normalize(intent)) {
      return { label: 'unknown', confidence: 'low', reason: '没有本次目的，无法判断' };
    }
    if (!normalize(title) && !normalize(blob)) {
      return { label: 'unknown', confidence: 'low', reason: '笔记标题几乎是空的' };
    }
    if (/^\.{2,}$/.test(normalize(title)) || normalize(title) === '...') {
      return { label: 'unknown', confidence: 'low', reason: '标题信息不足' };
    }

    const domain = domainForIntent(intent);
    const onHits = domain ? includesAny(blob, domain.note) : [];
    const offHits = includesAny(blob, (domain && domain.off) || ENTERTAINMENT_HINTS);
    const ov = overlapScore(intent, blob);

    if (domain && offHits.length && onHits.length === 0 && ov < 0.35) {
      return {
        label: 'drifting',
        confidence: 'high',
        reason: '更像娱乐内容，和这次要搜的事对不上'
      };
    }
    if (domain && onHits.length >= 1) {
      return {
        label: 'on_goal',
        confidence: onHits.length >= 2 || ov >= 0.2 ? 'high' : 'medium',
        reason: '标题/话题还在这次目的附近'
      };
    }
    if (ov >= 0.35) {
      return { label: 'on_goal', confidence: 'medium', reason: '和目的关键词有明显重合' };
    }
    if (!domain && offHits.length && ov < 0.15) {
      return {
        label: 'drifting',
        confidence: 'high',
        reason: '看起来是娱乐内容，和目的无关'
      };
    }
    return { label: 'unknown', confidence: 'low', reason: '信息不够，先不打断' };
  }

  function parseJsonFromModel(text) {
    if (!text) return null;
    let s = String(text).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    try {
      return JSON.parse(s);
    } catch (_) {
      return null;
    }
  }

  function normalizeLabel(label) {
    const s = String(label || '').toLowerCase().trim();
    if (s === 'on_goal' || s === 'on-goal' || s === 'on goal') return 'on_goal';
    if (s === 'drifting' || s === 'off_goal' || s === 'off-goal') return 'drifting';
    return 'unknown';
  }

  function buildClassifyPrompt(intent, note, positiveLabels) {
    const positives = (positiveLabels || []).slice(-5).map((p, i) =>
      `${i + 1}. ${p.title || ''} ${(p.topics || []).join(' ')}`
    ).join('\n');
    return [
      {
        role: 'system',
        content: [
          '你是搜索监工，不是聊天助手。判断「当前笔记」是否还在用户「本次目的」上。',
          '只根据标题、话题、短摘录判断，不要臆造没出现的内容。',
          '输出 JSON：{"label":"on_goal|drifting|unknown","confidence":"high|low","reason":"不超过30字"}',
          '规则：',
          '- on_goal：岗位要求、HC、转行经验、行业讨论、好物测评等仍在服务这个目的',
          '- drifting：美女、颜值、热舞、八卦、游戏高光、和目的无关的娱乐。这类必须第一时间标 drifting',
          '- unknown：标题空洞、中英混杂看不懂、或你没把握。不确定就 unknown',
          '- 用户标记过「这就是我要的」的相近笔记，倾向 on_goal',
          '- 不要因为笔记写得好就判 on_goal；只看是否服务本次目的',
          '- confidence 为 low 时必须用 unknown'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `本次目的：${intent}`,
          `笔记标题：${(note && note.title) || '（空）'}`,
          `话题：${((note && note.topics) || []).join(' / ') || '（无）'}`,
          `短摘录：${((note && note.snippet) || '').slice(0, 280) || '（无）'}`,
          positives ? `用户本会话认定相关的笔记：\n${positives}` : '用户尚未纠正过模型。'
        ].join('\n')
      }
    ];
  }

  function inferChecklist(intent) {
    const n = normalize(intent);
    if (/家居|家具|装修|收纳|独居|购买/.test(n)) {
      return ['关键单品', '尺寸/户型是否合适', '预算参考', '避雷/踩坑', '搭配/场景'];
    }
    if (/减脂|食谱|餐/.test(n)) {
      return ['可执行菜品', '食材/热量', '备餐方法'];
    }
    if (/选购|对比|评测/.test(n)) {
      return ['候选型号', '优缺点对比', '价格/渠道', '避坑'];
    }
    if (/旅游|三日|攻略|景点|游玩|出行|旅行/.test(n)) {
      return ['路线骨架', '美食', '门票预约', '交通时段'];
    }
    if (/考研|英语|单词|复习/.test(n)) {
      return ['方法/计划', '资料推荐', '可执行练习'];
    }
    return [];
  }

  function clipText(clip) {
    return normalize([clip.title, clip.text, clip.topics].filter(Boolean).join(' '));
  }

  function textMatchesItem(clip, item) {
    const t = clipText(clip);
    const map = {
      '关键单品': ['沙发', '桌', '椅', '柜', '灯', '床', '单品', '家具', '宜家'],
      '尺寸/户型是否合适': ['尺寸', '户型', '平米', '小户型', '厘米', 'cm', '宽'],
      '预算参考': ['预算', '价格', '元', '便宜', '性价比'],
      '避雷/踩坑': ['避雷', '踩坑', '坑', '别买', '不建议'],
      '搭配/场景': ['搭配', '场景', '客厅', '卧室', '改造', '氛围'],
      '可执行菜品': ['食谱', '做法', '便当', '鸡胸', '减脂'],
      '食材/热量': ['热量', '食材', '蛋白', 'kcal'],
      '备餐方法': ['备餐', '一周', '冷冻', '步骤'],
      '候选型号': ['air', 'pro', '型号', 'm3', 'm4', '对比'],
      '优缺点对比': ['优点', '缺点', '对比', '区别'],
      '价格/渠道': ['价格', '官网', '教育优惠', '折扣'],
      '避坑': ['避坑', '坑', '别买'],
      '路线骨架': ['路线', '行程', '步行', '三日', '两日', '板块'],
      '美食': ['美食', '早茶', '小吃', '餐厅', '夜市', '探店'],
      '门票预约': ['门票', '预约', '开放', '闭馆', '票'],
      '交通时段': ['地铁', '班次', '时刻', '怎么去', '交通'],
      '方法/计划': ['方法', '计划', '记忆', '安排'],
      '资料推荐': ['真题', '资料', '书', 'app'],
      '可执行练习': ['练习', '打卡', '单词']
    };
    const keys = map[item] || tokenize(item);
    return keys.some((k) => t.includes(normalize(k)));
  }

  const THEME_RULES = [
    { name: '岗位要求', keys: ['招聘', 'hc', '岗位', '要求', '职责', '能力', 'figma', 'chatgpt', 'claude', 'gemini', 'cursor', 'paper', '熟练', 'jd'] },
    { name: '招聘信息', keys: ['字节', '腾讯', '阿里', '美团', '小红书', '校招', '社招', '秋招', 'base', '薪', 'hc'] },
    { name: '经验与观点', keys: ['转行', '经验', '分享', '见解', '吐槽', '真实', '路径', '面试', '观察'] },
    { name: '片区与路线', keys: ['分区', '板块', '路线', '一天一块', '三日', '两岸', '中轴', '图线索'] },
    { name: '推荐名单', keys: ['必去', '排行', '清单', '景点', '必玩'] },
    { name: '背景与故事', keys: ['由来', '历史', '亚运', '故事', '祠', '博物馆'] },
    { name: '票务与避坑', keys: ['门票', '票价', '避坑', '闭馆', '几点', '要不要'] }
  ];

  function clipPreview(c, limit) {
    const title = String((c && c.title) || '').trim();
    const line = String((c && c.text) || '').replace(/\s+/g, ' ').trim().slice(0, limit || 90);
    if (title && line && line.indexOf(title) === -1) return title + ' · ' + line;
    if (line || title) return line || title;
    return (c && c.image) ? '一张图（没识别出文字）' : '一条摘录';
  }

  function clusterThemes(intent, clips) {
    const list = Array.isArray(clips) ? clips : [];
    if (!list.length) return [];
    const order = [];
    const buckets = Object.create(null);
    function add(name, clip) {
      if (!buckets[name]) {
        buckets[name] = { name: name, bullets: [] };
        order.push(name);
      }
      const line = clipPreview(clip, 60);
      if (line && buckets[name].bullets.indexOf(line) === -1) buckets[name].bullets.push(line);
    }
    list.forEach((clip) => {
      const blob = clipText(clip);
      let best = null;
      let bestScore = 0;
      THEME_RULES.forEach((rule) => {
        const score = rule.keys.filter((k) => blob.includes(normalize(k))).length;
        if (score > bestScore) {
          bestScore = score;
          best = rule.name;
        }
      });
      add(best || '已收材料', clip);
    });
    return order.map((k) => buckets[k]);
  }

  /* ---------- 板块：收集箱永久持有原文；板块只持有 AI 派生卡片 ---------- */

  let boardSeq = 0;
  let cardSeq = 0;
  function newBoardId() {
    boardSeq += 1;
    return 'bd_' + Date.now().toString(36) + '_' + boardSeq.toString(36);
  }
  function newCardId() {
    cardSeq += 1;
    return 'cd_' + Date.now().toString(36) + '_' + cardSeq.toString(36);
  }
  function newRoundId() {
    return 'rd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function emptyCard(opts) {
    const o = opts || {};
    return {
      id: o.id || newCardId(),
      title: String(o.title || '').trim().slice(0, 40),
      body: String(o.body || ''),
      fromClipIds: (o.fromClipIds || []).slice(),
      edited: Boolean(o.edited),
      stale: Boolean(o.stale),
      roundId: o.roundId || '',
      at: o.at || Date.now()
    };
  }

  function emptyBoard(name, pinned) {
    return {
      id: newBoardId(),
      name: String(name || '新板块').slice(0, 40),
      clipIds: [],
      cards: [],
      settled: [],
      unsettled: [],
      keywords: [],
      pinned: Boolean(pinned),
      updatedAt: Date.now()
    };
  }

  function ruleNameFor(clip) {
    const blob = clipText(clip);
    let best = null;
    let bestScore = 0;
    THEME_RULES.forEach((rule) => {
      const score = rule.keys.filter((k) => blob.includes(normalize(k))).length;
      if (score > bestScore) {
        bestScore = score;
        best = rule.name;
      }
    });
    return best;
  }

  function cloneBoards(boards) {
    return (boards || []).map((b) => ({
      id: b.id,
      name: b.name,
      pinned: Boolean(b.pinned),
      clipIds: (b.clipIds || []).slice(),
      cards: (b.cards || []).map((c) => Object.assign({}, c, {
        fromClipIds: (c.fromClipIds || []).slice()
      })),
      settled: (b.settled || []).slice(),
      unsettled: (b.unsettled || []).slice(),
      keywords: (b.keywords || []).slice(),
      updatedAt: b.updatedAt || Date.now()
    }));
  }

  function allCards(boards) {
    const out = [];
    (boards || []).forEach((b) => {
      (b.cards || []).forEach((c) => out.push(c));
    });
    return out;
  }

  function boardHasContent(b) {
    return Boolean(b && (b.pinned || (b.cards || []).length || (b.clipIds || []).length));
  }

  // 本地归类：没有模型时用规则，但必须尊重已有板块和用户手动指定的归属
  function localBoards(intent, clips, prevBoards) {
    return localOrganize(intent, prevBoards || [], clips || []).boards;
  }

  function boardsToThemes(boards, clips) {
    const byId = Object.create(null);
    (clips || []).forEach((c) => { byId[c.id] = c; });
    return (boards || []).map((b) => ({
      id: b.id,
      name: b.name,
      bullets: (b.cards || []).length
        ? (b.cards || []).map((c) => c.title || String(c.body || '').slice(0, 60)).filter(Boolean).slice(0, 6)
        : (b.clipIds || []).map((cid) => byId[cid]).filter(Boolean).map((c) => clipPreview(c, 60)).slice(0, 6),
      settled: (b.cards || []).map((c) => c.title).filter(Boolean),
      unsettled: b.unsettled || [],
      search_keywords: b.keywords || []
    }));
  }

  /* ---------- 整理：用户手动触发一次，原文不动，产出派生卡片 ---------- */

  function isPending(clip) {
    return Boolean(clip) && !clip.analyzed;
  }

  function pendingClips(session) {
    return (((session || {}).clips) || []).filter(isPending);
  }

  function unorganizedCount(session) {
    return pendingClips(session).length;
  }

  function emptyDiff() {
    return { at: 0, source: '', newBoards: [], newClips: {}, newCards: {}, newSettled: {}, resolved: {} };
  }

  function diffIsEmpty(diff) {
    const d = diff || {};
    return !(d.newBoards || []).length
      && !Object.keys(d.newClips || {}).length
      && !Object.keys(d.newCards || {}).length
      && !Object.keys(d.newSettled || {}).length
      && !Object.keys(d.resolved || {}).length;
  }

  // 板块的 clipIds 记下「哪些原文贡献过这块」，一条材料可以出现在收集箱，同时被多张派生卡引用
  function placeClip(boards, clipId, boardId) {
    let hit = null;
    (boards || []).forEach((b) => {
      if (b.id === boardId) hit = b;
    });
    if (!hit) return false;
    hit.clipIds = hit.clipIds || [];
    if (hit.clipIds.indexOf(clipId) === -1) hit.clipIds.unshift(clipId);
    return true;
  }

  function ownerOf(boards, clipId) {
    const hit = (boards || []).filter((b) => (b.clipIds || []).indexOf(clipId) !== -1)[0];
    return hit ? hit.id : '';
  }

  function firstLine(text) {
    return String(text || '').split(/\n+/)[0].replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  const THEME_SECTIONS = [
    { kind: 'time', name: '时间', re: /时间|时刻|日期|初亏|食甚|复圆|几点/ },
    { kind: 'place', name: '地点', re: /地点|观测点|位置|在哪看|最佳观测/ },
    { kind: 'params', name: '参数', re: /拍摄参数|参数|相机|镜头|\bISO\b|快门|光圈|焦距|拍摄/ },
    { kind: 'food', name: '美食', re: /美食|早茶|小吃|餐厅|夜市|探店/ },
    { kind: 'route', name: '路线', re: /路线|行程|怎么走/ },
    { kind: 'stay', name: '居住', re: /居住|住宿|酒店|民宿|入住/ }
  ];

  function headingTheme(line) {
    const t = String(line || '').trim()
      .replace(/^#{1,3}\s+/, '')
      .replace(/^[✌✔✅📍⏰📷🏠🍽🛣]\s*/, '')
      .replace(/[:：]\s*$/, '')
      .replace(/\s+/g, '');
    if (!t || t.length > 18) return null;
    for (let i = 0; i < THEME_SECTIONS.length; i++) {
      if (THEME_SECTIONS[i].re.test(t)) return THEME_SECTIONS[i];
    }
    if (/^#{1,3}\s+\S/.test(String(line || '')) && t.length <= 16) {
      return { kind: 'head', name: t };
    }
    return null;
  }

  function chunksFromHits(raw, clip, hits, getName, getKind) {
    const chunks = [];
    hits.forEach((h, i) => {
      const from = h.index;
      const to = i + 1 < hits.length ? hits[i + 1].index : raw.length;
      const body = raw.slice(from, to).slice(h.len).trim();
      if (!body && !getName(h)) return;
      chunks.push({
        title: getName(h),
        body: body || getName(h),
        fromClipIds: [clip.id],
        kind: getKind(h)
      });
    });
    return chunks.length >= 2 ? chunks : null;
  }

  function splitByThemeHeadings(raw, clip) {
    const lines = String(raw || '').split('\n');
    const hits = [];
    let offset = 0;
    lines.forEach((line) => {
      const def = headingTheme(line);
      if (def) hits.push({ index: offset, len: line.length, def });
      offset += line.length + 1;
    });
    if (hits.length < 2) return null;
    return chunksFromHits(raw, clip, hits, (h) => h.def.name, (h) => h.def.kind);
  }

  function splitByInlineLabels(raw, clip) {
    const re = /(时间|地点|观测点|拍摄参数|参数|路线|美食|居住|住宿)\s*[:：]/g;
    const hits = [];
    let m;
    while ((m = re.exec(raw))) {
      hits.push({ index: m.index, len: m[0].length, label: m[1] });
    }
    if (hits.length < 2) return null;
    const kindOf = {
      时间: 'time', 地点: 'place', 观测点: 'place',
      拍摄参数: 'params', 参数: 'params',
      路线: 'route', 美食: 'food', 居住: 'stay', 住宿: 'stay'
    };
    const nameOf = {
      时间: '时间', 地点: '地点', 观测点: '地点',
      拍摄参数: '参数', 参数: '参数',
      路线: '路线', 美食: '美食', 居住: '居住', 住宿: '居住'
    };
    return chunksFromHits(raw, clip, hits, (h) => nameOf[h.label] || h.label, (h) => kindOf[h.label] || 'head');
  }

  // 把一篇混在一起的材料拆成可读的几段：主题小标题 / 第N站 / 第N天，以及「美食」单独成块
  function splitClipPieces(clip) {
    const raw = String((clip && clip.text) || '').replace(/\r/g, '').trim();
    if (!raw) {
      return [{
        title: (clip && clip.title) || '',
        body: (clip && clip.image) ? '一张图（没识别出文字）' : '',
        fromClipIds: [clip.id]
      }];
    }
    const themed = splitByThemeHeadings(raw, clip) || splitByInlineLabels(raw, clip);
    if (themed) return themed;
    const chunks = [];
    const foodAt = raw.search(/(?:^|\n)\s*(?:✌|✔|✅)?\s*广州美食\s*(?:\n|$)/);
    let route = raw;
    let food = '';
    if (foodAt >= 0) {
      route = raw.slice(0, foodAt).trim();
      food = raw.slice(foodAt).replace(/^(?:✌|✔|✅)?\s*/, '').trim();
    }
    const parts = [];
    const hits = [];
    const stopRe = /(?:^|\n)\s*((?:第[123一二三][站天]|Day\s*[123]))[:：.\s]*/gi;
    let m;
    while ((m = stopRe.exec(route))) {
      hits.push({ head: m[1].replace(/\s+/g, ''), index: m.index, len: m[0].length });
    }
    hits.forEach((h, i) => {
      if (i === 0 && h.index > 0 && route.slice(0, h.index).trim()) {
        const intro = route.slice(0, h.index).trim();
        // 标题行（「广州三日游」）不当成一张卡
        if (intro.length > 12 && intro !== (clip && clip.title)) {
          parts.push({ head: '', body: intro });
        }
      }
      const from = h.index;
      const to = i + 1 < hits.length ? hits[i + 1].index : route.length;
      parts.push({ head: h.head, body: route.slice(from, to).trim() });
    });
    if (!parts.length) {
      chunks.push({
        title: (clip && clip.title) || firstLine(route),
        body: route,
        fromClipIds: [clip.id],
        kind: food ? 'route' : ''
      });
    } else {
      parts.forEach((p) => {
        if (!p.body) return;
        chunks.push({
          title: titleForStop(p.head, p.body),
          body: p.body.replace(/^(?:第[123一二三][站天]|Day\s*[123])[:：.\s]*/i, '').replace(/\n[-–—]\s*$/, '').trim() || p.body,
          fromClipIds: [clip.id],
          kind: 'route'
        });
      });
    }
    if (food) {
      chunks.push({
        title: '广州美食',
        body: food.replace(/^(?:✌|✔|✅)?\s*广州美食\s*/, '').trim(),
        fromClipIds: [clip.id],
        kind: 'food'
      });
    }
    return chunks;
  }

  function titleForStop(head, body) {
    const blob = head + ' ' + body;
    if (/花城广场|广州塔|珠江夜游|海心沙|二沙岛/.test(blob) && /花城|广州塔|夜游/.test(blob)) {
      return '第一天:滨江新城';
    }
    if (/陈家祠|荔湾|永庆坊|上下九|沙面/.test(blob)) return '第二天:荔枝老城';
    if (/中山纪念堂|越秀|南越王|北京路|大佛寺/.test(blob)) return '第三天:越秀老城';
    if (/第1|第一|Day\s*1/i.test(head)) return '第一天';
    if (/第2|第二|Day\s*2/i.test(head)) return '第二天';
    if (/第3|第三|Day\s*3/i.test(head)) return '第三天';
    return head || firstLine(body);
  }

  function shortIntentStem(intent) {
    return String(intent || '').trim()
      .replace(/三日游|攻略|怎么看|如何|怎么搜|搜索/g, '')
      .replace(/\s+/g, '')
      .slice(0, 10);
  }

  function namedTheme(intent, theme) {
    const stem = shortIntentStem(intent);
    const t = String(theme || '').trim();
    if (!t) return stem || '还没归类';
    if (!stem) return t;
    if (stem.indexOf(t) !== -1) return stem;
    if (t.indexOf(stem) !== -1) return t;
    return stem + t;
  }

  function boardNameForPiece(piece, clip, intent) {
    const blob = [piece.title, piece.body, clip && clip.title, intent].join('');
    if (piece.kind === 'food' || /美食|早茶|小吃/.test(piece.title + piece.body)) {
      if (/广州/.test(blob)) return '广州美食';
      return namedTheme(intent, '美食');
    }
    if (piece.kind === 'route' || /第[123一二三][站天]|三日|路线/.test(piece.title + piece.body + ((clip && clip.title) || ''))) {
      if (/广州/.test(blob) && /三日|路线/.test(blob)) return '三日路线';
      return namedTheme(intent, '路线');
    }
    if (piece.kind === 'stay') return namedTheme(intent, '居住');
    if (piece.kind === 'time') return namedTheme(intent, '时间');
    if (piece.kind === 'place') return namedTheme(intent, '地点');
    if (piece.kind === 'params') return namedTheme(intent, '参数');
    if (piece.kind === 'head' && piece.title) return namedTheme(intent, piece.title);
    return ruleNameFor(clip) || namedTheme(intent, piece.title) || '还没归类';
  }

  const NEW_BODY_MAX = 1600;
  const NEW_BODY_BUDGET = 20000;

  function buildOrganizePrompt(intent, boards, clips, pending, extra) {
    const all = clips || [];
    const clipRef = all.map((c) => c.id);
    const refOf = Object.create(null);
    all.forEach((c, i) => { refOf[c.id] = '#' + (i + 1); });
    const isNew = Object.create(null);
    (pending || []).forEach((c) => { isNew[c.id] = true; });
    const avoid = ((extra && extra.avoidNames) || []).filter(Boolean);

    const boardRef = Object.create(null);
    const unsettledRef = Object.create(null);
    const boardLines = (boards || []).map((b, i) => {
      const ref = 'B' + (i + 1);
      boardRef[b.id] = ref;
      unsettledRef[b.id] = (b.unsettled || []).slice();
      const frozen = (b.cards || []).filter((c) => c.edited).map((c) => '「' + (c.title || firstLine(c.body)) + '」').join(' ');
      const cards = (b.cards || []).map((c) => (c.title || firstLine(c.body)) + (c.edited ? '（用户改过，冻结）' : '')).join('；') || '（空）';
      return [
        `${ref} ${b.name} ｜ 已有卡片：${cards}`,
        frozen ? `   冻结（绝对不许改、不许删）：${frozen}` : '',
        (b.unsettled || []).length
          ? `   这块还缺：${(b.unsettled || []).map((u, j) => 'U' + (j + 1) + ' ' + u).join('；')}`
          : ''
      ].filter(Boolean).join('\n');
    }).join('\n');

    const oldLines = all.filter((c) => !isNew[c.id])
      .map((c) => `${refOf[c.id]} ${clipPreview(c, 40)}`.slice(0, 64)).join('\n');
    const per = (pending || []).length
      ? Math.max(400, Math.min(NEW_BODY_MAX, Math.floor(NEW_BODY_BUDGET / pending.length)))
      : NEW_BODY_MAX;
    const newLines = (pending || []).map((c) => {
      const raw = String(c.text || '');
      const cut = raw.length > per;
      const body = (cut ? raw.slice(0, per) + '…（正文还有 ' + (raw.length - per) + ' 字没给你，按已给的部分判断，不要猜后面）' : raw)
        || (c.image ? '（只有一张图，没识别出文字。不要编图里的内容，把它当这一块的配图）' : '');
      return `${refOf[c.id]} [${c.source || 'clip'}]${c.image ? '[带图]' : ''} ${c.title || '（无标题）'} | ${body}`;
    }).join('\n');

    return {
      clipRef,
      boardRef,
      unsettledRef,
      messages: [
        {
          role: 'system',
          content: [
            '你是搜索记事本里的整理员。用户自己在搜、自己决定收什么。原文永远留在收集箱，你只产出「派生卡片」。',
            '派生卡片 = 按原文重新组织后的可读卡片：可以切开、可以重排、可以写小标题，但不要添加原文没有的判断、评价、建议或补全。',
            '',
            '铁律：',
            '- 数字、价格、时间、地名、专有名词必须逐字来自原文，不许换算、不许补全、不许改写。',
            '- 不许改板块名，不许删板块，不许改或删用户编辑过的卡片（标了冻结的）。',
            '- 不要写「适合」「建议」「可以看出」这类判断句。卡片正文只陈述材料里有的事实。',
            '- 用户自己建的空板块要优先往里面放，不要无视它另起炉灶。',
            avoid.length ? ('- 用户对上一版不满意，请换一种分法，避开这些板块名：' + avoid.join('、')) : '',
            '',
            '本轮要做的：',
            '1. place：每条新材料归进一个现有板块（只是归属，原文仍在收集箱）。',
            '2. new_boards：材料里出现了不同主题，必须拆成多个板块，不要把一篇混着的笔记全塞进同一个 tab。',
            '   主题来自原文小标题或明显分类。例子：月全食 →「月全食时间」「月全食地点」「月全食参数」；旅游 →「路线」「美食」「居住」。',
            '   板块名短、像 tab，不要写成完整攻略标题。最多 8 个新板块。',
            '3. cards：给受影响的板块写派生卡片。一条材料可以拆成多张卡，每张卡只属于一个主题。',
            '   不要把时间、地点、参数、路线、美食写成一篇完整攻略。这是搜索记事本，不是代写攻略。',
            '4. keywords / next_searches：下一搜的「小红书搜索词」，不是百度高级语法，更不是攻略正文。',
            '   - 每个词像人打进小红书搜索框：短、自然、2–12 字，尽量不用空格。',
            '   - 禁止把一串地点用空格拼在一起。错误：「广州 陈家祠 沙面 步行」；正确：「沙面步行」或「陈家祠门票」。',
            '   - 禁止重复用户已经在搜的整句目的。',
            '   - 分两类，缺哪类补哪类：',
            '     a) 方向：这次场景还漏的维度。旅游常见：美食、路线、门票/预约。只给材料里还没覆盖的。',
            '     b) 细节：材料里已经出现的具体点，但还缺可执行信息。例如已有广州塔 → 「广州塔预约」。',
            '   - 不要把没在材料里的事实写进卡片；搜索词只负责把人带去搜。',
            '',
            '输出 JSON：',
            '{"place":[{"clip":"#8","board":"B1"}],',
            '"new_boards":[{"name":"板块名","clips":["#9"]}],',
            '"cards":[{"board":"B1","title":"第一天:滨江新城","body":"花城广场→广州塔→……","clips":["#1"]}],',
            '"updates":[{"board":"B1","keywords":["广州塔预约","沙面夜景"],"unsettled_add":["还没看到具体班次"],"resolved":["U1"]}],',
            '"emerging_intent":"比原始关键词更清楚的一句话目的","intent_ready":true,',
            '"next_searches":[{"keyword":"广州美食","why":"还没看吃什么"},{"keyword":"广州塔预约","why":"路线里有广州塔，还缺预约"}]}',
            '',
            'keywords 和 next_searches 必须是能直接搜的短词（「广州早茶」而不是「广州 早茶 茶楼 本地人 推荐 店名」）。',
            '材料少于 2 条时 intent_ready=false。禁止百分比和完成度。'
          ].filter(Boolean).join('\n')
        },
        {
          role: 'user',
          content: [
            `原始目的：${intent}`,
            boardLines ? `现有板块（不许改名、不许删、冻结的卡片不许动）：\n${boardLines}` : '现有板块：（还没有，这是第一次整理）',
            oldLines ? `已有材料（只给标题）：\n${oldLines}` : '',
            `本轮新收、等你重写成卡片的材料：\n${newLines || '（没有）'}`
          ].filter(Boolean).join('\n\n')
        }
      ]
    };
  }

  function normalizeProposals(rows, ctx) {
    const refToId = ctx.refToId;
    const byId = ctx.byId;
    const clipIdOf = ctx.clipIdOf;
    const out = [];
    let seq = 0;
    (Array.isArray(rows) ? rows.slice(0, 3) : []).forEach((row) => {
      const kind = String((row && row.kind) || '').toLowerCase().trim();
      const boardId = refToId[String((row && row.board) || '').trim()] || '';
      const intoId = refToId[String((row && row.into) || '').trim()] || '';
      const to = String((row && row.to) || '').trim().slice(0, 40);
      const why = String((row && row.why) || '').trim().slice(0, 120);
      const clipIds = (Array.isArray(row && row.clips) ? row.clips : [])
        .map(clipIdOf).filter(Boolean);
      seq += 1;
      const id = 'pp_' + Date.now().toString(36) + '_' + seq;
      if (kind === 'rename' && byId[boardId] && to && to !== byId[boardId].name) {
        out.push({ id, kind, boardId, to, why, text: `把「${byId[boardId].name}」改名成「${to}」` });
      } else if (kind === 'merge' && byId[boardId] && byId[intoId] && boardId !== intoId) {
        out.push({ id, kind, boardId, intoId, why, text: `把「${byId[boardId].name}」并进「${byId[intoId].name}」` });
      } else if (kind === 'split' && byId[boardId] && to && clipIds.length) {
        out.push({ id, kind, boardId, to, clipIds, why, text: `把「${byId[boardId].name}」里的 ${clipIds.length} 条拆成「${to}」` });
      } else if (kind === 'move' && byId[intoId] && clipIds.length) {
        out.push({ id, kind, intoId, clipIds, why, text: `把 ${clipIds.length} 条挪进「${byId[intoId].name}」` });
      }
    });
    return out;
  }

  function applyProposal(boards, proposal) {
    const next = cloneBoards(boards);
    const byId = Object.create(null);
    next.forEach((b) => { byId[b.id] = b; });
    const p = proposal || {};
    if (p.kind === 'rename' && byId[p.boardId] && p.to) {
      byId[p.boardId].name = String(p.to).slice(0, 40);
    } else if (p.kind === 'merge' && byId[p.boardId] && byId[p.intoId]) {
      (byId[p.boardId].clipIds || []).forEach((cid) => placeClip(next, cid, p.intoId));
      byId[p.intoId].cards = (byId[p.intoId].cards || []).concat(byId[p.boardId].cards || []);
      byId[p.intoId].keywords = byId[p.intoId].keywords.concat(byId[p.boardId].keywords)
        .filter((s, i, a) => a.indexOf(s) === i).slice(0, 8);
      return { boards: next.filter((b) => b.id !== p.boardId), ok: true };
    } else if (p.kind === 'split' && p.to) {
      const fresh = emptyBoard(p.to);
      next.push(fresh);
      (p.clipIds || []).forEach((cid) => placeClip(next, cid, fresh.id));
    } else if (p.kind === 'move' && byId[p.intoId]) {
      (p.clipIds || []).forEach((cid) => placeClip(next, cid, p.intoId));
    } else {
      return { boards: cloneBoards(boards), ok: false };
    }
    return { boards: next.filter(boardHasContent), ok: true };
  }

  function addCard(board, card, diff) {
    board.cards = board.cards || [];
    board.cards.unshift(card);
    (diff.newCards[board.id] = diff.newCards[board.id] || []).push(card.id);
    (card.fromClipIds || []).forEach((cid) => {
      if (board.clipIds.indexOf(cid) === -1) board.clipIds.unshift(cid);
      (diff.newClips[board.id] = diff.newClips[board.id] || []).push(cid);
    });
  }

  // 没有可用模型时：按站/天切开，写成派生卡片，同样不碰用户改过的卡
  function localOrganize(intent, boards, pending, extra) {
    const next = cloneBoards(boards);
    const diff = emptyDiff();
    diff.at = Date.now();
    diff.source = 'local';
    const roundId = (extra && extra.roundId) || newRoundId();
    const avoid = Object.create(null);
    ((extra && extra.avoidNames) || []).forEach((n) => { avoid[n] = true; });

    function boardByName(name) {
      let hit = next.filter((b) => b.name === name)[0];
      if (!hit) {
        const alt = avoid[name] ? (name + ' · 另分') : name;
        hit = next.filter((b) => b.name === alt)[0];
        if (!hit) {
          hit = emptyBoard(alt);
          next.push(hit);
          diff.newBoards.push(hit.id);
        }
      }
      return hit;
    }

    (pending || []).forEach((c) => {
      const preferred = c.boardId && next.filter((b) => b.id === c.boardId)[0];
      const pieces = splitClipPieces(c);
      for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i];
        const board = preferred || boardByName(boardNameForPiece(piece, c, intent));
        addCard(board, emptyCard({
          title: piece.title,
          body: piece.body,
          fromClipIds: piece.fromClipIds,
          roundId
        }), diff);
      }
    });
    return { boards: next.filter(boardHasContent), diff, proposals: [], roundId };
  }

  function mergeOrganizeResult(data, ctx) {
    const prev = (ctx && ctx.boards) || [];
    const pending = (ctx && ctx.pending) || [];
    const clipRef = (ctx && ctx.clipRef) || [];
    const boardRef = (ctx && ctx.boardRef) || {};
    const prevUnsettled = (ctx && ctx.unsettledRef) || {};
    const roundId = (ctx && ctx.roundId) || newRoundId();
    const refToId = Object.create(null);
    Object.keys(boardRef).forEach((id) => { refToId[boardRef[id]] = id; });

    const boards = cloneBoards(prev);
    const byId = Object.create(null);
    boards.forEach((b) => { byId[b.id] = b; });
    const diff = emptyDiff();
    diff.at = Date.now();
    diff.source = 'llm';
    const placed = Object.create(null);

    function clipIdOf(ref) {
      const m = /^#?(\d+)$/.exec(String(ref || '').trim());
      return m ? (clipRef[Number(m[1]) - 1] || '') : '';
    }
    function isPendingId(cid) {
      return pending.some((c) => c.id === cid);
    }
    function land(board, cid) {
      if (board.clipIds.indexOf(cid) === -1) board.clipIds.unshift(cid);
      placed[cid] = board.id;
      (diff.newClips[board.id] = diff.newClips[board.id] || []).push(cid);
    }
    function boardOf(token) {
      const t = String(token || '').trim();
      return byId[refToId[t]] || byId[t] || boards.filter((b) => b.name === t)[0] || null;
    }

    (Array.isArray(data && data.place) ? data.place : []).forEach((row) => {
      const cid = clipIdOf(row && row.clip);
      const board = boardOf(row && row.board);
      if (!cid || !isPendingId(cid) || !board) return;
      land(board, cid);
    });

    (Array.isArray(data && data.new_boards) ? data.new_boards.slice(0, 8) : []).forEach((row) => {
      const name = String((row && row.name) || '').trim().slice(0, 40);
      if (!name) return;
      let board = boards.filter((b) => b.name === name)[0];
      if (!board) {
        board = emptyBoard(name);
        boards.push(board);
        byId[board.id] = board;
        diff.newBoards.push(board.id);
      }
      (Array.isArray(row && row.clips) ? row.clips : []).forEach((ref) => {
        const cid = clipIdOf(ref);
        if (!cid || !isPendingId(cid)) return;
        land(board, cid);
      });
      if (Array.isArray(row && row.keywords) && row.keywords.length) {
        board.keywords = cleanKeywordList(row.keywords, ctx && ctx.intent).slice(0, 4);
      }
    });

    const cardRows = Array.isArray(data && data.cards) ? data.cards.slice(0, 24) : [];
    cardRows.forEach((row) => {
      const board = boardOf(row && row.board);
      if (!board) return;
      const from = (Array.isArray(row && row.clips) ? row.clips : []).map(clipIdOf).filter(Boolean);
      const title = String((row && row.title) || '').trim().slice(0, 40);
      const body = String((row && (row.body || row.text)) || '').trim();
      if (!title && !body) return;
      addCard(board, emptyCard({ title, body, fromClipIds: from, roundId }), diff);
      from.forEach((cid) => land(board, cid));
    });

    (Array.isArray(data && data.updates) ? data.updates : []).forEach((row) => {
      const board = boardOf(row && row.board);
      if (!board) return;
      (Array.isArray(row && row.resolved) ? row.resolved : []).forEach((ref) => {
        const m = /^U?(\d+)$/.exec(String(ref || '').trim());
        const text = m ? ((prevUnsettled[board.id] || [])[Number(m[1]) - 1] || '') : String(ref || '').trim();
        const at = board.unsettled.indexOf(text);
        if (!text || at === -1) return;
        board.unsettled.splice(at, 1);
        (diff.resolved[board.id] = diff.resolved[board.id] || []).push(text);
      });
      (Array.isArray(row && row.unsettled_add) ? row.unsettled_add.slice(0, 4) : []).forEach((u) => {
        const t = String(u).trim();
        if (t && board.unsettled.indexOf(t) === -1) board.unsettled.push(t);
      });
      board.unsettled = board.unsettled.slice(0, 8);
      if (Array.isArray(row && row.keywords) && row.keywords.length) {
        board.keywords = cleanKeywordList(row.keywords, ctx && ctx.intent).slice(0, 4);
      }
      // 兼容旧模型还在吐 settled_add：丢掉，不写进卡片
      board.updatedAt = Date.now();
    });

    // 模型漏掉的新材料不能凭空消失
    const strays = pending.filter((c) => !placed[c.id]);
    if (strays.length && !cardRows.length) {
      const local = localOrganize(ctx && ctx.intent, boards, strays, { roundId });
      local.boards.forEach((b) => { if (!byId[b.id]) byId[b.id] = b; });
      Object.keys(local.diff.newClips).forEach((bid) => {
        diff.newClips[bid] = (diff.newClips[bid] || []).concat(local.diff.newClips[bid]);
      });
      Object.keys(local.diff.newCards || {}).forEach((bid) => {
        diff.newCards[bid] = (diff.newCards[bid] || []).concat(local.diff.newCards[bid]);
      });
      diff.newBoards = diff.newBoards.concat(local.diff.newBoards);
      return {
        boards: local.boards.filter(boardHasContent),
        diff,
        proposals: normalizeProposals(data && data.proposals, { refToId, byId, clipIdOf }),
        roundId
      };
    }
    if (strays.length && cardRows.length) {
      const local = localOrganize(ctx && ctx.intent, boards, strays, { roundId });
      return {
        boards: local.boards.filter(boardHasContent),
        diff: Object.assign(diff, {
          newBoards: diff.newBoards.concat(local.diff.newBoards),
          newCards: Object.assign({}, diff.newCards, local.diff.newCards)
        }),
        proposals: normalizeProposals(data && data.proposals, { refToId, byId, clipIdOf }),
        roundId
      };
    }

    return {
      boards: boards.filter(boardHasContent),
      diff,
      proposals: normalizeProposals(data && data.proposals, { refToId, byId, clipIdOf }),
      roundId
    };
  }

  // 重做本轮：只拿掉这一轮 AI 写的、用户没改过的卡片，原文和用户改过的一律留下
  function stripRound(boards, roundId) {
    const next = cloneBoards(boards);
    const removedFrom = [];
    next.forEach((b) => {
      const keep = [];
      (b.cards || []).forEach((c) => {
        if (c.roundId === roundId && !c.edited) {
          (c.fromClipIds || []).forEach((id) => { if (removedFrom.indexOf(id) === -1) removedFrom.push(id); });
        } else {
          keep.push(c);
        }
      });
      b.cards = keep;
    });
    const still = Object.create(null);
    next.forEach((b) => {
      (b.cards || []).forEach((c) => {
        (c.fromClipIds || []).forEach((id) => { still[id] = true; });
      });
    });
    const unread = removedFrom.filter((id) => !still[id]);
    return {
      boards: next.filter(boardHasContent),
      unreadClipIds: unread,
      avoidNames: next.map((b) => b.name)
    };
  }

  function markSourceEdited(boards, clipId) {
    const next = cloneBoards(boards);
    next.forEach((b) => {
      const keep = [];
      (b.cards || []).forEach((c) => {
        const uses = (c.fromClipIds || []).indexOf(clipId) !== -1;
        if (!uses) { keep.push(c); return; }
        if (c.edited) keep.push(Object.assign({}, c, { stale: true }));
        // 没改过的派生卡直接拿掉，等下次整理按新原文重写
      });
      b.cards = keep;
    });
    return next.filter(boardHasContent);
  }

  function exportMarkdown(session) {
    const s = session || {};
    const lines = [];
    lines.push('# ' + (s.intent || '搜索笔记'));
    if (s.summary && s.summary.emerging_intent) lines.push('', s.summary.emerging_intent);
    lines.push('', '> 导出时间 ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
    (s.boards || []).forEach((b) => {
      lines.push('', '## ' + b.name);
      (b.cards || []).forEach((c) => {
        if (c.title) lines.push('', '### ' + c.title);
        if (c.body) lines.push('', c.body);
      });
      if ((b.keywords || []).length) {
        lines.push('', '建议继续搜：' + b.keywords.join(' · '));
      }
    });
    lines.push('', '## 收集箱');
    (s.clips || []).forEach((c, i) => {
      lines.push('', '### ' + (i + 1) + '. ' + (c.title || '一条材料'));
      if (c.url) lines.push('', c.url);
      if (c.text) lines.push('', c.text);
      if (c.image) lines.push('', '（附图 ' + c.image.width + '×' + c.image.height + '）');
    });
    return lines.join('\n') + '\n';
  }

  function guessOpenQuestions(intent, themes) {
    const n = normalize(intent);
    const names = (themes || []).map((t) => t.name).join(' ');
    const out = [];
    if (/设计师|招聘|岗位|产品|求职/.test(n)) {
      if (names.indexOf('岗位要求') === -1) out.push('岗位能力要求');
      if (names.indexOf('招聘信息') === -1) out.push('大厂 HC / 岗位信息');
      if (names.indexOf('经验与观点') === -1) out.push('从业者观点和转行路径');
    }
    if (/旅游|三日|攻略|景点|游玩|出行|旅行/.test(n)) {
      if (names.indexOf('片区') === -1 && names.indexOf('路线') === -1) out.push('路线骨架');
      if (names.indexOf('美食') === -1) out.push('美食');
      if (names.indexOf('票') === -1 && names.indexOf('预约') === -1) out.push('门票预约');
    }
    return out.slice(0, 3);
  }

  function cityHint(intent) {
    const m = String(intent || '').match(/北京|上海|广州|深圳|杭州|成都|重庆|西安|南京|苏州|武汉|长沙|厦门|青岛|大连|天津|昆明|丽江|大理|三亚|桂林|哈尔滨|沈阳|郑州|合肥|福州|南昌|南宁|海口/);
    return m ? m[0] : '';
  }

  function toXhsQuery(raw, intent) {
    let t = String(raw || '')
      .replace(/[「」『』【】\[\]()（）""'']/g, '')
      .replace(/[，,、|/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    const intentCompact = String(intent || '').replace(/\s+/g, '');
    const compact = t.replace(/\s+/g, '');
    if (intentCompact && compact === intentCompact) return '';
    const parts = t.split(' ').filter(Boolean);
    const isDim = (p) => /^(美食|早茶|小吃|路线|行程|门票|预约|开放|班次|时刻表?|避坑|住宿|交通|步行|探店)$/.test(p);
    const isGeneric = (p) => /^(码头|推荐|店名|本地人|茶楼|分享|攻略|怎么去)$/.test(p);
    if (parts.length > 2) {
      const dim = parts.filter(isDim).pop();
      const placeParts = parts.filter((p) => !isDim(p) && !isGeneric(p));
      const city = cityHint(placeParts.join('') + t) || cityHint(intent);
      const named = placeParts.filter((p) => !city || p !== city).sort((a, b) => b.length - a.length)[0];
      const place = named || city || placeParts[0] || parts[0];
      t = dim ? place + dim.replace(/时刻表/g, '时刻') : (named || parts.slice(0, 2).join(''));
    } else if (parts.length === 2 && /^[\u4e00-\u9fff0-9]+$/.test(parts.join(''))) {
      t = parts.join('');
    }
    t = t.replace(/\s+/g, '');
    if (t.length < 2 || t.length > 14) return '';
    if (intentCompact && compact.indexOf(intentCompact) === 0 && t.length - intentCompact.length < 2) return '';
    return t;
  }

  function relatedToIntent(q, intent) {
    const a = normalize(q);
    const b = normalize(intent);
    if (!a || !b) return true;
    for (let i = 0; i < b.length - 1; i++) {
      if (a.indexOf(b.slice(i, i + 2)) !== -1) return true;
    }
    const city = cityHint(intent);
    if (city) return a.indexOf(city) !== -1;
    return true;
  }

  function placeFromTitle(title) {
    let t = String(title || '').replace(/\s+/g, '').replace(/[（(].*$/, '');
    t = t.replace(/(夜景|攻略|推荐|分享|一日游|门票|预约|开放时间|游玩|探店)$/g, '');
    if (t.length >= 2 && t.length <= 6 && /^[\u4e00-\u9fff0-9]+$/.test(t)) return t;
    return '';
  }

  function cleanKeywordList(arr, intent) {
    const out = [];
    (arr || []).forEach((raw) => {
      const q = toXhsQuery(typeof raw === 'string' ? raw : (raw && raw.keyword), intent);
      if (!q || !relatedToIntent(q, intent) || out.indexOf(q) !== -1) return;
      out.push(q);
    });
    return out;
  }

  function guessNextSearches(intent, themes, clips) {
    const base = String(intent || '').trim();
    if (!base) return [];
    const city = cityHint(base);
    const blob = normalize([
      base,
      (themes || []).map((t) => (t.name || '') + ' ' + (t.bullets || []).join(' ')).join(' '),
      (clips || []).map((c) => (c.title || '') + ' ' + String(c.text || '').slice(0, 120)).join(' ')
    ].join(' '));
    const out = [];
    function add(keyword, why) {
      const q = toXhsQuery(keyword, base);
      if (!q || out.some((x) => x.keyword === q)) return;
      out.push({ keyword: q, why: why || '' });
    }
    if (city || /旅游|三日|攻略|景点|游玩|出行|旅行/.test(blob)) {
      const prefix = city || base.replace(/\s+/g, '').slice(0, 4);
      if (!/美食|早茶|小吃/.test(blob)) add(prefix + '美食', '还没看吃什么');
      if (!/路线|行程|步行|三日/.test(blob)) add(prefix + '路线', '还缺怎么走');
      if (!/门票|预约|开放/.test(blob)) add(prefix + '预约', '还没核对门票预约');
      const placeSeen = {};
      function addPlace(title, extra) {
        const place = placeFromTitle(title);
        if (!place || placeSeen[place]) return;
        if (city && place === city) return;
        placeSeen[place] = 1;
        const around = extra + blob;
        if (!new RegExp(place + '.{0,20}(预约|门票|开放|闭馆)').test(around) && !/预约|门票|开放/.test(extra)) {
          add(place + '预约', '「' + place + '」还缺预约/开放信息');
        }
      }
      (themes || []).forEach((t) => addPlace(t.name, (t.bullets || []).join('')));
      (clips || []).forEach((c) => addPlace(c.title, String(c.text || '').slice(0, 160)));
    } else if (/设计|产品|岗位|招聘|求职|面试|转行/.test(blob)) {
      add(base.replace(/\s+/g, '') + '岗位', '还缺具体录用标准');
      add(base.replace(/\s+/g, '') + '面经', '对照别人怎么走过来');
    }
    (themes || []).forEach((t) => {
      (t.search_keywords || []).forEach((k) => add(k, '继续深挖「' + t.name + '」'));
    });
    return out.slice(0, 6);
  }

  // 从「已经定好的板块」算出摘要，自己不动板块
  function summaryFor(intent, clips, boards) {
    const list = Array.isArray(clips) ? clips : [];
    const themes = boardsToThemes(boards || [], list);
    const checklist = inferChecklist(intent).map((item) => ({
      item,
      covered: list.some((c) => textMatchesItem(c, item))
    }));
    const still_open = checklist.length
      ? checklist.filter((c) => !c.covered).map((c) => c.item)
      : guessOpenQuestions(intent, themes);
    const bullets = themes.length
      ? themes.reduce((acc, t) => acc.concat(t.bullets), []).slice(0, 8)
      : list.slice(-8).map((c) => clipPreview(c, 48));
    return {
      bullets,
      boards: boards || [],
      themes,
      still_open,
      next_searches: guessNextSearches(intent, themes, list),
      emerging_intent: '',
      intent_ready: false,
      thinking: false,
      error: '',
      checklist,
      source: 'local',
      updatedAt: Date.now()
    };
  }

  function extractiveSummary(intent, clips, prevBoards) {
    const list = Array.isArray(clips) ? clips : [];
    const summary = summaryFor(intent, list, localBoards(intent, list, prevBoards));
    summary.source = 'extractive';
    summary.emerging_intent = list.length
      ? ('围绕「' + (intent || '这次搜索') + '」已收 ' + list.length + ' 条，方向还在收窄')
      : '';
    return summary;
  }

  function summaryFromOrganize(data, intent, clips, boards) {
    const base = summaryFor(intent, clips, boards);
    const next = cleanKeywordList(
      Array.isArray(data && data.next_searches)
        ? data.next_searches.map((x) => (typeof x === 'string' ? x : (x && x.keyword)))
        : [],
      intent
    ).map((keyword) => {
      const hit = (Array.isArray(data.next_searches) ? data.next_searches : []).filter((x) => {
        const k = typeof x === 'string' ? x : (x && x.keyword);
        return toXhsQuery(k, intent) === keyword;
      })[0];
      return { keyword, why: hit && typeof hit === 'object' ? String(hit.why || '').trim() : '' };
    });
    return Object.assign(base, {
      still_open: Array.isArray(data && data.still_open)
        ? data.still_open.slice(0, 5).map(String)
        : base.still_open,
      next_searches: next.length ? next : base.next_searches,
      emerging_intent: String((data && data.emerging_intent) || '').slice(0, 160),
      intent_ready: Boolean(data && data.intent_ready),
      quiet_nudge: String((data && data.quiet_nudge) || '').slice(0, 80),
      source: 'llm'
    });
  }

  function roundCoveragePct(raw, clipCount) {
    if (raw == null || Number.isNaN(raw)) return null;
    let pct = Math.round(raw * 10) * 10;
    pct = Math.max(0, Math.min(100, pct));
    if (clipCount <= 0) return null;
    if (clipCount === 1) pct = Math.min(pct, 20);
    if (clipCount < 3) pct = Math.min(pct, 40);
    if (clipCount < 4 && pct >= 80) pct = 50;
    return pct;
  }

  function computeProgress({ clips, checklist, sessionStartedAt, now, stillOpen }) {
    const list = clips || [];
    const n = list.length;
    const waiting = list.filter((c) => !c.analyzed).length;
    const minutes = Math.max(0, Math.floor(((now || Date.now()) - (sessionStartedAt || Date.now())) / 60000));
    const open = stillOpen || (checklist || []).filter((c) => c && !c.covered).map((c) => c.item);
    void open;
    if (n === 0) {
      return {
        stage: 'early',
        clipCount: 0,
        coveragePct: null,
        minutes,
        nudge: '选中有用的文字，点「收入记事本」。收进来只是先存着，攒几条再点整理'
      };
    }
    if (waiting) {
      return {
        stage: n >= 8 ? 'late' : (n < 3 ? 'early' : 'mid'),
        clipCount: n,
        coveragePct: null,
        minutes,
        nudge: `已收 ${n} 条，其中 ${waiting} 条还没整理。点「整理这 ${waiting} 条」，已有的板块不会被推翻`
      };
    }
    if (n >= 8) {
      return {
        stage: 'late',
        clipCount: n,
        coveragePct: null,
        minutes,
        nudge: `已收 ${n} 条，都整理进板块了。继续搜，或者收工存成笔记`
      };
    }
    return {
      stage: n < 3 ? 'early' : 'mid',
      clipCount: n,
      coveragePct: null,
      minutes,
      nudge: `已收 ${n} 条，都整理好了。接着搜，新收的会先停在待整理里`
    };
  }

  function suggestKeywords(intent, clips, summary) {
    const base = String(intent || '').trim();
    const fromAi = cleanKeywordList(
      ((summary && summary.next_searches) || []).map((x) => (typeof x === 'string' ? x : x.keyword))
        .concat(((summary && summary.themes) || []).reduce((acc, t) => acc.concat(t.search_keywords || []), [])),
      base
    );
    const local = guessNextSearches(base, (summary && summary.themes) || [], clips).map((x) => x.keyword);
    const out = [];
    fromAi.concat(local).forEach((q) => {
      if (q && out.indexOf(q) === -1) out.push(q);
    });
    const dimShort = {
      '路线骨架': '路线',
      '门票预约': '预约',
      '交通时段': '交通',
      '关键单品': '单品',
      '尺寸/户型是否合适': '尺寸',
      '预算参考': '预算',
      '避雷/踩坑': '避坑',
      '搭配/场景': '搭配'
    };
    const missing = ((summary && summary.checklist) || []).filter((c) => c && !c.covered).map((c) => c.item)
      .concat((summary && summary.still_open) || []);
    const head = cityHint(base) || base.replace(/\s+/g, '').slice(0, 4);
    missing.slice(0, 4).forEach((item) => {
      const dim = dimShort[item] || String(item || '').replace(/[／/].*/, '').replace(/\s+/g, '').slice(0, 4);
      const q = toXhsQuery(head + dim, base);
      if (!q || out.indexOf(q) !== -1) return;
      if (dim.length >= 2 && out.some((k) => k.indexOf(dim) !== -1)) return;
      out.push(q);
    });
    return out.slice(0, 6);
  }

  // 收工产物：收集箱原文 + 派生卡片原样留下
  function buildNote(session, now) {
    const s = session || {};
    const summary = s.summary || {};
    const clips = s.clips || [];
    const boards = cloneBoards(s.boards).filter(boardHasContent);
    const at = now || Date.now();
    return {
      id: s.noteId || '',
      intent: String(s.intent || '').trim() || '没写目的',
      platform: s.platform || '',
      startedAt: s.startedAt || at,
      updatedAt: at,
      minutes: s.startedAt ? Math.max(0, Math.round((at - s.startedAt) / 60000)) : 0,
      boards: boards.map((b) => ({
        id: b.id,
        name: b.name,
        pinned: Boolean(b.pinned),
        clipIds: (b.clipIds || []).slice(),
        cards: (b.cards || []).map((c) => Object.assign({}, c, { fromClipIds: (c.fromClipIds || []).slice() })),
        settled: (b.settled || []).slice(),
        unsettled: (b.unsettled || []).slice(),
        keywords: (b.keywords || []).slice()
      })),
      clips: clips.map((c) => ({
        id: c.id,
        title: c.title || '',
        text: c.text || '',
        url: c.url || '',
        source: c.source || '',
        boardId: c.boardId || '',
        analyzed: Boolean(c.analyzed),
        image: c.image || null,
        at: c.at || at
      })),
      imageCount: clips.filter((c) => c.image).length,
      nextSearches: (summary.next_searches || []).map((x) => (typeof x === 'string' ? { keyword: x, why: '' } : x)),
      stillOpen: (summary.still_open || []).slice(),
      emergingIntent: String(summary.emerging_intent || '')
    };
  }

  function noteIndexEntry(note) {
    const unsettled = (note.boards || []).reduce((n, b) => n + (b.unsettled || []).length, 0);
    return {
      id: note.id,
      intent: note.intent,
      updatedAt: note.updatedAt,
      clipCount: (note.clips || []).length,
      imageCount: (note.clips || []).filter((c) => c.image).length,
      boardCount: (note.boards || []).length,
      unsettledCount: unsettled,
      boardNames: (note.boards || []).map((b) => b.name).slice(0, 4)
    };
  }

  // 重新打开一条笔记，回到可以接着搜的状态
  function sessionFromNote(note) {
    const n = note || {};
    return {
      noteId: n.id || '',
      intent: n.intent || '',
      platform: n.platform || '',
      startedAt: n.startedAt || Date.now(),
      clips: (n.clips || []).map((c) => Object.assign({}, c, { analyzed: c.analyzed !== false })),
      boards: cloneBoards(n.boards),
      lastRoundId: '',
      showRedo: false,
      proposals: [],
      lastDiff: null,
      summary: {
        bullets: [],
        boards: (n.boards || []).slice(),
        themes: boardsToThemes(n.boards || [], n.clips || []),
        still_open: (n.stillOpen || []).slice(),
        next_searches: (n.nextSearches || []).slice(),
        emerging_intent: n.emergingIntent || '',
        intent_ready: false,
        thinking: false,
        error: '',
        checklist: [],
        source: 'reopened',
        updatedAt: Date.now()
      }
    };
  }

  function buildWrapup(intent, summary, clips, progress) {
    const s = summary || {};
    const missing = (s.checklist || []).filter((c) => c && !c.covered).map((c) => c.item);
    return {
      title: (intent || '这次搜索') + ' · 搜到的',
      bullets: (s.bullets || []).slice(0, 8),
      stillMissing: missing,
      clipCount: (clips || []).length,
      minutes: (progress && progress.minutes) || 0,
      coveragePct: (progress && progress.coveragePct) || null
    };
  }

  function matchesPositiveLabel(note, labels) {
    const list = labels || [];
    if (!list.length) return false;
    const blob = noteBlob(note);
    const b = new Set(tokenize(blob).filter((t) => t.length >= 2));
    if (!b.size) return false;
    return list.some((lab) => {
      const aToks = tokenize([lab.title, (lab.topics || []).join(' ')].join(' ')).filter((t) => t.length >= 2);
      if (!aToks.length) return false;
      const hit = aToks.filter((t) => b.has(t)).length;
      const j = hit / new Set(aToks.concat([...b])).size;
      return hit >= 3 || j >= 0.28;
    });
  }

  const api = {
    ENTERTAINMENT_HINTS,
    normalize,
    tokenize,
    classifyHeuristic,
    parseJsonFromModel,
    normalizeLabel,
    buildClassifyPrompt,
    inferChecklist,
    extractiveSummary,
    summaryFor,
    summaryFromOrganize,
    guessNextSearches,
    toXhsQuery,
    cleanKeywordList,
    emptyBoard,
    localBoards,
    boardsToThemes,
    isPending,
    pendingClips,
    unorganizedCount,
    emptyDiff,
    diffIsEmpty,
    cloneBoards,
    placeClip,
    ownerOf,
    emptyCard,
    splitClipPieces,
    stripRound,
    markSourceEdited,
    exportMarkdown,
    newRoundId,
    allCards,
    boardHasContent,
    buildOrganizePrompt,
    mergeOrganizeResult,
    localOrganize,
    applyProposal,
    computeProgress,
    roundCoveragePct,
    suggestKeywords,
    buildNote,
    noteIndexEntry,
    sessionFromNote,
    buildWrapup,
    clusterThemes,
    clipPreview,
    matchesPositiveLabel,
    noteBlob
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FocusGuardLib = api;
})(typeof self !== 'undefined' ? self : typeof global !== 'undefined' ? global : this);
