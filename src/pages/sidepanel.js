function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || { ok: false });
    });
  });
}

FocusGuardPanel.mount(document.getElementById('root'), {
  send: send,
  assetBase: 'panel-assets/'
});
