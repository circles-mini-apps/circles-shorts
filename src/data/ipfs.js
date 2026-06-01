/**
 * Pinata-backed IPFS module.
 *
 * - `pinJson(obj, { name, keyvalues })` → uploads JSON, returns the CID
 * - `fetchJsonByCid(cid)` → reads JSON from a gateway (cached per session)
 * - `listPinnedCids({ keyvalues })` → queries Pinata pinList to discover content
 *
 * Pinata JWT is read from `VITE_PINATA_JWT`. Without it write/list call throws.
 * Reads (`fetchJsonByCid`) work without a JWT — only writes/discovery are gated.
 */

/** Same-origin proxy in dev avoids CSP / connection limits when embedded in the Circles host. */
function pinataBase() {
  return import.meta.env.DEV ? '/api/pinata' : 'https://api.pinata.cloud';
}

function pinEndpoint() {
  return `${pinataBase()}/pinning/pinJSONToIPFS`;
}

function pinListEndpoint() {
  return `${pinataBase()}/data/pinList`;
}

function unpinEndpoint(cid) {
  return `${pinataBase()}/pinning/unpin/${encodeURIComponent(cid)}`;
}

import { APP_NAMESPACE, LEGACY_APP_NAMESPACE } from '../app/config.js';

export { APP_NAMESPACE };

function jwt() {
  return import.meta.env.VITE_PINATA_JWT || '';
}

function gateways() {
  const custom = (import.meta.env.VITE_IPFS_GATEWAY || '').replace(/\/$/, '');
  const base = [
    custom,
    'https://w3s.link',
    'https://gateway.pinata.cloud',
    'https://ipfs.io',
    'https://dweb.link',
  ].filter(Boolean);
  return Array.from(new Set(base));
}

export function isPinningEnabled() {
  return Boolean(jwt());
}

/** Upload JSON to Pinata and return the CID. */
export async function pinJson(content, { name = APP_NAMESPACE, keyvalues = {} } = {}) {
  const token = jwt();
  if (!token) {
    throw new Error('IPFS pinning is not configured (set VITE_PINATA_JWT)');
  }
  const taggedKeyvalues = { app: APP_NAMESPACE, ...keyvalues };
  // Pinata keyvalues only accept primitive strings/numbers/booleans.
  const safeKeyvalues = Object.fromEntries(
    Object.entries(taggedKeyvalues)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : String(v)]),
  );
  const body = {
    pinataContent: content,
    pinataMetadata: { name, keyvalues: safeKeyvalues },
    pinataOptions: { cidVersion: 0 },
  };
  const res = await fetchWithRetry(pinEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Pinata pin failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const cid = json?.IpfsHash;
  if (!cid || typeof cid !== 'string') {
    throw new Error('Pinata returned no CID');
  }
  invalidatePinListCache();
  return cid;
}

/**
 * Query Pinata's pinList endpoint and return matching pins.
 * `keyvalues` is matched as exact-equality filters.
 * Always scoped to `app=shorts` (and legacy `circles-shorts` via `listPinnedCidsAllNamespaces`).
 *
 * Returns: Array<{ cid, name, keyvalues, pinnedAt }>
 */
export async function listPinnedCids({ keyvalues = {}, limit = 1000, appNamespace = APP_NAMESPACE } = {}) {
  const token = jwt();
  if (!token) {
    throw new Error('IPFS pinning is not configured (set VITE_PINATA_JWT)');
  }
  const tagged = { app: appNamespace, ...keyvalues };
  const qvParts = Object.entries(tagged).map(
    ([k, v]) => `metadata[keyvalues][${k}]=${encodeURIComponent(JSON.stringify({ value: String(v), op: 'eq' }))}`,
  );
  const url = `${pinListEndpoint()}?status=pinned&pageLimit=${limit}&includesCount=false&${qvParts.join('&')}`;
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Pinata pinList failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const rows = Array.isArray(json?.rows) ? json.rows : [];
  return rows.map((r) => ({
    cid: r.ipfs_pin_hash,
    name: r.metadata?.name || '',
    keyvalues: r.metadata?.keyvalues || {},
    pinnedAt: r.date_pinned || null,
  }));
}

/** Query current and legacy app namespaces, deduped by CID. */
export async function listPinnedCidsAllNamespaces(options = {}) {
  const [current, legacy] = await Promise.all([
    listPinnedCids({ ...options, appNamespace: APP_NAMESPACE }),
    listPinnedCids({ ...options, appNamespace: LEGACY_APP_NAMESPACE }),
  ]);
  return dedupePins([...current, ...legacy]);
}

/**
 * One pinList call per namespace (2 total), then filter by `keyvalues.kind` locally.
 * Avoids 14+ parallel pinList requests after the Shorts rename added legacy sync.
 */
