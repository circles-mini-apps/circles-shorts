/** Canonical sign-in messages for IPFS pin/unpin API requests. */

export function buildPinMessage({ address, content, nonce, paymentKind = 'none' }) {
  const payload = stableStringify(content);
  return [
    'Shorts IPFS pin',
    `address:${String(address).toLowerCase()}`,
    `payment:${paymentKind}`,
    `nonce:${nonce}`,
    `payload:${payload}`,
  ].join('\n');
}

export function buildUnpinMessage({ address, cid, nonce }) {
  return [
    'Shorts IPFS unpin',
    `address:${String(address).toLowerCase()}`,
    `cid:${cid}`,
    `nonce:${nonce}`,
  ].join('\n');
}

function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortKeys(value[key]);
      return acc;
    }, {});
}
