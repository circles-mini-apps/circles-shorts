#!/usr/bin/env node
/**
 * Register a Circles organisation avatar for Shorts platform fees.
 *
 * Usage:
 *   npm run register:org
 *
 * Env (.env or shell):
 *   ORG_REGISTER_PRIVATE_KEY=0x...     required — Safe owner private key
 *   ORG_SAFE_ADDRESS=0x...             required — Safe that becomes the organisation
 *   ORG_NAME=Shorts                       optional
 *   ORG_DESCRIPTION=...                optional
 *   ORG_AVATAR_URL=                    optional profile image URL
 *   ORG_PREVIEW_IMAGE_URL=             optional preview image URL
 *   ORG_RPC_URL=https://rpc.aboutcircles.com/  optional
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sdk } from '@aboutcircles/sdk';
import { circlesConfig } from '@aboutcircles/sdk-utils';
import { SafeContractRunner, chains } from '@aboutcircles/sdk-runner';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function loadDotEnv() {
  try {
    const raw = await readFile(join(root, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m) continue;
      const [, k, v] = m;
      if (process.env[k] == null) {
        process.env[k] = v.replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    /* env from shell only */
  }
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name} in .env or environment.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  await loadDotEnv();

  const privateKey = requireEnv('ORG_REGISTER_PRIVATE_KEY');
  const safeAddress = requireEnv('ORG_SAFE_ADDRESS');
  const rpcUrl =
    process.env.ORG_RPC_URL?.trim() ||
    process.env.VITE_CIRCLES_RPC_URL?.trim() ||
    'https://rpc.aboutcircles.com/';

  const runner = await SafeContractRunner.create(
    rpcUrl,
    privateKey,
    safeAddress,
    chains.gnosis,
  );

  // Docs use { rpcUrl }; SDK config field is circlesRpcUrl (Gnosis defaults from circlesConfig[100]).
  const sdk = new Sdk({ ...circlesConfig[100], circlesRpcUrl: rpcUrl }, runner);

  const orgAvatar = await sdk.register.asOrganization({
    name: process.env.ORG_NAME?.trim() || 'Shorts',
    description:
      process.env.ORG_DESCRIPTION?.trim() ||
      'Circles-enabled community treasury for Shorts publish and flag fees.',
    avatarUrl: process.env.ORG_AVATAR_URL?.trim() || '',
    previewImageUrl: process.env.ORG_PREVIEW_IMAGE_URL?.trim() || '',
  });

  console.log('Organization avatar:', orgAvatar.address);
  console.log('');
  console.log('Add to .env and redeploy:');
  console.log(`  VITE_PLATFORM_ORG_ADDRESS=${orgAvatar.address}`);
}

main().catch((err) => {
  console.error(err?.shortMessage || err?.message || err);
  process.exit(1);
});
