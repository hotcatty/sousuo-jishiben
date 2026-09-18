#!/usr/bin/env node
/**
 * 分类器 / 进度启发式评测。
 * 无 key：跑本地启发式，对照 eval/golden.json。
 * 有 key：再打一遍 LLM（不失败也不阻塞启发式结果）。
 *
 *   node eval/run-eval.js
 *   FOCUS_GUARD_API_KEY=sk-... node eval/run-eval.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('../src/lib/fg-lib.js');

const goldenPath = path.join(__dirname, 'golden.json');
const cases = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let fail = 0;
console.log('== heuristic vs golden ==');
for (const c of cases) {
  const got = lib.classifyHeuristic(c.intent, {
    title: c.note_title,
    topics: c.note_topics || [],
    snippet: c.note_snippet || ''
  });
  const ok = got.label === c.expected;
  if (!ok) fail += 1;
  const mark = ok ? 'ok' : 'FAIL';
  console.log(`${mark}  ${c.id.padEnd(22)} expected=${c.expected.padEnd(9)} got=${got.label.padEnd(9)} ${got.reason}`);
}

console.log('\n== progress honesty ==');
const early = lib.computeProgress({ clips: [], checklist: [], sessionStartedAt: Date.now() - 60000, now: Date.now() });
assert(early.stage === 'early', 'empty clips should be early');
assert(!/80%/.test(early.nudge), 'empty clips must not claim 80%');
assert(early.nudge.includes('收入记事本'), 'early copy');

const one = lib.computeProgress({
  clips: [{ title: '沙发' }],
  checklist: [
    { item: '关键单品', covered: true },
    { item: '尺寸/户型是否合适', covered: true },
    { item: '预算参考', covered: true },
    { item: '避雷/踩坑', covered: true }
  ],
  sessionStartedAt: Date.now() - 60000,
  now: Date.now()
});
assert(one.coveragePct == null, '1 clip has no fake coverage');
assert(!/%/.test(one.nudge), '1 clip nudge must not say percent');

const late = lib.computeProgress({
  clips: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }, { title: 'e' }, { title: 'f' }, { title: 'g' }, { title: 'h' }],
  checklist: [],
  sessionStartedAt: Date.now() - 20 * 60000,
  now: Date.now()
});
assert(late.stage === 'late', '8+ clips is late');
assert(late.coveragePct == null, 'never fake a coverage percent');
assert(!/%/.test(late.nudge), 'nudge must not say percent');
assert(late.nudge.includes('已收'), 'late nudge counts clips');
console.log('progress cases ok');

const parsed = lib.parseJsonFromModel('reason\n```json\n{"label":"drifting","confidence":"high","reason":"跑偏"}\n```');
assert(parsed && parsed.label === 'drifting', 'json fence parse');
assert(lib.normalizeLabel('off-goal') === 'drifting', 'label alias');
console.log('json parse ok');

const extracted = lib.extractiveSummary('独居家居购买', [
  { title: '宜家沙发尺寸', text: '小户型 210cm 避雷' }
]);
assert(extracted.checklist.some((x) => x.item === '关键单品' && x.covered), 'sofa covers 单品');
assert(extracted.source === 'extractive', 'extractive source');
console.log('extractive summary ok');

const job = lib.extractiveSummary('AI 产品设计师', [
  { title: '字节招聘', text: '熟练使用 Figma，会用 ChatGPT 做设计，不要只用过 ChatGPT' }
]);
assert(!job.checklist.length, 'fuzzy intent has no fake checklist');
assert((job.themes || []).some((t) => t.name === '岗位要求' || t.name === '招聘信息'), 'job clips cluster into a theme');
assert((job.still_open || []).length >= 1, 'fuzzy intent still has open dimensions');
console.log('fuzzy intent themes ok');

const kws = lib.suggestKeywords('独居家居购买', [{ title: '沙发' }], extracted);
assert(kws.length >= 1, 'keywords exist');
assert(kws.every((k) => !/\s/.test(k) && k.length <= 14), 'xhs queries stay short');
assert(!kws.some((k) => k.replace(/\s+/g, '') === '独居家居购买'), 'do not repeat full intent');

const travelSummary = lib.summaryFor('广州三日游', [{ title: '广州塔夜景', text: '晚上灯光很漂亮' }], []);
const travelKw = lib.suggestKeywords('广州三日游', [{ title: '广州塔夜景', text: '晚上灯光很漂亮' }], travelSummary);
assert(travelKw.some((k) => k === '广州美食'), 'travel direction: food');
assert(travelKw.some((k) => /广州塔/.test(k)), 'travel detail from a place already in materials');
assert(!travelKw.some((k) => /\s/.test(k)), 'no space-stuffed xhs queries');
assert(!travelKw.includes('广州三日游'), 'do not repeat travel intent');

const cleaned = lib.cleanKeywordList([
  '广州 珠江夜游 码头 班次 时刻表',
  '像素蛋糕 极简解构拼贴 导出 live图',
  '广州 陈家祠 荔湾公园 永庆坊 上下九 沙面岛 步行路线',
  '广州美食'
], '广州 陈家祠 荔湾公园 永庆坊 上下九 沙面岛 步行路线');
assert(cleaned.indexOf('广州美食') !== -1, 'keep short dim query');
assert(!cleaned.some((k) => /像素|蛋糕|live/.test(k)), 'drop off-topic');
assert(!cleaned.some((k) => /\s/.test(k)), 'collapse spaces');
assert(!cleaned.some((k) => k.length > 14), 'drop overlong stuffed queries');
const wrap = lib.buildWrapup('独居家居购买', extracted, [{ title: '沙发' }], { minutes: 12, coveragePct: 20 });
assert(wrap.title.indexOf('独居家居购买') !== -1, 'wrapup title');
assert(Array.isArray(wrap.stillMissing), 'wrapup missing list');
console.log('keywords / wrapup ok');

async function maybeLlm() {
  const key = process.env.FOCUS_GUARD_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  const base = (process.env.FOCUS_GUARD_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.FOCUS_GUARD_MODEL || 'deepseek-chat';
  if (!key) {
    console.log('\nLLM skipped (no FOCUS_GUARD_API_KEY / DEEPSEEK_API_KEY)');
    return;
  }
  console.log('\n== LLM vs golden ==');
  let llmFail = 0;
  for (const c of cases) {
    const messages = lib.buildClassifyPrompt(c.intent, {
      title: c.note_title,
      topics: c.note_topics || [],
      snippet: c.note_snippet || ''
    }, []);
    try {
      const resp = await fetch(base + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 200,
          messages
        })
      });
      const json = await resp.json();
      const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      const parsedLlm = lib.parseJsonFromModel(text) || {};
      const label = lib.normalizeLabel(parsedLlm.confidence === 'low' ? 'unknown' : parsedLlm.label);
      const ok = label === c.expected;
      if (!ok) llmFail += 1;
      console.log(`${ok ? 'ok' : 'DIFF'}  ${c.id.padEnd(22)} expected=${c.expected.padEnd(9)} llm=${label}`);
    } catch (e) {
      llmFail += 1;
      console.log(`ERR   ${c.id} ${e.message}`);
    }
  }
  console.log(`LLM diffs/errors: ${llmFail}/${cases.length} (informational)`);
}

maybeLlm()
  .then(() => {
    if (fail) {
      console.error(`\nheuristic failures: ${fail}/${cases.length}`);
      process.exit(1);
    }
    console.log(`\nheuristic passed ${cases.length}/${cases.length}`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
