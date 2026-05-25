import {
  isMiniappMode,
  onAppData,
  onWalletChange,
  sendTransactions,
  signMessage,
} from '@aboutcircles/miniapp-sdk';

export { isMiniappMode, onAppData, onWalletChange, sendTransactions, signMessage };

export function toHexValue(value) {
  return value ? `0x${BigInt(value).toString(16)}` : '0x0';
}

function toHexData(data) {
  if (!data) return '0x';
  if (typeof data === 'string') return data.startsWith('0x') ? data : `0x${data}`;
  if (data instanceof Uint8Array) {
    return `0x${Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  return '0x';
}

/** Format txs for the Circles host (`sendTransactions`). */
export function formatTxForHost(tx) {
  return {
    to: tx.to,
    data: toHexData(tx.data),
    value: toHexValue(tx.value ?? 0n),
  };
}

export async function submitTransactions(txs) {
  return sendTransactions(txs.map(formatTxForHost));
}
