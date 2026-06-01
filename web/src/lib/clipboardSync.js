/** Hub (browser) clipboard sync with remote host. */

let lastFromHost = "";
let lastToHost = "";

export function applyHostClipboard(text) {
  if (!text || text === lastFromHost) {
    return Promise.resolve();
  }
  lastFromHost = text;
  if (!navigator.clipboard?.writeText) {
    return Promise.reject(new Error("Clipboard API unavailable"));
  }
  return navigator.clipboard.writeText(text);
}

export function pushHubClipboardToHost(sendControl) {
  if (!navigator.clipboard?.readText) {
    return Promise.resolve();
  }
  return navigator.clipboard.readText().then((text) => {
    if (!text || text === lastToHost) return;
    lastToHost = text;
    sendControl({ type: "clipboard", text, from: "hub" });
  });
}

export function markHubClipboardSent(text) {
  lastToHost = text || lastToHost;
}

export function resetClipboardSyncState() {
  lastFromHost = "";
  lastToHost = "";
}
