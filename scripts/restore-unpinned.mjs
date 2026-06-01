#!/usr/bin/env node
/**
 * Re-pin Shorts content that was unpinned from Pinata but still exists on IPFS.
 *
 * Usage: node scripts/restore-unpinned.mjs [--dry-run]
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const APP_TAGS = new Set(['shorts', 'circles-shorts']);
const RESTORE_KINDS = new Set(['short', 'upvote', 'save', 'comment', 'flag', 'mod-vote', 'ruling']);

async function loadDotEnv() {
  try {
    const raw = await readFile(join(root, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m) continue;
      const [, k, v] = m;
      if (process.env[k] == null) {
        process.env[k] = v.trim().replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    /* ignore */
  }
}

async function listUnpinned(jwt) {
  const rows = [];
  let offset = 0;
  const pageLimit = 1000;
  for (;;) {
    const url = `https://api.pinata.cloud/data/pinList?status=unpinned&pageLimit=${pageLimit}&offset=${offset}&includesCount=false`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!res.ok) throw new Error(`pinList failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const batch = Array.isArray(json.rows) ? json.rows : [];
    rows.push(...batch);
    if (batch.length < pageLimit) break;
    offset += pageLimit;
  }
  return rows;
}

function shouldRestore(row) {
  const kv = row.metadata?.keyvalues || {};
  if (!APP_TAGS.has(kv.app)) return false;
  if (RESTORE_KINDS.has(kv.kind)) return true;
  return false;
}

async function fetchJson(cid) {
  const gateways = [
    'https://w3s.link',
    'https://gateway.pinata.cloud',
    'https://ipfs.io',
  ];
  for (const gw of gateways) {
    try {
      const res = await fetch(`${gw}/ipfs/${cid}`);
      if (!res.ok) continue;
      return await res.json();
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not fetch JSON from IPFS gateways');
}

async function repinJson(jwt, row) {
  const cid = row.ipfs_pin_hash;
  const name = row.metadata?.name || cid;
  const keyvalues = row.metadata?.keyvalues || {};
  const content = await fetchJson(cid);
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pinataContent: content,
      pinataMetadata: { name, keyvalues },
      pinataOptions: { cidVersion: 0 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  return json?.IpfsHash || cid;
}

async function main() {
  await loadDotEnv();
  const dryRun = process.argv.includes('--dry-run');
  const jwt = process.env.PINATA_JWT || process.env.VITE_PINATA_JWT;
  if (!jwt) {
    console.error('Missing VITE_PINATA_JWT in .env');
    process.exit(1);
  }

  const unpinned = await listUnpinned(jwt);
  const seen = new Set();
  const targets = unpinned.filter((row) => {
    if (!shouldRestore(row)) return false;
    if (seen.has(row.ipfs_pin_hash)) return false;
    seen.add(row.ipfs_pin_hash);
    return true;
  });
  const byKind = {};
  for (const row of targets) {
    const kind = row.metadata?.keyvalues?.kind || 'unknown';
    byKind[kind] = (byKind[kind] || 0) + 1;
  }

  console.log(`Found ${targets.length} unpinned Shorts pins to restore`, byKind);
  if (dryRun) return;

  let ok = 0;
  let fail = 0;
  for (const row of targets) {
    const cid = row.ipfs_pin_hash;
    const kind = row.metadata?.keyvalues?.kind;
    try {
      const newCid = await repinJson(jwt, row);
      ok++;
      console.log(`✓ ${kind} ${cid}${newCid !== cid ? ` → ${newCid}` : ''}`);
    } catch (err) {
      fail++;
      console.warn(`✗ ${kind} ${cid}:`, err.message);
    }
  }

  const pinned = await fetch('https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&includesCount=true', {
    headers: { Authorization: `Bearer ${jwt}` },
  }).then((r) => r.json());
  console.log(`Done. Restored ${ok}, failed ${fail}. Pinned count now: ${pinned.count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
