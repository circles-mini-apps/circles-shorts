import { signMessage } from '../host/bridge.js';
import { state } from '../app/state.js';
import { isDemoMode } from '../chain/circlesTransfer.js';
import { buildPinMessage, buildUnpinMessage } from '../../lib/ipfsAuthMessage.js';

function useDirectPinata() {
  return import.meta.env.VITE_IPFS_DIRECT === 'true' && Boolean(import.meta.env.VITE_PINATA_JWT);
}

export function useServerIpfs() {
  return !useDirectPinata();
}

export function isServerIpfsAvailable() {
  return useServerIpfs() || Boolean(import.meta.env.VITE_PINATA_JWT);
}

function requireAddress(explicit) {
  const addr = explicit || state.connectedAddress;
  if (!addr) throw new Error('Connect a wallet to use IPFS');
  return addr;
}

async function signAuthMessage(message) {
  const { signature } = await signMessage(message, 'erc1271');
  if (!signature) throw new Error('Wallet did not sign the request');
  return signature;
}

export async function requestSignedPin({
  address,
  content,
  name,
  keyvalues,
  txHashes = [],
  paymentKind = 'none',
}) {
  const from = requireAddress(address);
  const nonce = Date.now();
  const message = buildPinMessage({
    address: from,
    content,
    nonce,
    paymentKind,
  });
  const signature = await signAuthMessage(message);
  const res = await fetch('./api/ipfs/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: from,
      message,
      signature,
      content,
      name,
      keyvalues,
      txHashes,
      paymentKind,
      demo: isDemoMode(),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `IPFS pin failed (${res.status})`);
  }
  return json.cid;
}

export async function requestSignedUnpin({ address, cid }) {
  const from = requireAddress(address);
  const nonce = Date.now();
  const message = buildUnpinMessage({ address: from, cid, nonce });
  const signature = await signAuthMessage(message);
  const res = await fetch('./api/ipfs/unpin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: from, message, signature, cid }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `IPFS unpin failed (${res.status})`);
  }
  return json.cid;
}

export async function fetchPinListFromServer({ keyvalues = {}, limit = 1000, appNamespace }) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (appNamespace) params.set('namespace', appNamespace);
  for (const [k, v] of Object.entries(keyvalues)) {
    if (v != null) params.set(`kv.${k}`, String(v));
  }
  const res = await fetch(`./api/ipfs/pin-list?${params.toString()}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `IPFS pinList failed (${res.status})`);
  }
  return Array.isArray(json.rows) ? json.rows : [];
}
