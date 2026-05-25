import { CirclesRpc } from '@aboutcircles/sdk-rpc';
import { circlesConfig } from '@aboutcircles/sdk-utils';
import { getAddress } from 'viem';
import { setProfiles, state } from '../app/state.js';

let rpc = null;
let rpcUrl = null;

function resolveRpcUrl() {
  return (
    state?.hostContext?.circlesRpcUrl ||
    import.meta.env.VITE_CIRCLES_RPC_URL ||
    circlesConfig[100].circlesRpcUrl
  );
}

function getRpc() {
  const url = resolveRpcUrl();
  if (!rpc || rpcUrl !== url) {
    rpc = new CirclesRpc(url);
    rpcUrl = url;
  }
  return rpc;
}

const inflight = new Set();

function checksum(addr) {
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

/** Fetch profiles for any address not in the cache. Dedups + retries-safe. */
export async function ensureProfilesLoaded(addresses) {
  const unique = Array.from(
    new Set(
      (addresses || [])
        .map(checksum)
        .filter((a) => a && !state.profiles[a] && !inflight.has(a)),
    ),
  );
  if (unique.length === 0) return;
  unique.forEach((a) => inflight.add(a));

  try {
    const results = await getRpc().profile.getProfileByAddressBatch(unique);
    const patch = {};
    unique.forEach((addr, i) => {
      const p = results?.[i];
      patch[addr] = {
        name: p?.name || null,
        imageUrl: p?.previewImageUrl || p?.imageUrl || null,
        loaded: true,
      };
    });
    setProfiles(patch);
  } catch {
    const patch = {};
    unique.forEach((addr) => {
      patch[addr] = { name: null, imageUrl: null, loaded: true };
    });
    setProfiles(patch);
  } finally {
    unique.forEach((a) => inflight.delete(a));
  }
}

export function profileFor(address) {
  const a = checksum(address);
  if (!a) return null;
  return state.profiles[a] || null;
}

export function profileNameFor(address) {
  return profileFor(address)?.name || null;
}
