import { TransferBuilder } from '@aboutcircles/sdk-transfers';
import { circlesConfig, encodeCrcV2TransferData, hexToBytes } from '@aboutcircles/sdk-utils';
import { getAddress } from 'viem';
import { submitTransactions } from '../host/bridge.js';
import { state } from '../app/state.js';

export const ATTO_PER_CRC = 10n ** 18n;

/** Convert a CRC decimal (string or number) to atto-CRC BigInt. */
export function crcToAtto(value) {
  const s = typeof value === 'number' ? value.toString() : String(value);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Invalid CRC amount');
  const [whole, frac = ''] = s.split('.');
  const padded = (frac + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole) * ATTO_PER_CRC + BigInt(padded || '0');
}

function resolveRpcUrl() {
  const fromHost = state?.hostContext?.circlesRpcUrl;
  const fromEnv = import.meta.env.VITE_CIRCLES_RPC_URL;
  return fromHost || fromEnv || circlesConfig[100].circlesRpcUrl;
}

function getConfig() {
  return { ...circlesConfig[100], circlesRpcUrl: resolveRpcUrl() };
}

let cachedBuilder = null;
let cachedRpc = null;
function getBuilder() {
  const rpc = resolveRpcUrl();
  if (!cachedBuilder || cachedRpc !== rpc) {
    cachedBuilder = new TransferBuilder(getConfig());
    cachedRpc = rpc;
  }
  return cachedBuilder;
}

/** Encode an IPFS CID as Circles V2 transferData (type 0x0003). */
function encodeCidTxData(cid) {
  if (!cid) return undefined;
  const hex = encodeCrcV2TransferData([cid], 0x0003);
  return hexToBytes(hex);
}

/**
 * Build a CRC transfer (in atto-CRC) from `from` to `to`.
 * Returns an array of host-ready transactions (not yet submitted).
 * Optionally embed an IPFS CID via transferData.
 */
export async function buildCrcTransferTxs(from, to, atto, { cid } = {}) {
  const fromAddr = getAddress(from);
  const toAddr = getAddress(to);
  if (typeof atto !== 'bigint' || atto <= 0n) {
    throw new Error('Amount must be a positive bigint');
  }
  const builder = getBuilder();
  const txData = encodeCidTxData(cid);
  const options = txData ? { txData } : undefined;
  return builder.constructAdvancedTransfer(fromAddr, toAddr, atto, options);
}

/**
 * Build and submit a CRC transfer through the host bridge.
 * Returns the array of submitted tx hashes (from `sendTransactions`).
 */
export async function sendCrc(from, to, atto, opts = {}) {
  const txs = await buildCrcTransferTxs(from, to, atto, opts);
  if (!txs.length) {
    throw new Error('No transactions produced for transfer');
  }
  return submitTransactions(txs);
}

/** Demo mode: skip on-chain CRC calls (set VITE_DEMO_NO_CRC=true). */
export function isDemoMode() {
  return import.meta.env.VITE_DEMO_NO_CRC === 'true';
}
