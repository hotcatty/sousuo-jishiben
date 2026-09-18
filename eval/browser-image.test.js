/*
 * 在真实 Chrome 里跑一遍「拖一张真图进板块」。
 * 自带静态服务 + 用 Node 内置 WebSocket 直连 CDP，不依赖任何 npm 包。
 * 用法：node eval/browser-image.test.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8911;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get('http://127.0.0.1:9222/json/list'));
      const page = list.filter((t) => t.type === 'page' && t.url.indexOf(url) === 0)[0];
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (_) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('等不到 Chrome 的调试目标');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  return (method, params) => new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

(async () => {
  // 生成带自动测试钩子的壳子页
  execFileSync('node', [path.join(__dirname, 'make-harness.js')], { stdio: 'ignore' });
  const harness = fs.readFileSync(path.join(ROOT, 'src/pages/_harness.html'), 'utf8');
  fs.writeFileSync(
    path.join(ROOT, 'src/pages/_harness-autotest.html'),
    harness.replace('</body>', '<pre id="RESULT"></pre>\n<script src="_autotest.js"></script>\n</body>')
  );

  fs.copyFileSync(path.join(__dirname, 'autotest-payload.js'), path.join(ROOT, 'src/pages/_autotest.js'));

  const server = await serve();
  const url = `http://127.0.0.1:${PORT}/src/pages/_harness-autotest.html`;
  const profile = fs.mkdtempSync('/tmp/fg-chrome-');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9222', '--user-data-dir=' + profile, url
  ], { stdio: 'ignore' });

  let lines = [];
  try {
    const target = await findTarget(url);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const send = cdp(ws);
    await send('Runtime.enable');

    // 等页面脚本挂上钩子
    for (let i = 0; i < 40; i++) {
      const probe = await send('Runtime.evaluate', { expression: 'typeof window.__fgAutotest', returnByValue: true });
      if (probe.result && probe.result.result && probe.result.result.value === 'function') break;
      await sleep(250);
    }

    const r = await send('Runtime.evaluate', {
      expression: 'window.__fgAutotest()',
      awaitPromise: true,
      returnByValue: true
    });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('页面里抛了：' + JSON.stringify(r.result.exceptionDetails.exception || {}));
    }
    lines = (r.result && r.result.result && r.result.result.value) || [];
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    server.close();
    // Chrome 刚被杀，profile 目录可能还在写，删不掉不该让测试失败
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (_) { /* 留给系统清 /tmp */ }
    // 壳子和测试脚本不能留在 src/pages 里，否则会跟着插件一起打包
    ['_harness.html', '_harness-shim.js', '_harness-autotest.html', '_autotest.js']
      .forEach((f) => fs.rmSync(path.join(ROOT, 'src/pages', f), { force: true }));
  }

  console.log(lines.join('\n'));

  // 断言真实结果
  const find = (k) => (lines.filter((l) => l.indexOf(k + ': ') === 0)[0] || '').slice(k.length + 2);
  const assert = require('assert');

  assert.strictEqual(find('inbox_cards'), '1', '原文先进收集箱');
  assert(find('tabs_before').indexOf('收集箱') !== -1, '整理前只有收集箱');
  assert.strictEqual(find('organize_label'), '快速整理', '收集箱未读时出现快速整理');
  assert(find('tabs_after').indexOf('三日路线') !== -1, '整理后出现三日路线，实际：' + find('tabs_after'));
  assert(find('titled_cards').indexOf('第一天') !== -1, '派生卡带标题，实际：' + find('titled_cards'));
  assert.strictEqual(find('redo_pill'), 'true', '刚整理完 AI 分区底部有重做胶囊');
  assert.strictEqual(find('redo_link'), 'false', '不再常驻底部重做文字链接');
  assert(find('redo_copy').indexOf('重新生成本次整理') !== -1, '胶囊文案是重新生成本次整理，实际：' + find('redo_copy'));
  assert.strictEqual(find('all_analyzed'), 'true', '整理完原文标记已读');
  assert.strictEqual(find('clip_still_in_inbox'), '1', '原文仍在收集箱');
  assert.strictEqual(find('edited_survived_redo'), 'true', '用户改过的卡片重做后还在');
  assert.strictEqual(find('long_add_ok'), 'true', '超长材料要能收进来');
  assert.ok(Number(find('long_src_chars')) > 500, '测试用的正文得够长，实际 ' + JSON.stringify(find('long_src_chars')));
  assert.strictEqual(find('long_stored_chars'), find('long_src_chars'), '存下来的字数必须和原文一致');
  assert.strictEqual(find('long_in_dom'), 'true', '超长材料出现在收集箱');
  assert.strictEqual(find('long_dom_chars'), find('long_src_chars'), '界面上的全文必须完整');
  assert.strictEqual(find('export_ok'), 'true', '能导出 Markdown');

  assert.strictEqual(find('clue_map_is_real_image'), 'true', 'Demo 里那张图必须是真图片');
  assert.strictEqual(find('clue_map_natural'), '766x1024', '原图尺寸');
  assert.strictEqual(find('add_image_ok'), 'true', 'ADD_IMAGE_CLIP 要成功');
  const stored = find('stored_image');
  assert(/^600x80\d {2}from 766x1024 {2}stored_kb=\d+$/.test(stored), '存的是 600px 版本，实际 ' + stored);
  const kb = Number(/stored_kb=(\d+)/.exec(stored)[1]);
  assert(kb > 40 && kb < 140, '一张图应该在 40–140KB 之间，实际 ' + kb + 'KB');
  assert.strictEqual(find('index_has_base64'), 'false', '历史列表索引里绝不能夹带图片数据');
  assert(Number(find('index_entry_bytes')) < 400, '索引条目要小');
  assert(Number(find('note_image_clips')) >= 1, '存档的笔记里要带着图');
  assert.strictEqual(find('DONE'), 'ok');
  console.log('\nbrowser checks passed');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
