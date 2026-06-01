/**
 * Maps superseded short CIDs → stable short ids after an edit repins the JSON.
 * Feed sync pins (upvotes, saves, comments, flags) still reference the old CID.
 */

const KEY = 'shorts:cid-aliases:v1';

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

/** Remember that `oldCid` belonged to `shortId` before the short was repinned. */
export function recordCidAlias(oldCid, shortId) {
  if (!oldCid || !shortId || oldCid === shortId) return;
  const all = readAll();
  all[oldCid] = shortId;
  writeAll(all);
}

export function resolveShortIdFromCid(shortCid) {
  if (!shortCid) return null;
  return readAll()[shortCid] || null;
}

/** All superseded CIDs that map to this short id (for unpin / revoke). */
export function listAliasedCidsForShort(shortId) {
  if (!shortId) return [];
  const all = readAll();
  return Object.entries(all)
    .filter(([, id]) => id === shortId)
    .map(([cid]) => cid);
}

/**
 * @param {{ shorts: Array<{ id: string; cid?: string | null }> }} state
 * @param {{ shortCid?: string | null; shortId?: string | null }} refs
 */
export function resolveShortForRemote(state, { shortCid, shortId }) {
  if (shortId) {
    const byId = state.shorts.find((s) => s.id === shortId);
    if (byId) return byId;
  }
  if (shortCid) {
    const byCid = state.shorts.find((s) => s.cid === shortCid);
    if (byCid) return byCid;
    const aliasedId = resolveShortIdFromCid(shortCid);
    if (aliasedId) {
      return state.shorts.find((s) => s.id === aliasedId) || null;
    }
  }
  return null;
}
