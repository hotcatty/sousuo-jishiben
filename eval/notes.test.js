const assert = require('assert');
const path = require('path');
const Lib = require(path.join(__dirname, '..', 'src', 'lib', 'fg-lib.js'));

const intent = '广州三日游';
const clips = [
  { id: 'c1', title: '一张图看懂广州', text: '【图线索】珠江两岸、老城、新中轴，三块，一天一块。', url: 'https://x/1', source: 'image-clue', at: 1, analyzed: true },
  { id: 'c2', title: '广州塔门票避坑', text: '上塔要单独买观光票，夜景票更贵。', url: 'https://x/2', source: 'note', at: 2, analyzed: true },
  { id: 'c3', title: '随手一段', text: '这条还没归到任何板块', url: '', source: 'drag', at: 3, analyzed: false }
];
const boards = [
  {
    id: 'bd_1', name: '片区与路线', pinned: false, clipIds: ['c1'],
    settled: ['三块空间骨架，一天一块'], unsettled: ['各点之间耗时没说，排不了时间表'], keywords: ['广州 老城 步行路线']
  },
  {
    id: 'bd_2', name: '票务与避坑', pinned: false, clipIds: ['c2'],
    settled: ['上塔要单独买票'], unsettled: ['没看到具体票价'], keywords: ['广州塔 观光票 价格']
  },
  { id: 'bd_3', name: '美食', pinned: true, clipIds: [], settled: [], unsettled: [], keywords: [] }
];
const session = {
  intent, platform: 'xiaohongshu', startedAt: Date.now() - 25 * 60000, clips, boards,
  summary: {
    next_searches: [{ keyword: '陈家祠 开放时间', why: '老城那块还没定' }],
    still_open: ['各点之间交通耗时'],
    emerging_intent: '偏历史文化的广州三日游，按片区走',
    bullets: ['一张图看懂广州 · 【图线索】珠江两岸…']
  }
};

/* 1. 产物必须保留板块结构，而不是拍平成截断摘录 */
const note = Lib.buildNote(session);
assert.strictEqual(note.boards.length, 3, '两个有材料的板块 + 用户钉住的空板块');
assert(!note.boards.some((b) => b.name === '还没整理'), '没整理的材料留在收集箱，不再另造板块');
assert(note.clips.some((c) => c.id === 'c3'), '收工时没整理的材料要原样存着，不能静默丢掉');
const routes = note.boards.filter((b) => b.name === '片区与路线')[0];
assert.deepStrictEqual(routes.settled, ['三块空间骨架，一天一块'], '已经能定要留下');
assert.deepStrictEqual(routes.unsettled, ['各点之间耗时没说，排不了时间表'], '还不能定要留下');
assert.deepStrictEqual(routes.keywords, ['广州 老城 步行路线'], '下一步词要留下');
assert(note.nextSearches.some((x) => x.keyword === '陈家祠 开放时间'), '整体下一步词要留下');
assert.strictEqual(note.emergingIntent, '偏历史文化的广州三日游，按片区走');
assert(note.minutes >= 24 && note.minutes <= 26, '记下花了多久，实际 ' + note.minutes);

/* 2. 材料原文和来源要留全，不能只留 60 字预览 */
const kept = note.clips.map((c) => c.id);
assert.deepStrictEqual(kept.sort(), ['c1', 'c2', 'c3'], '所有材料都进产物，一条不丢');
const ticket = note.clips.filter((c) => c.id === 'c2')[0];
assert.strictEqual(ticket.text, '上塔要单独买观光票，夜景票更贵。', '正文是原文');
assert.strictEqual(ticket.url, 'https://x/2', '来源链接要留着');

/* 3. 索引条目要小，但够列表显示 */
note.id = 'note_1';
const entry = Lib.noteIndexEntry(note);
assert.deepStrictEqual(Object.keys(entry).sort(), ['boardCount', 'boardNames', 'clipCount', 'id', 'imageCount', 'intent', 'unsettledCount', 'updatedAt']);
assert.strictEqual(entry.unsettledCount, 2, '把还没定的件数汇总出来，列表上能看见');
assert(!JSON.stringify(entry).includes('上塔要单独买观光票'), '索引里不能夹带正文');

/* 4. 重新打开 = 回到能接着搜的状态，且带着 noteId 以便更新原条 */
const restored = Lib.sessionFromNote(note);
assert.strictEqual(restored.noteId, 'note_1', '带着 noteId，再收工时更新同一条');
assert.strictEqual(restored.intent, intent);
assert.strictEqual(restored.clips.length, 3);
assert.strictEqual(restored.boards.length, 3);
assert.deepStrictEqual(restored.summary.still_open, ['各点之间交通耗时'], '还没覆盖的问题要回来');
assert(restored.summary.themes.length === 3, 'themes 投影要重建，UI 才有东西渲染');
assert.strictEqual(restored.clips.filter((c) => c.id !== 'c3').every((c) => c.analyzed), true, '已经整理过的重开后还是已读');
assert.strictEqual(Lib.pendingClips(restored).map((c) => c.id).join(), 'c3', '没整理过的重开后还在收集箱未读');

