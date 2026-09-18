/*
 * 在真实 Chrome 里把「收材料 → 手动整理 → 用户改动 → 再整理」跑一遍并截图，
 * 用来肉眼确认界面，不做断言。用法：node eval/shot.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8913;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(d)); }).on('error', reject);
  });
}

async function findTarget(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get('http://127.0.0.1:9223/json/list'));
      const page = list.filter((t) => t.type === 'page' && t.url.indexOf(url) === 0)[0];
      if (page) return page;
    } catch (_) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('等不到调试目标');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  return (method, params) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
}

(async () => {
  execFileSync('node', [path.join(__dirname, 'make-harness.js')], { stdio: 'ignore' });
  const server = await serve();
  const url = `http://127.0.0.1:${PORT}/src/pages/_harness.html`;
  const profile = fs.mkdtempSync('/tmp/fg-shot-');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1500', '--remote-debugging-port=9223', '--user-data-dir=' + profile, url
  ], { stdio: 'ignore' });

  try {
    const target = await findTarget(url);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const send = cdp(ws);
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 2, mobile: false });

    const step = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(ROOT, 'eval', name), Buffer.from(r.result.data, 'base64'));
      console.log('->', name);
    };

    await sleep(800);
    await step(`(async () => {
      const msg = (m) => new Promise((res) => chrome.runtime.sendMessage(m, res));
      await msg({ type: 'START_SEARCH_SESSION', intent: '广州三日游' });
      const itinerary = [
        '广州三日游',
        '第1站：花城广场→海心沙亚运公园→广州塔→珠江夜游码头→二沙岛艺术公园',
        '第2站：陈家祠→荔湾湖公园→永庆坊→上下九步行街→沙面岛',
        '第3站：中山纪念堂→越秀公园→南越王博物院→北京路步行街→大佛寺',
        '-',
        '✌广州美食',
        '🔥南村柴火鸡饭'
      ].join('\\n');
      await msg({ type: 'ADD_CLIP', clip: { title: '广州三日游', text: itinerary, source: 'note' } });
      if (window.FocusGuardPanel) { FocusGuardPanel.setTab('inbox'); await FocusGuardPanel.refresh(); }
      await new Promise((r) => setTimeout(r, 300));
    })()`);
    await sleep(400);
    await shot('shot-1-staging.png');

    await step(`(async () => {
      const go = document.querySelector('.fgp-pill.is-go');
      if (go) go.click();
      await new Promise((r) => setTimeout(r, 800));
    })()`);
    await sleep(400);
    await shot('shot-2-organized.png');

    await step(`(async () => {
      const msg = (m) => new Promise((res) => chrome.runtime.sendMessage(m, res));
      const s = (await msg({ type: 'GET_SESSION' })).session;
      const b = (s.boards || [])[0];
      if (b) await msg({ type: 'RENAME_BOARD', boardId: b.id, name: '三日路线' });
      await msg({ type: 'ADD_CLIP', clip: { title: '又收一条', text: '沙面的欧陆建筑群适合慢慢逛，靠近珠江，傍晚光线好', source: 'note' } });
      if (window.FocusGuardPanel) { FocusGuardPanel.setTab('inbox'); await FocusGuardPanel.refresh(); }
      await new Promise((r) => setTimeout(r, 300));
    })()`);
    await sleep(400);
    await shot('shot-4-inbox-unread.png');
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    server.close();
    // Chrome 刚被杀，profile 目录可能还在写，删不掉也无所谓
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch (_) { /* 留给系统清 */ }
    ['_harness.html', '_harness-shim.js'].forEach((f) => fs.rmSync(path.join(ROOT, 'src/pages', f), { force: true }));
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