export async function listAllAppPins({ limit = 1000 } = {}) {
  const [current, legacy] = await Promise.all([
    listPinnedCids({ limit, appNamespace: APP_NAMESPACE }),
    listPinnedCids({ limit, appNamespace: LEGACY_APP_NAMESPACE }),
  ]);
  return dedupePins([...current, ...legacy]);
}

let allPinsCache = null;
let allPinsCacheAt = 0;
const PINS_CACHE_MS = 30_000;

export async function listAllAppPinsCached({ limit = 1000, maxAgeMs = PINS_CACHE_MS } = {}) {
  const now = Date.now();
  if (allPinsCache && now - allPinsCacheAt < maxAgeMs) return allPinsCache;
  allPinsCache = await listAllAppPins({ limit });
  allPinsCacheAt = now;
  return allPinsCache;
}

export function invalidatePinListCache() {
  allPinsCache = null;
  allPinsCacheAt = 0;
}

function dedupePins(pins) {
  const seen = new Set();
  const out = [];
  for (const pin of pins) {
    if (seen.has(pin.cid)) continue;
    seen.add(pin.cid);
    out.push(pin);
  }
  return out;
}

/** Remove a pin from Pinata (stops discovery via pinList; content may linger on public gateways). */
export async function unpinCid(cid, { invalidateCache = true } = {}) {
  const token = jwt();
  if (!token) {
    throw new Error('IPFS pinning is not configured (set VITE_PINATA_JWT)');
  }
  if (!cid || typeof cid !== 'string') {
    throw new Error('CID required');
  }
  if (invalidateCache) invalidatePinListCache();
  const res = await fetchWithRetry(unpinEndpoint(cid), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Pinata unpin failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  clearCachedJson(cid);
}

/** Find and unpin every pin matching `keyvalues` (current + legacy app namespaces). */
export async function unpinMatchingPins({ keyvalues = {} } = {}) {
  const pins = await listPinnedCidsAllNamespaces({ keyvalues });
  const cids = dedupePins(pins).map((p) => p.cid);
  await unpinCids(cids);
  return cids;
}

/**
 * Unpin upvote/save pins for a short + actor via targeted pinList filters
 * (small result sets; avoids loading every app pin).
 */
export async function unpinInteractionPinsFast({
  kind,
  shortId,
  shortCids = [],
  actorKey,
  actor,
}) {
  if (!jwt() || !shortId || !actor || !actorKey) return [];
  const actorNorm = String(actor).toLowerCase();
  const keyvalueSets = new Map();
  const addQuery = (kv) => keyvalueSets.set(JSON.stringify(kv), kv);

  addQuery({ kind, shortId, [actorKey]: actorNorm });
  for (const shortCid of shortCids.filter(Boolean)) {
    addQuery({ kind, shortCid, [actorKey]: actorNorm });
  }

  const pinLists = await Promise.all(
    [...keyvalueSets.values()].flatMap((keyvalues) => [
      listPinnedCids({ keyvalues, appNamespace: APP_NAMESPACE }),
      listPinnedCids({ keyvalues, appNamespace: LEGACY_APP_NAMESPACE }),
    ]),
  );

  const cids = dedupePins(pinLists.flat()).map((p) => p.cid);
  await unpinCids(cids);
  return cids;
}

async function unpinCids(cids) {
  if (!cids.length) return;
  await Promise.all(
    cids.map(async (cid) => {
      try {
        await unpinCid(cid, { invalidateCache: false });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('IPFS unpin failed for', cid, err);
      }
    }),
  );
  invalidatePinListCache();
}

async function fetchWithRetry(url, options, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error('Network request failed');
}

const memoryCache = new Map();

function lsKey(cid) {
  return `ipfs:json:${cid}`;
}

function readCachedJson(cid) {
  if (memoryCache.has(cid)) return memoryCache.get(cid);
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(lsKey(cid)) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      memoryCache.set(cid, parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCachedJson(cid, value) {
  memoryCache.set(cid, value);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(lsKey(cid), JSON.stringify(value));
    }
  } catch {
    /* ignore quota */
  }
}

function clearCachedJson(cid) {
  memoryCache.delete(cid);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(lsKey(cid));
    }
  } catch {
    /* ignore */
  }
}

/** Fetch and parse JSON for a CID. Tries gateways in order, caches indefinitely. */
export async function fetchJsonByCid(cid) {
  if (!cid || typeof cid !== 'string') throw new Error('CID required');
  const cached = readCachedJson(cid);
  if (cached) return cached;

  let lastErr = null;
  for (const gw of gateways()) {
    try {
      const url = `${gw}/ipfs/${cid}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        lastErr = new Error(`${gw} → ${res.status}`);
        continue;
      }
      const json = await res.json();
      writeCachedJson(cid, json);
      return json;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All IPFS gateways failed');
}
