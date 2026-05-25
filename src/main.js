import { handleWalletChange, maybeBackgroundSync, syncFeed } from './app/actions.js';
import { initUi } from './app/ui.js';
import { applyHostContext, refreshShorts } from './app/state.js';
import { isMiniappMode, onAppData, onWalletChange } from './host/bridge.js';
import { safelyParseHostData } from './utils/format.js';

function applyValidatedHostData(raw) {
  const data = safelyParseHostData(raw);
  const next = {};

  if (typeof data.circlesRpcUrl === 'string' && /^https:\/\//i.test(data.circlesRpcUrl)) {
    next.circlesRpcUrl = data.circlesRpcUrl;
  }
  if (data.mode != null) next.mode = String(data.mode);
  if (data.resourceId != null) next.resourceId = String(data.resourceId);

  applyHostContext(next);
}

refreshShorts();
initUi();

void syncFeed();

onAppData(applyValidatedHostData);

onWalletChange((address) => {
  handleWalletChange(address);
});

if (!isMiniappMode()) {
  // Standalone: don't auto-connect; user sees disconnected state.
  // UI handles the "connect wallet" call-to-action implicitly via disabled actions.
}

window.addEventListener('focus', () => maybeBackgroundSync(15_000));
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeBackgroundSync(15_000);
});
setInterval(() => maybeBackgroundSync(60_000), 60_000);
