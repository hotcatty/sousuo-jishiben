// stats.js — 使用统计页逻辑：主动使用 vs 闲逛 + 平台子维度

const PLATFORMS = [
  { key: 'bilibili',    label: 'B站',   color: '#00a1d6' },
  { key: 'xiaohongshu', label: '小红书', color: '#ff2442' },
  { key: 'douyin',      label: '抖音',   color: '#fe2c55' },
];
const COLORS = { active: '#07c160', idle: '#fa5151' };
const DAYS = ['日','一','二','三','四','五','六'];
let currentWeekOffset = 0;

// 兼容旧格式：纯数字 → { active:0, idle: number }
function normalize(stats) {
  if (!stats) return {};
  const out = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === 'number') out[k] = { active: 0, idle: v };
    else out[k] = { active: v.active || 0, idle: v.idle || 0 };
  }
  return out;
}

function getWeekDates(offset = 0) {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

async function loadStatsFromStorage(dates) {
  const keys = dates.map(d => 'stats_' + d);
  return new Promise(resolve => {
    chrome.storage.local.get(keys, data => {
      const result = {};
      dates.forEach(d => { result[d] = normalize(data['stats_' + d] || {}); });
      resolve(result);
    });
  });
}

// 向活跃平台 tab 请求实时增量（含 mode），叠加到今日统计
async function getLiveExtras() {
  const extras = {}; // { platform: { active: sec, idle: sec } }
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
        const resp = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { type: 'GET_LIVE_SECONDS' }, r => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(r);
          });
        });
        if (resp && resp.seconds > 0) {
          const mode = resp.mode || 'idle';
          if (!extras[platform]) extras[platform] = { active: 0, idle: 0 };
          extras[platform][mode] = (extras[platform][mode] || 0) + resp.seconds;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return extras;
}

// 工具：秒 → 分钟显示
function fmtMin(seconds) {
  if (seconds <= 0) return '0';
  const m = Math.floor(seconds / 60);
  return m < 1 ? '<1' : String(m);
}

function sumActive(stats) {
  return PLATFORMS.reduce((sum, p) => sum + ((stats[p.key] || {}).active || 0), 0);
}
function sumIdle(stats) {
  return PLATFORMS.reduce((sum, p) => sum + ((stats[p.key] || {}).idle || 0), 0);
}

