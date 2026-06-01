let reqId = 0;

export function normalizeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.shortMessage || err.message || String(err);
}

export function classifyError(err) {
  const message = normalizeError(err).toLowerCase();
  if (message.includes('reject') || message.includes('denied') || message.includes('cancel')) {
    return 'user_rejected';
  }
  if (message.includes('network') || message.includes('fetch')) return 'network_error';
  if (message.includes('bridge') || message.includes('host')) return 'host_bridge_error';
  if (message.includes('invalid') || message.includes('validation')) return 'validation_error';
  return 'unexpected_error';
}

/** Ignore stale async results when wallet or inputs change mid-flight. */
export async function runLatest(task) {
  const id = ++reqId;
  const result = await task();
  if (id !== reqId) return null;
  return result;
}

export function safelyParseHostData(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function shortAddress(addr) {
  if (!addr || typeof addr !== 'string' || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Truncate visible text to a max character count (adds … when shortened). */
export function truncateText(text, maxLen) {
  const s = String(text ?? '');
  if (maxLen <= 0 || s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

export function timeAgo(ms) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const DEFAULT_PROFILE_TEMPLATE = 'https://app.gnosis.io/{address}';

/** Build a public URL to view a Circles avatar profile by address. */
export function circlesProfileUrl(address) {
  if (!address || typeof address !== 'string') return null;
  const template = import.meta.env.VITE_PROFILE_URL_TEMPLATE || DEFAULT_PROFILE_TEMPLATE;
  return template.replace('{address}', address);
}

/**
 * Copy text to the clipboard. Tries the async Clipboard API first; falls back
 * to the legacy textarea+execCommand path which still works inside many
 * sandboxed iframes.
 *
 * @returns Promise<boolean> — true on success
 */
export async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to legacy */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
