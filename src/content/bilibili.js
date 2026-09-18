// ==================== Focus Guard: B站 Content Script ====================
// 策略：
// 1. 危险路径（首页/热门/排行）→ 弹遮罩 + 计为"闲逛"
// 2. 安全路径（课程/视频/动态/空间）→ 放行 + 计为"主动使用"
// 3. 只在页面可见时计时，避免多标签双倍计时

(function () {
  'use strict';

  const DANGER_PATHS = [
    /^\/$/,
    /^\/v\/popular/,
    /^\/channel\//,
    /^\/anime\/?$/,
    /^\/ranking/,
  ];

  function isDanger(path) {
    return DANGER_PATHS.some(r => r.test(path));
  }

  // ---- 模式与计时（可见性感知）----
  let currentMode = 'idle';
  let lastCounted = Date.now();
  let sessionStart = Date.now();

  function setMode(newMode) {
    if (newMode === currentMode) return;
    forceReport();
    currentMode = newMode;
  }

  function forceReport() {
    const now = Date.now();
    const seconds = Math.floor((now - lastCounted) / 1000);
    if (seconds < 1) return;
    chrome.runtime.sendMessage(
      { type: 'ADD_TIME', platform: 'bilibili', mode: currentMode, seconds },
      () => void chrome.runtime.lastError
    );
    lastCounted = now;
  }

  function reportTime() {
    if (document.visibilityState !== 'visible') return;
    forceReport();
  }

  // ---- 遮罩（危险页面时显示）----
  async function showOverlay() {
    if (document.getElementById('fg-bili-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'fg-bili-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:2147483647;
      background:rgba(255,255,255,0.97);
      display:flex; align-items:center; justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="max-width:380px;width:90%;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#191919;margin-bottom:10px;">你打算做什么？</div>
        <div style="font-size:14px;color:#999;margin-bottom:28px;line-height:1.6;">
          当前页面有大量推荐内容，容易分散注意力
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a href="https://t.bilibili.com" style="
            display:block;padding:13px;border-radius:10px;
            background:#00a1d6;color:#fff;font-weight:700;
            font-size:15px;text-decoration:none;
          ">看关注的UP主动态</a>
          <a href="https://www.bilibili.com/cheese/mine/list" style="
            display:block;padding:13px;border-radius:10px;
            background:#191919;color:#fff;font-weight:700;
            font-size:15px;text-decoration:none;
          ">继续学习课程</a>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="fg-bili-extra-min" type="number" min="1" max="120" value="10"
              style="width:52px;padding:10px 6px;border-radius:8px;
              border:1.5px solid #e8e8e8;font-size:15px;text-align:center;
              color:#191919;background:#fafafa;font-family:inherit;outline:none;"
            />
            <span style="font-size:14px;color:#999;">分钟</span>
            <button id="fg-allow-browse" disabled style="
              flex:1;padding:13px;border-radius:10px;
              border:1.5px solid #e8e8e8;background:#f0f0f0;
              color:#bbb;font-size:14px;cursor:not-allowed;font-family:inherit;
            ">随便看看（<span id="fg-bili-relax-cd">5</span>s）</button>
          </div>
        </div>
        <div style="margin-top:16px;font-size:12px;color:#ccc;">Focus Guard 守护你的注意力</div>
      </div>
    `;

    const append = () => {
      document.body.appendChild(overlay);
      const btn = overlay.querySelector('#fg-allow-browse');
      const cdEl = overlay.querySelector('#fg-bili-relax-cd');
      if (btn && cdEl) {
        // 随便看看：5秒倒计时后才能点击
        let relaxCd = 5;
        const relaxTimer = setInterval(() => {
          relaxCd--;
          cdEl.textContent = relaxCd;
          if (relaxCd <= 0) {
            clearInterval(relaxTimer);
            btn.disabled = false;
            btn.style.background = '#fafafa';
            btn.style.color = '#666';
            btn.style.cursor = 'pointer';
            btn.textContent = '随便看看';
          }
        }, 1000);
      }
      if (btn) {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          const input = overlay.querySelector('#fg-bili-extra-min');
          const extraMin = parseInt(input ? input.value : '10', 10);
          const mins = (isNaN(extraMin) || extraMin < 1) ? 10 : Math.min(120, extraMin);
          overlay.remove();
          setTimeout(showOverlay, mins * 60 * 1000);
        });
      }
    };
    if (document.body) append();
    else document.addEventListener('DOMContentLoaded', append);
  }

  function removeOverlay() {
    const el = document.getElementById('fg-bili-overlay');
    if (el) el.remove();
  }

  function checkAndHandle() {
    const danger = isDanger(location.pathname);
    setMode(danger ? 'idle' : 'active');
    if (danger) {
      showOverlay();
    } else {
      removeOverlay();
    }
  }

  // ---- 角落计时器 ----
  function createTimer() {
    const el = document.createElement('div');
    el.id = 'fg-timer';
    el.style.cssText = `
      position:fixed; bottom:16px; right:16px; z-index:2147483646;
      background:rgba(0,0,0,0.55); color:#fff;
      padding:4px 10px; border-radius:16px;
      font-size:12px; font-family:'SF Mono',monospace;
      cursor:pointer; letter-spacing:0.5px;
      transition: background 0.2s;
    `;
    el.title = '点击查看统计';
    el.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_STATS' }, () => void chrome.runtime.lastError);
    });
    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(0,0,0,0.75)'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'rgba(0,0,0,0.55)'; });

    const append = () => {
      if (!document.getElementById('fg-timer') && document.body) {
        document.body.appendChild(el);
      }
    };
    if (document.body) append();
    else document.addEventListener('DOMContentLoaded', append);

    setInterval(() => {
      const s = Math.floor((Date.now() - sessionStart) / 1000);
      const m = Math.floor(s / 60).toString().padStart(2, '0');
      const ss = (s % 60).toString().padStart(2, '0');
      el.textContent = m + ':' + ss;
    }, 1000);
  }

  // ---- 超时强退 ----
  async function checkTimeLimit() {
    const data = await chrome.storage.local.get('settings');
    const settings = data.settings || {};
    const limit = settings.bilibiliLimit;
    if (!limit || limit <= 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const statsData = await chrome.storage.local.get('stats_' + today);
    const stats = statsData['stats_' + today] || {};
    const bili = stats.bilibili || { active: 0, idle: 0 };
    const liveSeconds = Math.floor((Date.now() - lastCounted) / 1000);
    const totalSec = (bili.active || 0) + (bili.idle || 0) + liveSeconds;
    const used = Math.floor(totalSec / 60);

    if (used >= limit) {
      forceReport();
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;
          min-height:100vh;background:#f6f6f6;
          font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;">
          <div style="text-align:center;max-width:320px;padding:40px 24px;">
            <div style="font-size:48px;margin-bottom:16px;">⏰</div>
            <div style="font-size:20px;font-weight:800;margin-bottom:8px;">今日 B站 已用完</div>
            <div style="font-size:14px;color:#999;line-height:1.6;">
              你今天已经用了 ${used} 分钟，达到了设定的 ${limit} 分钟上限。<br>去做其他事吧。
            </div>
          </div>
        </div>`;
    }
  }

  // ---- 定时打断 ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FOCUS_INTERRUPT') {
      showInterrupt();
    }
    if (msg.type === 'GET_LIVE_SECONDS') {
      const seconds = Math.floor((Date.now() - lastCounted) / 1000);
      sendResponse({ seconds, mode: currentMode });
    }
  });

  function showInterrupt() {
    const old = document.getElementById('fg-bili-interrupt');
    if (old) old.remove();

    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    const timeStr = m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;

    const el = document.createElement('div');
    el.id = 'fg-bili-interrupt';
    el.style.cssText = `
      position:fixed;inset:0;z-index:2147483647;
      background:rgba(255,255,255,0.97);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
    `;
    el.innerHTML = `
      <div style="max-width:380px;width:90%;text-align:left;">
        <div style="font-size:12px;color:#999;margin-bottom:8px;letter-spacing:0.4px;text-transform:uppercase;">
          Focus Guard 提醒
        </div>
        <div style="font-size:20px;font-weight:700;margin-bottom:8px;color:#191919;line-height:1.3;">
          浏览了 <span style="color:#e74c3c;">${timeStr}</span> 了
        </div>
        <div style="font-size:14px;color:#666;margin-bottom:24px;">
          起来动动、喝点水？
        </div>
        <div style="display:flex;gap:10px;">
          <button id="fg-bili-leave" style="
            flex:1;padding:12px;border-radius:8px;
            border:none;background:#191919;color:#fff;
            font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;
          ">离开页面</button>
          <button id="fg-bili-continue" disabled style="
            flex:1;padding:12px;border-radius:8px;
            border:1.5px solid #e8e8e8;background:#fafafa;
            color:#999;font-size:14px;cursor:not-allowed;font-family:inherit;
          ">继续（<span id="fg-bili-cd">5</span>s）</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    let cd = 5;
    const cdEl = el.querySelector('#fg-bili-cd');
    const continueBtn = el.querySelector('#fg-bili-continue');
    const timer = setInterval(() => {
      cd--;
      cdEl.textContent = cd;
      if (cd <= 0) {
        clearInterval(timer);
        continueBtn.disabled = false;
        continueBtn.style.color = '#191919';
        continueBtn.style.cursor = 'pointer';
        continueBtn.textContent = '继续浏览';
      }
    }, 1000);

    el.querySelector('#fg-bili-leave').addEventListener('click', () => {
      clearInterval(timer);
      el.remove();
      history.back();
    });
    continueBtn.addEventListener('click', () => {
      if (continueBtn.disabled) return;
      clearInterval(timer);
      el.remove();
    });
  }

  // ---- SPA 路由监听 ----
  let lastPath = location.pathname;
  new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      checkAndHandle();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---- 初始化 ----
  function init() {
    checkAndHandle();
    createTimer();
    setInterval(reportTime, 15000);
    setInterval(checkTimeLimit, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        forceReport();
      } else {
        lastCounted = Date.now();
      }
    });
    window.addEventListener('pagehide', forceReport);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
