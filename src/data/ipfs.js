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

const PIN_ENDPOINT = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
const PINLIST_ENDPOINT = 'https://api.pinata.cloud/data/pinList';

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
  const res = await fetch(PIN_ENDPOINT, {
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
  const url = `${PINLIST_ENDPOINT}?status=pinned&pageLimit=${limit}&includesCount=false&${qvParts.join('&')}`;
  const res = await fetch(url, {
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
  const seen = new Set();
  const out = [];
  for (const pin of [...current, ...legacy]) {
    if (seen.has(pin.cid)) continue;
    seen.add(pin.cid);
    out.push(pin);
  }
  return out;
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
