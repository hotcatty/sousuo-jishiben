/*
 * 打印一份收工存档的真实结构：笔记本体 + 历史列表索引条目。
 * 设计导出格式（.md）时照着这个字段表挑，别凭想象。
 * 用法：node eval/note-shape.js
 */
const path = require('path');
const self = {};
global.self = self;
require(path.join(__dirname, '..', 'src/lib/fg-lib.js'));
const Lib = self.FocusGuardLib;

const startedAt = Date.parse('2026-09-18T01:00:00Z');
const session = {
  noteId: '',
  intent: '广州三日游',
  platform: 'xiaohongshu',
  startedAt,
  clips: [
    {
      id: 'clip_1',
      title: '广州三日游别乱走｜本地人排的必去清单',
      text: '第1站：花城广场→海心沙亚运公园→广州塔→珠江夜游码头→二沙岛艺术公园\n第2站：陈家祠→荔湾湖公园→永庆坊→上下九步行街→沙面岛',
      topics: ['广州旅游', '三日游'],
      url: 'https://www.xiaohongshu.com/explore/abc123',
      source: 'note',
      boardId: 'bd_1',
      analyzed: true,
      truncated: 0,
      at: startedAt + 60000
    },
    {
      id: 'clip_2',
      title: '一张图看懂广州：三天三个板块',
      text: '（图里认出来的字）珠江两岸 / 西关荔湾 / 越秀老城',
      topics: [],
      url: 'https://www.xiaohongshu.com/explore/def456',
      source: 'image-clue',
      boardId: 'bd_1',
      analyzed: true,
      truncated: 0,
      image: { dataUrl: 'data:image/jpeg;base64,/9j/4AAQ…（截断，实际是 83KB）', width: 600, height: 802, origW: 766, origH: 1024, bytes: 84992 },
      at: startedAt + 120000
    },
    {
      id: 'clip_3',
      title: '广州塔门票怎么买',
      text: '上塔要单独买观光票，白云星空厅 228 元，建议傍晚上去看日落转夜景。',
      topics: [],
      url: '',
      source: 'paste',
      boardId: '',
      analyzed: false,
      truncated: 0,
      at: startedAt + 900000
    }
  ],
  boards: [{
    id: 'bd_1',
    name: '三日路线',
    pinned: false,
    clipIds: ['clip_1', 'clip_2'],
    settled: ['这条线按珠江两岸 / 西关荔湾 / 越秀老城分三天走，和那张分区图对得上'],
    unsettled: ['各点之间的耗时没给，排不了具体时间表'],
    keywords: ['珠江夜游 班次 时刻', '广州陈家祠历史']
  }],
  summary: {
    emerging_intent: '广州三日游，偏历史文化，不想赶路',
    intent_ready: true,
    next_searches: [
      { keyword: '珠江夜游 班次 时刻', why: '路线里有夜游，但没定几点那班' },
      { keyword: '广州陈家祠历史', why: '你收的都是路线，还没有背景故事' }
    ],
    still_open: ['三天的住宿落点还没定'],
    quiet_nudge: '名单有了。那张三分区图适合当线索收下——它是骨架，不是行程表。'
  }
};

const note = Lib.buildNote(session, startedAt + 3600000);
const shown = JSON.parse(JSON.stringify(note));
// 图片 base64 在真实数据里是几万字符，这里只留个头，方便阅读
shown.clips.forEach((c) => {
  if (c.image && c.image.dataUrl) c.image.dataUrl = c.image.dataUrl.slice(0, 40) + '…';
});

console.log('=== 笔记本体（chrome.storage.local 里 fg_note_<id>）===');
console.log(JSON.stringify(shown, null, 2));
console.log('\n=== 历史列表索引条目（fg_notes，不含图片数据）===');
console.log(JSON.stringify(Lib.noteIndexEntry(note), null, 2));
