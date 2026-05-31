/**
 * Per-user index of shorts they flagged (survives feed sync + short CID changes).
 */

const KEY = 'shorts:user-flags:v1';

/** @typedef {{ shortId: string; shortCid: string | null; flagCid: string | null; at: number }} UserFlagEntry */

function readAll() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

function addrKey(address) {
  return String(address || '').toLowerCase();
}

/** @returns {UserFlagEntry[]} */
export function userFlagEntries(address) {
  const key = addrKey(address);
  if (!key) return [];
  const list = readAll()[key];
  return Array.isArray(list) ? list : [];
}

export function recordUserFlag(address, { shortId, shortCid = null, flagCid = null }) {
  const key = addrKey(address);
  if (!key || !shortId) return;
  const all = readAll();
  const list = userFlagEntries(address).filter(
    (e) => e.shortId !== shortId && !(shortCid && e.shortCid === shortCid),
  );
  list.unshift({
    shortId,
    shortCid: shortCid || null,
    flagCid: flagCid || null,
    at: Date.now(),
  });
  all[key] = list.slice(0, 200);
  writeAll(all);
}

export function removeUserFlag(address, { shortId, shortCid = null, flagCid = null }) {
  const key = addrKey(address);
  if (!key) return;
  const all = readAll();
  const list = userFlagEntries(address).filter((e) => {
    if (shortId && e.shortId === shortId) return false;
    if (flagCid && e.flagCid === flagCid) return false;
    if (shortCid && e.shortCid === shortCid) return false;
    return true;
  });
  all[key] = list;
  writeAll(all);
}

export function userFlaggedShortIds(address) {
  return new Set(userFlagEntries(address).map((e) => e.shortId).filter(Boolean));
}

/** Backfill index from moderation state (one-time repair for existing flags). */
export function syncUserFlagsFromShorts(address, shorts) {
  const me = addrKey(address);
  if (!me) return;
  for (const s of shorts) {
    const m = s.moderation;
    if (!m) continue;
    const flagger = m.activeFlag?.flagger || m.resolvedFlagger;
    if (flagger?.toLowerCase() !== me) continue;
    recordUserFlag(me, {
      shortId: s.id,
      shortCid: s.cid || null,
      flagCid: m.activeFlag?.cid || null,
    });
  }
}
