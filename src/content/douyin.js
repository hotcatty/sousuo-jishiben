// ==================== Focus Guard: 抖音 Content Script ====================
// 抖音全是推荐流，策略：进入必须填意图或声明娱乐模式
// 主题色：黑色（与其他平台统一的暗色风格）
// 计时：只在页面可见时计，focus=主动使用，relax=闲逛

(function () {
  'use strict';

  let sessionStart = Date.now();
  let intentSet = false;
  let gateDecision = null; // 'focus' | 'relax'

  // ---- 模式与计时（可见性感知）----
  let currentMode = 'idle';
  let lastCounted = Date.now();

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
      { type: 'ADD_TIME', platform: 'douyin', mode: currentMode, seconds },
      () => void chrome.runtime.lastError
    );
    lastCounted = now;
  }

  function reportTime() {
    if (document.visibilityState !== 'visible') return;
    forceReport();
  }

  // ---- 强制设置意图弹窗（黑色主题）----
  function showIntentGate() {
    if (document.getElementById('fg-dy-gate')) return;
    const gate = document.createElement('div');
    gate.id = 'fg-dy-gate';
    gate.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.95); display: flex;
      align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
    `;
    gate.innerHTML = `
      <div style="background:#1a1a1a; border-radius:20px; padding:40px 48px;
        max-width:440px; width:90%; text-align:center; color:#fff;
        border:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:48px; margin-bottom:16px;">🎯</div>
        <div style="font-size:22px; font-weight:700; margin-bottom:8px;">你来抖音做什么？</div>
        <div style="font-size:14px; color:#888; margin-bottom:28px;">
          告诉我目的，我帮你保持专注；或者直接说"我就是来玩的"
        </div>
        <input id="fg-dy-intent" type="text" placeholder="例如：看某个博主的教程、找灵感..."
          style="width:100%; box-sizing:border-box; padding:14px 16px; border-radius:12px;
          border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05);
          color:#fff; font-size:15px; outline:none; margin-bottom:16px;" />
        <div style="display:flex; gap:12px; margin-bottom:12px;">
          <input id="fg-dy-min" type="number" min="1" max="60" value="5"
            style="width:52px;padding:14px 6px;border-radius:12px;
            border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);
            color:#fff;font-size:15px;text-align:center;outline:none;"
          />
          <span style="font-size:14px;color:#aaa;line-height:46px;">分钟</span>
        </div>
        <div style="display:flex; gap:12px;">
          <button id="fg-dy-relax" disabled style="
            flex:1; padding:14px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);
            background:transparent; color:#555; cursor:not-allowed; font-size:14px;
          ">🎮 来玩的（<span id="fg-dy-relax-cd">5</span>s）</button>
          <button id="fg-dy-confirm" style="
            flex:2; padding:14px; border-radius:12px; border:none;
            background:#fff; color:#1a1a1a; cursor:pointer; font-size:15px; font-weight:600;
          ">进入</button>
        </div>
      </div>
    `;
    document.body.appendChild(gate);

    // "我就是来玩的"按钮：5秒倒计时后才能点击
    const relaxBtn = gate.querySelector('#fg-dy-relax');
    const relaxCdEl = gate.querySelector('#fg-dy-relax-cd');
    if (relaxBtn && relaxCdEl) {
      let relaxCd = 5;
      const relaxTimer = setInterval(() => {
        relaxCd--;
        relaxCdEl.textContent = relaxCd;
        if (relaxCd <= 0) {
          clearInterval(relaxTimer);
          relaxBtn.disabled = false;
          relaxBtn.style.color = '#aaa';
          relaxBtn.style.cursor = 'pointer';
          relaxBtn.style.borderColor = 'rgba(255,255,255,0.15)';
          relaxBtn.innerHTML = '🎮 我就是来玩的';
        }
      }, 1000);
    }

    gate.querySelector('#fg-dy-confirm').addEventListener('click', () => {
      const intent = gate.querySelector('#fg-dy-intent').value.trim();
      if (!intent) {
        gate.querySelector('#fg-dy-intent').style.borderColor = '#fff';
        return;
      }
      gateDecision = 'focus';
      currentMode = 'active';
      chrome.storage.local.set({ session_intent: intent, session_mode: 'focus', session_platform: 'douyin' });
      intentSet = true;
      gate.remove();
      startFocusMode(intent);
    });

    gate.querySelector('#fg-dy-relax').addEventListener('click', () => {
      if (gate.querySelector('#fg-dy-relax').disabled) return;
      const input = gate.querySelector('#fg-dy-min');
      const mins = parseInt(input ? input.value : '5', 10);
      const validMins = (isNaN(mins) || mins < 1) ? 5 : Math.min(60, mins);
      gateDecision = 'relax';
      currentMode = 'idle';
      chrome.storage.local.set({ session_intent: '', session_mode: 'relax', session_platform: 'douyin' });
      intentSet = true;
      gate.remove();
      startRelaxMode(validMins);
    });
  }

  function startRelaxMode(mins) {
    showToast(`${mins}分钟娱乐模式 🎮`);
    setTimeout(() => {
      showInterrupt(`${mins}分钟娱乐时间到了`, null, () => history.back());
    }, mins * 60 * 1000);
  }

  function startFocusMode(intent) {
    showToast(`已记录目标：${intent}`);
  }

  // ---- 计时器（黑色主题，与其他平台统一）----
  let timerEl = null;
  function createTimer() {
    timerEl = document.createElement('div');
    timerEl.id = 'fg-timer';
    timerEl.style.cssText = `
      position: fixed; bottom: 16px; right: 16px; z-index: 2147483640;
      background: rgba(0,0,0,0.55); color: #fff;
      padding: 4px 10px; border-radius: 16px;
      font-size: 12px; font-family: 'SF Mono', monospace;
      cursor: pointer; letter-spacing: 0.5px;
      transition: background 0.2s;
    `;
    timerEl.title = '点击查看统计';
    document.body.appendChild(timerEl);
    timerEl.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_STATS' }, () => void chrome.runtime.lastError);
    });
    timerEl.addEventListener('mouseenter', () => { timerEl.style.background = 'rgba(0,0,0,0.75)'; });
    timerEl.addEventListener('mouseleave', () => { timerEl.style.background = 'rgba(0,0,0,0.55)'; });
  }

  function updateTimer() {
    if (!timerEl) return;
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }

  // ---- 打断弹窗（黑色主题）----
  function showInterrupt(intent, onContinue, onLeave) {
    const old = document.getElementById('fg-dy-interrupt');
    if (old) old.remove();

    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    const timeStr = m > 0 ? `${m}分${s}秒` : `${s}秒`;

    const overlay = document.createElement('div');
    overlay.id = 'fg-dy-interrupt';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.8); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#1a1a1a; border-radius:16px; padding:32px 28px;
        max-width:380px; width:90%; text-align:left; color:#fff;
        border:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:12px; color:#888; margin-bottom:8px; letter-spacing:0.4px; text-transform:uppercase;">
          Focus Guard 提醒
        </div>
        <div style="font-size:20px; font-weight:700; margin-bottom:8px; line-height:1.3;">
          浏览了 <span style="color:#fff;opacity:0.85;">${timeStr}</span> 了
        </div>
        ${intent ? `
          <div style="background:rgba(255,255,255,0.06); border-radius:8px; padding:12px 14px; margin-bottom:20px;">
            <div style="font-size:11px; color:#888; margin-bottom:3px;">你来这里是为了</div>
            <div style="font-size:14px; font-weight:600;">${escHtml(intent)}</div>
          </div>
          <div style="font-size:14px; color:#aaa; margin-bottom:24px;">你还在做这件事吗？</div>
        ` : `
          <div style="font-size:14px; color:#aaa; margin-bottom:24px;">你有没有在做想做的事？</div>
        `}
        <div style="display:flex; gap:10px;">
          <button id="fg-dy-leave" style="
            flex:1; padding:12px; border-radius:8px; border:none;
            background:#fff; color:#1a1a1a; font-size:14px; font-weight:600;
            cursor:pointer; font-family:inherit;
          ">离开页面</button>
          <button id="fg-dy-continue" disabled style="
            flex:1; padding:12px; border-radius:8px;
            border:1px solid rgba(255,255,255,0.15); background:transparent;
            color:#888; font-size:14px; cursor:not-allowed; font-family:inherit;
          ">继续（<span id="fg-dy-cd">5</span>s）</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let cd = 5;
    const cdEl = overlay.querySelector('#fg-dy-cd');
    const continueBtn = overlay.querySelector('#fg-dy-continue');
    const timer = setInterval(() => {
      cd--;
      cdEl.textContent = cd;
      if (cd <= 0) {
        clearInterval(timer);
        continueBtn.disabled = false;
        continueBtn.style.color = '#fff';
        continueBtn.style.cursor = 'pointer';
        continueBtn.textContent = '继续浏览';
      }
    }, 1000);

    overlay.querySelector('#fg-dy-leave').addEventListener('click', () => {
      clearInterval(timer);
      overlay.remove();
      if (onLeave) onLeave(); else history.back();
    });
    continueBtn.addEventListener('click', () => {
      if (continueBtn.disabled) return;
      clearInterval(timer);
      overlay.remove();
      if (onContinue) onContinue();
    });
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(msg) {
    const old = document.getElementById('fg-dy-toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = 'fg-dy-toast';
    toast.style.cssText = `
      position: fixed; bottom: 60px; right: 20px; z-index: 2147483646;
      background: #1a1a1a; color: #fff; padding: 10px 16px;
      border-radius: 8px; font-size: 13px; font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.08);
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ---- 响应消息 ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FOCUS_INTERRUPT' && intentSet) {
      if (gateDecision === 'relax') return;
      chrome.storage.local.get('session_intent').then(data => {
        showInterrupt(data.session_intent || '', null, () => history.back());
      });
    }
    if (msg.type === 'GET_LIVE_SECONDS') {
      const seconds = Math.floor((Date.now() - lastCounted) / 1000);
      sendResponse({ seconds, mode: currentMode });
    }
  });

  // ---- 初始化 ----
  function init() {
    showIntentGate();
    createTimer();
    setInterval(updateTimer, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---- 可见性 + 上报 ----
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      forceReport();
    } else {
      lastCounted = Date.now();
    }
  });
  window.addEventListener('pagehide', forceReport);
  setInterval(reportTime, 15000);

})();
