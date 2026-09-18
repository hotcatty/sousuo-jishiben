const assert = require('assert');
const path = require('path');
const Lib = require(path.join(__dirname, '..', 'src', 'lib', 'fg-lib.js'));

const intent = '广州三日游';
function clip(id, title, text, extra) {
  return Object.assign({ id, title, text, source: 'note', analyzed: false }, extra || {});
}

const itinerary = [
  '广州三日游',
  '第1站：花城广场→海心沙亚运公园→广州塔→珠江夜游码头→二沙岛艺术公园',
  '第2站：陈家祠→荔湾湖公园→永庆坊→上下九步行街→沙面岛',
  '第3站：中山纪念堂→越秀公园→南越王博物院→北京路步行街→大佛寺',
  '-',
  '✌广州美食',
  '🔥南村柴火鸡饭'
].join('\n');

/* 1. 收下的原文停在收集箱，不自动长出板块 */
const c1 = clip('c1', '广州三日游', itinerary);
let session = { intent, clips: [c1], boards: [] };
assert.strictEqual(Lib.pendingClips(session).length, 1);
assert.strictEqual((session.boards || []).length, 0, '没收下来就整理，不许自己长板块');

/* 2. 本地整理：一篇拆成三日路线三张卡 + 美食一张卡，原文仍在 */
const first = Lib.localOrganize(intent, [], [c1]);
const names = first.boards.map((b) => b.name).sort();
assert(names.indexOf('三日路线') !== -1, '要有三日路线，实际 ' + names);
assert(names.indexOf('广州美食') !== -1, '要有广州美食，实际 ' + names);
const route = first.boards.filter((b) => b.name === '三日路线')[0];
assert.strictEqual(route.cards.length, 3, '三日路线拆成三张卡，实际 ' + route.cards.length);
assert.strictEqual(route.cards[0].title, '第一天:滨江新城');
assert.strictEqual(route.cards[1].title, '第二天:荔枝老城');
assert.strictEqual(route.cards[2].title, '第三天:越秀老城');
assert(route.cards[0].body.indexOf('花城广场') !== -1);
assert(route.cards[0].roundId, '卡片要记下这一轮 id');
assert.strictEqual(c1.text, itinerary, '原文一个字不许动');

/* 3. 模型改名、删卡都不走：merge 只追加派生卡 */
const prompt = Lib.buildOrganizePrompt(intent, first.boards, [Object.assign({}, c1, { analyzed: true })], []);
assert(prompt.messages[0].content.indexOf('数字、价格、时间、地名') !== -1, 'prompt 要锁死专有名词');
assert(prompt.messages[0].content.indexOf('不要添加原文没有的判断') !== -1);

const c2 = clip('c2', '广州塔门票', '上塔要单独买观光票，白云星空厅 228 元');
const merged = Lib.mergeOrganizeResult({
  place: [{ clip: '#2', board: 'B1' }],
  new_boards: [],
  cards: [{ board: 'B1', title: '广州塔门票', body: '上塔要单独买观光票，白云星空厅 228 元', clips: ['#2'] }],
  updates: [{ board: 'B1', keywords: ['广州塔预约'] }]
}, {
  intent,
  clips: [c1, c2],
  boards: first.boards,
  pending: [c2],
  clipRef: [c1.id, c2.id],
  boardRef: { [route.id]: 'B1', [first.boards.filter((b) => b.name === '广州美食')[0].id]: 'B2' },
  unsettledRef: {},
  roundId: 'rd_test2'
});
const route2 = merged.boards.filter((b) => b.id === route.id)[0];
assert.strictEqual(route2.name, '三日路线', '模型不许改板块名');
assert.strictEqual(route2.cards.length, 4, '只追加卡片，原三张还在');
assert(route2.cards.some((c) => c.title === '第一天:滨江新城'), '原卡标题不动');
assert.strictEqual(route2.cards[0].title, '广州塔门票', '新卡在最上面');
assert.deepStrictEqual(route2.keywords, ['广州塔预约']);

/* 4. 用户改过的卡片冻结：stripRound 拿不走它 */
const day1 = route2.cards.filter((c) => c.title === '第一天:滨江新城')[0];
day1.edited = true;
day1.body = '我自己改过的正文';
const ticket = route2.cards.filter((c) => c.title === '广州塔门票')[0];
const stripped = Lib.stripRound(merged.boards, ticket.roundId);
const after = stripped.boards.filter((b) => b.id === route.id)[0];
assert(after.cards.some((c) => c.title === '第一天:滨江新城' && c.edited), '用户改过的还在');
assert(!after.cards.some((c) => c.title === '广州塔门票'), '本轮 AI 卡被拿掉');
assert(stripped.unreadClipIds.indexOf('c2') !== -1, '被拿掉的卡对应原文回到未读');