async function render() {
  const today = todayStr();
  document.getElementById('page-date').textContent =
    new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

  const weekDates = getWeekDates(currentWeekOffset);
  const weekLabel = currentWeekOffset === 0 ? '本周'
    : currentWeekOffset === -1 ? '上周' : `${Math.abs(currentWeekOffset)}周前`;
  document.getElementById('week-label').textContent = weekLabel;
  document.getElementById('chart-title').textContent = weekLabel + '趋势';
  const btnNext = document.getElementById('btn-next');
  btnNext.disabled = currentWeekOffset >= 0;
  btnNext.style.opacity = currentWeekOffset >= 0 ? '0.4' : '1';
  btnNext.style.cursor = currentWeekOffset >= 0 ? 'default' : 'pointer';

  const allStats = await loadStatsFromStorage([today, ...weekDates]);

  // 叠加实时增量到今日数据
  if (currentWeekOffset === 0) {
    const extras = await getLiveExtras();
    const ts = allStats[today] || {};
    for (const [p, modes] of Object.entries(extras)) {
      if (!ts[p]) ts[p] = { active: 0, idle: 0 };
      ts[p].active = (ts[p].active || 0) + (modes.active || 0);
      ts[p].idle = (ts[p].idle || 0) + (modes.idle || 0);
    }
    allStats[today] = ts;
  }

  const todayStats = allStats[today] || {};

  // 今日总览
  const totalActive = sumActive(todayStats);
  const totalIdle = sumIdle(todayStats);
  const totalSec = totalActive + totalIdle;
  const ratio = totalSec > 0 ? Math.round(totalActive / totalSec * 100) : 0;

  document.getElementById('s-total').textContent = fmtMin(totalSec);
  document.getElementById('s-active').textContent = fmtMin(totalActive);
  document.getElementById('s-idle').textContent = fmtMin(totalIdle);
  document.getElementById('s-ratio').textContent = ratio + '%';

  // 平台详情
  const platList = document.getElementById('platform-list');
  platList.innerHTML = '';

  const maxPlatSec = Math.max(
    ...PLATFORMS.map(p => {
      const s = todayStats[p.key] || {};
      return (s.active || 0) + (s.idle || 0);
    }),
    1
  );

  PLATFORMS.forEach(p => {
    const ps = todayStats[p.key] || { active: 0, idle: 0 };
    const total = ps.active + ps.idle;
    const totalMin = fmtMin(total);
    const activePct = total > 0 ? Math.round(ps.active / total * 100) : 0;
    const idlePct = 100 - activePct;
    const barPct = Math.round(total / maxPlatSec * 100);

    const weekData = weekDates.map(d => allStats[d] || {});
    const weekTotal = weekData.reduce((sum, d) => {
      const s = d[p.key] || {};
      return sum + (s.active || 0) + (s.idle || 0);
    }, 0);

    const row = document.createElement('div');
    row.className = 'platform-row';
    row.innerHTML = `
      <div class="platform-top">
        <div class="platform-name">
          <div class="color-dot" style="background:${p.color}"></div>${p.label}
        </div>
        <div class="platform-time" style="color:${p.color}">
          ${totalMin}<span class="unit">分钟</span>
        </div>
      </div>
      <div class="split-bar" style="width:${barPct}%;">
        <div class="split-active" style="width:${activePct}%"></div>
        <div class="split-idle" style="width:${idlePct}%"></div>
      </div>
      <div class="platform-footer">
        <div class="pf-stat"><div class="dot" style="background:var(--active)"></div>主动使用 <span>${fmtMin(ps.active)}</span> 分钟</div>
        <div class="pf-stat"><div class="dot" style="background:var(--idle)"></div>闲逛 <span>${fmtMin(ps.idle)}</span> 分钟</div>
        <div class="pf-stat">本周累计 <span>${fmtMin(weekTotal)}</span> 分钟</div>
      </div>`;
    platList.appendChild(row);
  });

  // 趋势图 — SVG 堆叠柱状图（主动使用 + 闲逛）
  const chartCard = document.querySelector('.chart-card');
  const chartMaxSec = Math.max(
    ...weekDates.map(d => {
      const s = allStats[d] || {};
      return sumActive(s) + sumIdle(s);
    }),
    60
  );
  const chartMaxMin = Math.ceil(chartMaxSec / 60);
  const yTicks = [0, Math.ceil(chartMaxMin * 0.25), Math.ceil(chartMaxMin * 0.5), Math.ceil(chartMaxMin * 0.75), chartMaxMin];

  const W = 800, H = 200;
  const padL = 36, padR = 12, padT = 20, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const barW = plotW / 7 * 0.55, barGap = plotW / 7;

  let svg = `<svg viewBox="0 0 ${W} ${H}" id="chart-svg" xmlns="http://www.w3.org/2000/svg">`;

  yTicks.forEach(t => {
    const y = padT + plotH - (t / chartMaxMin) * plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#f0f0f0" stroke-dasharray="3,3"/>`;
    svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="#bbb">${t}m</text>`;
  });

  weekDates.forEach((date, i) => {
    const dayStats = allStats[date] || {};
    const isToday = date === today;
    const dowIdx = new Date(date + 'T12:00:00').getDay();
    const x = padL + i * barGap + (barGap - barW) / 2;

    const activeSec = sumActive(dayStats);
    const idleSec = sumIdle(dayStats);
    const dayTotalSec = activeSec + idleSec;
    const dayTotalMin = Math.floor(dayTotalSec / 60);

    // 闲逛在上方，主动使用在下方
    let yOffset = padT + plotH;
    const opacity = isToday ? 1 : 0.55;

    // 主动使用段（底部，绿色）
    if (activeSec >= 1) {
      const segH = (activeSec / chartMaxSec) * plotH;
      yOffset -= segH;
      svg += `<rect x="${x}" y="${yOffset}" width="${barW}" height="${segH}" fill="${COLORS.active}" opacity="${opacity}" rx="1.5"/>`;
      if (segH >= 16) {
        const segMin = Math.floor(activeSec / 60);
        const segLabel = segMin > 0 ? segMin + 'm' : '<1m';
        svg += `<text x="${x + barW/2}" y="${yOffset + segH/2 + 3}" text-anchor="middle" font-size="9" fill="#fff" font-weight="600">${segLabel}</text>`;
      }
    }

    // 闲逛段（上方，红色）
    if (idleSec >= 1) {
      const segH = (idleSec / chartMaxSec) * plotH;
      yOffset -= segH;
      svg += `<rect x="${x}" y="${yOffset}" width="${barW}" height="${segH}" fill="${COLORS.idle}" opacity="${opacity}" rx="1.5"/>`;
      if (segH >= 16) {
        const segMin = Math.floor(idleSec / 60);
        const segLabel = segMin > 0 ? segMin + 'm' : '<1m';
        svg += `<text x="${x + barW/2}" y="${yOffset + segH/2 + 3}" text-anchor="middle" font-size="9" fill="#fff" font-weight="600">${segLabel}</text>`;
      }
    }

    if (dayTotalSec > 0) {
      const topY = padT + plotH - (dayTotalSec / chartMaxSec) * plotH;
      svg += `<text x="${x + barW/2}" y="${topY - 6}" text-anchor="middle" font-size="11" fill="${isToday ? '#191919' : '#999'}" font-weight="700">${dayTotalMin > 0 ? dayTotalMin + 'm' : '<1m'}</text>`;
    }

    svg += `<text x="${x + barW/2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${isToday ? '#191919' : '#999'}" font-weight="${isToday ? '700' : '400'}">周${DAYS[dowIdx]}</text>`;
  });

  svg += `</svg>`;
  chartCard.innerHTML = svg + `<div class="chart-legend">
    <div class="legend-item"><div class="legend-dot" style="background:var(--active)"></div>主动使用</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--idle)"></div>闲逛</div>
  </div>`;
}

function changeWeek(delta) {
  currentWeekOffset = Math.min(0, currentWeekOffset + delta);
  render();
}

document.getElementById('btn-prev').addEventListener('click', () => changeWeek(-1));
document.getElementById('btn-next').addEventListener('click', () => changeWeek(1));

render();
setInterval(render, 30000);
