import { getAddress, isAddress } from 'viem';
import { verifyWalletSignature } from './verifyWalletSignature.js';
import { buildPinMessage, buildUnpinMessage } from './ipfsAuthMessage.js';
import { crcDecimalToAtto, verifyCrcPayment } from './ipfsTransferVerify.js';
import {
  pinJsonToPinata,
  unpinFromPinata,
  listPinsFromPinata,
  fetchJsonFromGateways,
  pinataJwt,
  APP_NAMESPACE,
  LEGACY_APP_NAMESPACE,
} from './pinataApi.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const INTERACT_CRC = '0.5';
const PUBLISH_CRC = '1';
const FLAG_CRC = '0.5';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function bad(message, status = 400) {
  return json({ error: message }, status);
}

function resolveRpcUrl(env) {
  return env.CIRCLES_RPC_URL || env.VITE_CIRCLES_RPC_URL || 'https://rpc.aboutcircles.com/';
}

function resolvePlatformOrg(env) {
  const raw = env.PLATFORM_ORG_ADDRESS || env.VITE_PLATFORM_ORG_ADDRESS || '0x507F542f14F55315F96aD1D454859EaA5c9E1923';
  return isAddress(raw) ? getAddress(raw) : getAddress('0x507F542f14F55315F96aD1D454859EaA5c9E1923');
}

function contentSuffix(kind) {
  if (!kind || typeof kind !== 'string') return '';
  const idx = kind.lastIndexOf(':');
  return idx >= 0 ? kind.slice(idx + 1) : kind;
}

function actorFromContent(content) {
  const suffix = contentSuffix(content?.kind);
  switch (suffix) {
    case 'short':
      return { field: 'creator', value: content.creator };
    case 'comment':
      return { field: 'author', value: content.author };
    case 'upvote':
      return { field: 'voter', value: content.voter };
    case 'save':
      return { field: 'saver', value: content.saver };
    case 'flag':
      return { field: 'flagger', value: content.flagger };
    case 'moderation-vote':
      return { field: 'voter', value: content.voter };
    case 'moderation-ruling':
      return { field: 'flagger', value: content.flagger };
    default:
      return { field: null, value: null };
  }
}

async function authorizePinPayment({ env, address, content, paymentKind, txHashes, demo }) {
  if (demo && env.ALLOW_DEMO_IPFS === 'true') return;

  const suffix = contentSuffix(content?.kind);
  const rpcUrl = resolveRpcUrl(env);
  const platformOrg = resolvePlatformOrg(env);

  if (suffix === 'save') return;

  if (suffix === 'short') {
    if (paymentKind === 'free') return;
    const ok = await verifyCrcPayment({
      rpcUrl,
      from: address,
      to: platformOrg,
      minAtto: crcDecimalToAtto(PUBLISH_CRC),
      txHashes,
      sinceMs: Date.now() - 15 * 60 * 1000,
    });
    if (!ok) throw new Error('Publish payment not verified on-chain');
    return;
  }

  if (suffix === 'flag') {
    const ok = await verifyCrcPayment({
      rpcUrl,
      from: address,
      to: platformOrg,
      minAtto: crcDecimalToAtto(FLAG_CRC),
      txHashes,
      sinceMs: Date.now() - 15 * 60 * 1000,
    });
    if (!ok) throw new Error('Flag payment not verified on-chain');
    return;
  }

  if (suffix === 'comment' || suffix === 'upvote') {
    const creator = content.creator || content.payTo;
    if (!creator || !isAddress(creator)) {
      throw new Error('Comment/upvote payload must include creator address');
    }
    const ok = await verifyCrcPayment({
      rpcUrl,
      from: address,
      to: getAddress(creator),
      minAtto: crcDecimalToAtto(INTERACT_CRC),
      txHashes,
      sinceMs: Date.now() - 15 * 60 * 1000,
    });
    if (!ok) throw new Error('Interaction payment not verified on-chain');
    return;
  }
}

async function authorizeUnpinActor({ content, address }) {
  const { value } = actorFromContent(content);
  if (!value) throw new Error('Cannot determine pin owner');
  if (String(value).toLowerCase() !== String(address).toLowerCase()) {
    throw new Error('Only the pin owner can remove this IPFS pin');
  }
}

export async function handleIpfsPinRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }
  if (request.method !== 'POST') return bad('Method not allowed', 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return bad('Invalid JSON body');
  }

  const {
    address,
    message,
    signature,
    content,
    name,
    keyvalues = {},
    txHashes = [],
    paymentKind = 'none',
    demo = false,
  } = body || {};

  if (!content || typeof content !== 'object') return bad('content required');
  if (!address || !message || !signature) return bad('address, message, and signature required');

  const valid = await verifyWalletSignature(address, message, signature, env);
  if (!valid) return bad('Invalid wallet signature', 401);

  const actor = actorFromContent(content);
  if (!actor.value || String(actor.value).toLowerCase() !== String(address).toLowerCase()) {
    return bad('Payload actor must match signed wallet', 403);
  }

  try {
    await authorizePinPayment({ env, address, content, paymentKind, txHashes, demo });
  } catch (err) {
    return bad(err.message || 'Payment verification failed', 403);
  }

  const jwt = pinataJwt(env);
  if (!jwt) return bad('IPFS server not configured', 503);

  try {
    const cid = await pinJsonToPinata(jwt, content, { name: name || 'shorts', keyvalues });
    return json({ cid });
  } catch (err) {
    return bad(err.message || 'Pin failed', 502);
  }
}

export async function handleIpfsUnpinRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }
  if (request.method !== 'POST') return bad('Method not allowed', 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return bad('Invalid JSON body');
  }

  const { address, message, signature, cid } = body || {};
  if (!cid) return bad('cid required');
  if (!address || !message || !signature) return bad('address, message, and signature required');

  const valid = await verifyWalletSignature(address, message, signature, env);
  if (!valid) return bad('Invalid wallet signature', 401);

  let content;
  try {
    content = await fetchJsonFromGateways(cid);
  } catch {
    return bad('Could not load pin content for authorization', 404);
  }

  try {
    await authorizeUnpinActor({ content, address });
  } catch (err) {
    return bad(err.message || 'Not authorized to unpin', 403);
  }

  const jwt = pinataJwt(env);
  if (!jwt) return bad('IPFS server not configured', 503);

  try {
    await unpinFromPinata(jwt, cid);
    return json({ ok: true, cid });
  } catch (err) {
    return bad(err.message || 'Unpin failed', 502);
  }
}

export async function handleIpfsPinListRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    });
  }
  if (request.method !== 'GET') return bad('Method not allowed', 405);

  const jwt = pinataJwt(env);
  if (!jwt) return bad('IPFS server not configured', 503);

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);
  const namespace = url.searchParams.get('namespace') || APP_NAMESPACE;
  const keyvalues = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith('kv.')) keyvalues[key.slice(3)] = value;
  }

  try {
    const rows = await listPinsFromPinata(jwt, {
      keyvalues,
      limit,
      appNamespace: namespace === LEGACY_APP_NAMESPACE ? LEGACY_APP_NAMESPACE : APP_NAMESPACE,
    });
    return json({ rows });
  } catch (err) {
    return bad(err.message || 'pinList failed', 502);
  }
}

export { buildPinMessage, buildUnpinMessage };
