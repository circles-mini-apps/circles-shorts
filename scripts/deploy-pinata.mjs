#!/usr/bin/env node
/**
 * Pin the `dist/` folder to Pinata and print the gateway URL.
 *
 * Usage:
 *   npm run build && npm run deploy
 *
 * Reads PINATA_JWT (or VITE_PINATA_JWT) from process env or .env.
 * Reads PINATA_GATEWAY (or VITE_IPFS_GATEWAY) for the printed URL.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');

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
    /* ignore — env may come from shell */
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  await loadDotEnv();
  const jwt = process.env.PINATA_JWT || process.env.VITE_PINATA_JWT;
  if (!jwt) {
    console.error('Missing PINATA_JWT (or VITE_PINATA_JWT) in env / .env');
    process.exit(1);
  }
  const gateway = (process.env.PINATA_GATEWAY || process.env.VITE_IPFS_GATEWAY || 'https://gateway.pinata.cloud').replace(/\/$/, '');

  try {
    await stat(distDir);
  } catch {
    console.error(`No dist/ folder found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const files = await walk(distDir);
  if (files.length === 0) {
    console.error('dist/ is empty.');
    process.exit(1);
  }

  // Build multipart form with folder-relative paths so Pinata preserves structure.
  const form = new FormData();
  const folderName = `circles-shorts-${Date.now()}`;
  for (const filePath of files) {
    const rel = relative(distDir, filePath).split(sep).join('/');
    const buf = await readFile(filePath);
    form.append('file', new Blob([buf]), `${folderName}/${rel}`);
  }
  form.append(
    'pinataMetadata',
    JSON.stringify({
      name: folderName,
      keyvalues: { app: 'circles-shorts', kind: 'static-site' },
    }),
  );
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1, wrapWithDirectory: false }));

  process.stdout.write(`Uploading ${files.length} files (${folderName}) to Pinata…\n`);
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`Pinata error ${res.status}: ${detail.slice(0, 400)}`);
    process.exit(1);
  }
  const json = await res.json();
  const cid = json?.IpfsHash;
  if (!cid) {
    console.error('Pinata returned no CID');
    process.exit(1);
  }

  const url = `${gateway}/ipfs/${cid}/`;
  console.log('');
  console.log(`✓ Pinned to Pinata`);
  console.log(`  CID:       ${cid}`);
  console.log(`  Size:      ${json.PinSize ?? '?'} bytes`);
  console.log(`  Open at:   ${url}`);
  console.log('');
  console.log('Paste the URL above into the Circles miniapp host to load this build.');
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