/* 5. 接着补一条，再收工，仍是同一条笔记 */
const more = Object.assign({}, restored, {
  startedAt: note.startedAt,
  clips: restored.clips.concat([{ id: 'c9', title: '陈家祠开放时间', text: '周一不闭馆，8:30 开门', url: 'https://x/9', source: 'note', at: 9, boardId: 'bd_1' }]),
  boards: Lib.localBoards(intent, restored.clips.concat([
    { id: 'c9', title: '陈家祠开放时间', text: '周一不闭馆，8:30 开门', boardId: 'bd_1' }
  ]), restored.boards)
});
const note2 = Lib.buildNote(more);
assert.strictEqual(note2.id, 'note_1', '再收工是更新，不是新存一条');
assert.strictEqual(note2.clips.length, 4, '补进来的材料进了产物');
const routes2 = note2.boards.filter((b) => b.id === 'bd_1')[0];
assert(routes2.clipIds.indexOf('c9') !== -1, '补的材料落在用户指定的板块里');
assert(note2.updatedAt >= note.updatedAt, 'updatedAt 前进');

/* 6. 空会话不该产出笔记（背景里会拦，这里确认产物本身是空的） */
const blank = Lib.buildNote({ intent: '', clips: [], boards: [], summary: {} });
assert.strictEqual(blank.boards.length, 0);
assert.strictEqual(blank.clips.length, 0);

/* 7. 图片：跟着笔记存下来，但绝不能进索引 */
const fakeB64 = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
const withImg = {
  intent, platform: 'xiaohongshu', startedAt: Date.now() - 60000,
  clips: [
    { id: 'i1', title: '广州可以分为3个板块', text: '【图线索】三个板块，含步行分钟数', url: 'https://x/i1', source: 'image', boardId: 'bd_1', at: 1,
      image: { dataUrl: fakeB64, width: 600, height: 802, bytes: 3000, srcUrl: 'https://x/raw.jpg' } },
    { id: 'i2', title: '只有图没文字', text: '', url: '', source: 'image', boardId: 'bd_1', at: 2,
      image: { dataUrl: fakeB64, width: 600, height: 400, bytes: 2000, srcUrl: '' } }
  ],
  boards: [{ id: 'bd_1', name: '片区与路线', pinned: false, clipIds: ['i1', 'i2'], settled: [], unsettled: [], keywords: [] }],
  summary: {}
};
const imgNote = Lib.buildNote(withImg);
imgNote.id = 'note_img';
assert.strictEqual(imgNote.clips.length, 2);
assert.strictEqual(imgNote.clips[0].image.width, 600, '存 600px 的那版');
assert.strictEqual(imgNote.clips[0].image.srcUrl, 'https://x/raw.jpg', '原图链接要留着，好回源看大图');
assert.strictEqual(imgNote.imageCount, 2, '笔记上记下有几张图');

const imgEntry = Lib.noteIndexEntry(imgNote);
assert.strictEqual(imgEntry.imageCount, 2, '列表上能看到有几张图');
assert(!JSON.stringify(imgEntry).includes('base64'), '索引里绝不能夹带图片数据');
assert(JSON.stringify(imgEntry).length < 400, '索引条目要小，实际 ' + JSON.stringify(imgEntry).length);

/* 8. 只有图没文字的材料也要能显示、也要能回到会话里 */
assert.strictEqual(Lib.clipPreview(withImg.clips[1], 60), '只有图没文字', '有标题就先用标题');
assert.strictEqual(
  Lib.clipPreview({ id: 'i3', title: '', text: '', image: { dataUrl: fakeB64 } }, 60),
  '一张图（没识别出文字）',
  '标题正文都空时要有兜底说明，不能显示成「一条摘录」'
);
const imgRestored = Lib.sessionFromNote(imgNote);
assert.strictEqual(imgRestored.clips.filter((c) => c.image).length, 2, '重新打开后图还在');

/* 9. 给模型的材料清单要标出带图、且不许它编图里的内容 */
const imgPrompt = Lib.buildOrganizePrompt(intent, withImg.boards, withImg.clips, withImg.clips);
assert(imgPrompt.messages[1].content.includes('[带图]'), '标出哪条带图');
assert(imgPrompt.messages[1].content.includes('不要编图里的内容'), '没识别出文字时要拦住模型瞎编');
assert(!imgPrompt.messages[1].content.includes('base64'), 'prompt 里不能塞图片数据，白烧 token');

console.log('notes passed 9/9');
