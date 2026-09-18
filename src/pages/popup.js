function normalize(stats) {
  if (!stats) return {};
  const out = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === 'number') out[k] = { active: 0, idle: v };
    else out[k] = { active: v.active || 0, idle: v.idle || 0 };
  }
  return out;
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || {});
    });
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1600);
}

async function loadStats() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await chrome.storage.local.get('stats_' + today);
  const stats = normalize(data['stats_' + today] || {});
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const tab of tabs) {
      if (!tab.url) continue;
      let platform = null;
      if (/bilibili\.com/.test(tab.url)) platform = 'bilibili';
      else if (/xiaohongshu\.com/.test(tab.url)) platform = 'xiaohongshu';
      else if (/douyin\.com/.test(tab.url)) platform = 'douyin';
      if (!platform) continue;
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_LIVE_SECONDS' });
        if (resp && resp.seconds > 0) {
          const mode = resp.mode || 'idle';
          if (!stats[platform]) stats[platform] = { active: 0, idle: 0 };
          stats[platform][mode] = (stats[platform][mode] || 0) + resp.seconds;
        }
      } catch (_) {}
    }
  } catch (_) {}

  function fmtMin(seconds) {
    if (seconds <= 0) return '0';
    const m = Math.floor(seconds / 60);
    return m < 1 ? '<1' : String(m);
  }
  let totalActive = 0, totalIdle = 0;
  ['bilibili', 'xiaohongshu', 'douyin'].forEach((p) => {
    const ps = stats[p] || { active: 0, idle: 0 };
    totalActive += ps.active || 0;
    totalIdle += ps.idle || 0;
  });
  document.getElementById('s-total').textContent = fmtMin(totalActive + totalIdle);
  document.getElementById('s-active').textContent = fmtMin(totalActive);
  document.getElementById('s-idle').textContent = fmtMin(totalIdle);
}

async function loadSession() {
  const data = await send({ type: 'GET_SESSION' });
  document.getElementById('intent').textContent = (data.session && data.session.intent) || '打开小红书时会询问';
  document.getElementById('progress').textContent = (data.progress && data.progress.nudge) || '';
  document.getElementById('key-status').textContent = data.hasKey
    ? '已配置 key'
    : '未配置则用本地规则，不中断使用';
  const s = data.settings || {};
  document.getElementById('s-interval').value = s.interruptInterval ?? 0;
  document.getElementById('s-bili-limit').value = s.bilibiliLimit ?? 60;
  document.getElementById('s-xhs-limit').value = s.xiaohongshuLimit ?? 30;
  document.getElementById('api-base').value = s.apiBase || 'https://api.deepseek.com';
}

function saveSettings() {
  const settings = {
    interruptInterval: parseInt(document.getElementById('s-interval').value, 10) || 0,
    bilibiliLimit: parseInt(document.getElementById('s-bili-limit').value, 10) || 0,
    xiaohongshuLimit: parseInt(document.getElementById('s-xhs-limit').value, 10) || 0
  };
  chrome.storage.local.get('settings').then((data) => {
    const merged = Object.assign({}, data.settings || {}, settings);
    chrome.storage.local.set({ settings: merged }).then(() => {
      send({ type: 'UPDATE_SETTINGS' });
      showToast('已保存');
    });
  });
}

document.getElementById('btn-detail').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/stats.html') });
});
document.getElementById('btn-xhs').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.xiaohongshu.com' });
  window.close();
});
document.getElementById('btn-demo').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/demo.html') });
});
document.getElementById('btn-panel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    if (tab && tab.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/sidepanel.html') });
  }
});
document.getElementById('btn-key').addEventListener('click', async () => {
  await send({
    type: 'SAVE_API_CONFIG',
    apiKey: document.getElementById('api-key').value.trim(),
    apiBase: document.getElementById('api-base').value.trim()
  });
  document.getElementById('api-key').value = '';
  showToast('Key 已保存到本机');
  loadSession();
});
document.getElementById('save-btn').addEventListener('click', saveSettings);

loadSession();
loadStats();
