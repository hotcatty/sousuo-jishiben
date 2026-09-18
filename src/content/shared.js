// ==================== Focus Guard: 共享打断逻辑 ====================
// 所有平台的 content script 都会用到这个模块的逻辑（直接内联）

window.__focusGuard = window.__focusGuard || {};

window.__focusGuard.showInterrupt = function(intent, onContinue, onLeave) {
  // 移除旧的弹窗
  const old = document.getElementById('fg-interrupt-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'fg-interrupt-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px; padding: 40px 48px; max-width: 480px; width: 90%;
    text-align: center; color: #fff; box-shadow: 0 24px 80px rgba(0,0,0,0.5);
  `;

  const timeSpent = window.__focusGuard.getSessionTime ? window.__focusGuard.getSessionTime() : '一段时间';

  card.innerHTML = `
    <div style="font-size:48px; margin-bottom:16px;">⏸️</div>
    <div style="font-size:13px; color:#888; margin-bottom:8px; letter-spacing:1px; text-transform:uppercase;">Focus Guard 打断提醒</div>
    <div style="font-size:22px; font-weight:700; margin-bottom:12px; line-height:1.4;">
      你已经刷了 <span style="color:#f5a623">${timeSpent}</span>
    </div>
    ${intent ? `
      <div style="background:rgba(245,166,35,0.1); border:1px solid rgba(245,166,35,0.3);
        border-radius:12px; padding:16px; margin-bottom:24px;">
        <div style="font-size:12px; color:#f5a623; margin-bottom:6px;">你来这里是为了</div>
        <div style="font-size:18px; font-weight:600;">${intent}</div>
      </div>
      <div style="font-size:14px; color:#aaa; margin-bottom:28px;">你还在做这件事吗？</div>
    ` : `
      <div style="font-size:14px; color:#aaa; margin-bottom:28px;">
        你有没有在做最初想做的事？
      </div>
    `}
    <div style="display:flex; gap:12px; justify-content:center;">
      <button id="fg-leave" style="
        flex:1; padding:14px; border-radius:12px; border:none; cursor:pointer;
        background:#e74c3c; color:#fff; font-size:15px; font-weight:600;
        transition: opacity 0.2s;
      ">离开页面</button>
      <button id="fg-continue" style="
        flex:1; padding:14px; border-radius:12px; border:none; cursor:pointer;
        background:rgba(255,255,255,0.1); color:#fff; font-size:15px;
        transition: opacity 0.2s; position:relative; overflow:hidden;
      ">
        <span id="fg-continue-text">继续（<span id="fg-countdown">5</span>s）</span>
      </button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // 继续按钮需要等 5 秒
  let countdown = 5;
  const continueBtn = card.querySelector('#fg-continue');
  const countdownEl = card.querySelector('#fg-countdown');
  continueBtn.disabled = true;
  continueBtn.style.opacity = '0.5';

  const timer = setInterval(() => {
    countdown--;
    if (countdownEl) countdownEl.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(timer);
      continueBtn.disabled = false;
      continueBtn.style.opacity = '1';
      const textEl = card.querySelector('#fg-continue-text');
      if (textEl) textEl.textContent = '继续浏览';
    }
  }, 1000);

  card.querySelector('#fg-leave').addEventListener('click', () => {
    clearInterval(timer);
    overlay.remove();
    if (onLeave) onLeave();
    else history.back();
  });

  continueBtn.addEventListener('click', () => {
    if (continueBtn.disabled) return;
    clearInterval(timer);
    overlay.remove();
    if (onContinue) onContinue();
  });
};

window.__focusGuard.showToast = function(msg, color = '#f5a623') {
  const old = document.getElementById('fg-toast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.id = 'fg-toast';
  toast.style.cssText = `
    position: fixed; bottom: 80px; right: 24px; z-index: 2147483646;
    background: ${color}; color: #fff; padding: 12px 20px;
    border-radius: 12px; font-size: 14px; font-weight: 600;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
    animation: fgSlideIn 0.3s ease;
    max-width: 280px; line-height: 1.4;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
};
