/**
 * Verify CRC payments via Circles RPC (used by IPFS API + feed sync).
 */

const ATTO_PER_CRC = 10n ** 18n;

export function crcDecimalToAtto(value) {
  const s = String(value);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Invalid CRC amount');
  const [whole, frac = ''] = s.split('.');
  const padded = (frac + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole) * ATTO_PER_CRC + BigInt(padded || '0');
}

function normalizeAddr(a) {
  return String(a || '').toLowerCase();
}

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}

async function getTransactionHistory(rpcUrl, avatar, limit = 50) {
  const result = await rpcCall(rpcUrl, 'circles_getTransactionHistory', [
    normalizeAddr(avatar),
    limit,
    null,
  ]);
  return Array.isArray(result?.results) ? result.results : [];
}

function rowMatchesPayment(row, { from, to, minAtto, sinceSec, txHashes }) {
  if (normalizeAddr(row.from) !== normalizeAddr(from)) return false;
  if (normalizeAddr(row.to) !== normalizeAddr(to)) return false;
  if (sinceSec && Number(row.timestamp || 0) < sinceSec) return false;
  const amount = BigInt(row.attoCircles || row.attoCrc || '0');
  if (amount < minAtto) return false;
  if (txHashes?.length) {
    const hash = String(row.transactionHash || '').toLowerCase();
    if (!txHashes.map((h) => String(h).toLowerCase()).includes(hash)) return false;
  }
  return true;
}

/**
 * @param {object} opts
 * @param {string} opts.rpcUrl
 * @param {string} opts.from payer avatar
 * @param {string} opts.to recipient avatar
 * @param {bigint} opts.minAtto minimum atto-CRC
 * @param {string[]} [opts.txHashes] optional exact tx hashes from host
 * @param {number} [opts.sinceMs] only accept transfers after this unix ms
 */
export async function verifyCrcPayment({
  rpcUrl,
  from,
  to,
  minAtto,
  txHashes = [],
  sinceMs = 0,
}) {
  if (!rpcUrl || !from || !to) return false;
  const sinceSec = sinceMs ? Math.floor(sinceMs / 1000) - 600 : 0;
  const rows = await getTransactionHistory(rpcUrl, from, 80);
  return rows.some((row) =>
    rowMatchesPayment(row, { from, to, minAtto, sinceSec, txHashes }),
  );
}

/** Feed sync: allow payment within 24h before content timestamp. */
export async function verifyInteractionPaymentForFeed({
  rpcUrl,
  from,
  to,
  minAttoCrc,
  createdAtMs,
}) {
  const sinceMs = Math.max(0, (createdAtMs || Date.now()) - 24 * 60 * 60 * 1000);
  return verifyCrcPayment({
    rpcUrl,
    from,
    to,
    minAtto: minAttoCrc,
    sinceMs,
  });
}