/* 5. 改原文：没改过的派生卡删掉，改过的标 stale */
const staleBoards = Lib.markSourceEdited(first.boards, 'c1');
const staleRoute = staleBoards.filter((b) => b.name === '三日路线')[0];
// 第一轮的卡都没 edited，应该整组拿掉
assert(!staleRoute || !staleRoute.cards.length, '没改过的派生卡要拿掉等重写');

const frozen = Lib.cloneBoards(first.boards);
const frozenRoute = frozen.filter((b) => b.name === '三日路线')[0];
frozenRoute.cards[0].edited = true;
const mixed = Lib.markSourceEdited(frozen, 'c1');
const mixedRoute = mixed.filter((b) => b.name === '三日路线')[0];
assert.strictEqual(mixedRoute.cards.length, 1, '只留用户改过的那张');
assert.strictEqual(mixedRoute.cards[0].stale, true, '来源变了要标过期');

/* 6. 长材料：整理、存档、导出，正文不许砍 */
const longBody = '广州塔上塔要单独买观光票，白云星空厅 228 元，建议傍晚上去看日落转夜景。'.repeat(60);
assert(longBody.length > 2000);
const longClip = clip('cL', '一篇很长的攻略', longBody);
const one = Lib.buildOrganizePrompt(intent, [], [longClip], [longClip]);
assert(one.messages[1].content.indexOf(longBody.slice(0, 1600)) !== -1, '单条给到 1600 字');

const longOrg = Lib.localOrganize(intent, [], [longClip]);
const longSession = {
  intent,
  clips: [Object.assign({}, longClip, { analyzed: true })],
  boards: longOrg.boards,
  summary: {}
};
const note = Lib.buildNote(longSession);
assert.strictEqual(note.clips[0].text, longBody, '存档时原文不许被截');
assert.strictEqual(note.clips.length, 1, '收集箱永久保留原文');
const md = Lib.exportMarkdown(longSession);
assert(md.indexOf(longBody.slice(0, 80)) !== -1, '导出 Markdown 带全文');
assert(md.indexOf('# 广州三日游') === 0);

/* 7. 重开笔记：原文和卡片都在 */
const back = Lib.sessionFromNote(note);
assert.strictEqual(back.clips[0].text, longBody);
assert((back.boards[0].cards || []).length >= 1, '卡片跟着回来');

/* 8. 月全食：时间 / 地点 / 参数拆成多个 tab，不是一坨攻略 */
const eclipse = clip('cE', '月全食怎么看', [
  '时间',
  '2026年3月3日，初亏 18:20，食甚 19:45',
  '地点',
  '浙江沿海云量较低，适合观测',
  '拍摄参数',
  'ISO 200，快门 1/125，光圈 f/5.6，焦距 400mm'
].join('\n'));
const eclipseOrg = Lib.localOrganize('月全食', [], [eclipse]);
const eclipseNames = eclipseOrg.boards.map((b) => b.name).sort();
assert(eclipseNames.indexOf('月全食时间') !== -1, '月全食时间 tab，实际 ' + eclipseNames);
assert(eclipseNames.indexOf('月全食地点') !== -1, '月全食地点 tab，实际 ' + eclipseNames);
assert(eclipseNames.indexOf('月全食参数') !== -1, '月全食参数 tab，实际 ' + eclipseNames);
assert(eclipseOrg.boards.length >= 3, '不要把月全食全塞进一个板块，实际 ' + eclipseNames);
const eclipsePrompt = Lib.buildOrganizePrompt('月全食', [], [eclipse], [eclipse]);
assert(eclipsePrompt.messages[0].content.indexOf('月全食时间') !== -1, 'prompt 要举例拆主题');
assert(eclipsePrompt.messages[0].content.indexOf('不是代写攻略') !== -1, 'prompt 禁止写成完整攻略');

/* 9. 旅游：路线 / 美食 / 居住 */
const trip = clip('cT', '出行备忘', [
  '路线',
  '花城广场步行到广州塔，晚上珠江夜游',
  '美食',
  '早茶去点叉烧包，晚饭南村柴火鸡',
  '居住',
  '珠江新城民宿，近地铁'
].join('\n'));
const tripOrg = Lib.localOrganize('广州三日游', [], [trip]);
const tripNames = tripOrg.boards.map((b) => b.name).sort();
assert(tripNames.some((n) => /路线/.test(n)), '要有路线 tab，实际 ' + tripNames);
assert(tripNames.some((n) => /美食/.test(n)), '要有美食 tab，实际 ' + tripNames);
assert(tripNames.some((n) => /居住/.test(n)), '要有居住 tab，实际 ' + tripNames);

console.log('boards passed 9/9');
