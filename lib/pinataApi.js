import { APP_NAMESPACE, LEGACY_APP_NAMESPACE } from '../src/app/config.js';

export { APP_NAMESPACE, LEGACY_APP_NAMESPACE };

export function pinataJwt(env) {
  return env?.PINATA_JWT || env?.VITE_PINATA_JWT || '';
}

export async function pinJsonToPinata(jwt, content, { name, keyvalues = {}, appNamespace = APP_NAMESPACE }) {
  if (!jwt) throw new Error('PINATA_JWT not configured');
  const taggedKeyvalues = { app: appNamespace, ...keyvalues };
  const safeKeyvalues = Object.fromEntries(
    Object.entries(taggedKeyvalues)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : String(v)]),
  );
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pinataContent: content,
      pinataMetadata: { name, keyvalues: safeKeyvalues },
      pinataOptions: { cidVersion: 0 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Pinata pin failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const cid = json?.IpfsHash;
  if (!cid) throw new Error('Pinata returned no CID');
  return cid;
}

export async function unpinFromPinata(jwt, cid) {
  if (!jwt) throw new Error('PINATA_JWT not configured');
  const res = await fetch(`https://api.pinata.cloud/pinning/unpin/${encodeURIComponent(cid)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Pinata unpin failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

export async function listPinsFromPinata(jwt, { keyvalues = {}, limit = 1000, appNamespace = APP_NAMESPACE } = {}) {
  if (!jwt) throw new Error('PINATA_JWT not configured');
  const tagged = { app: appNamespace, ...keyvalues };
  const qvParts = Object.entries(tagged).map(
    ([k, v]) => `metadata[keyvalues][${k}]=${encodeURIComponent(JSON.stringify({ value: String(v), op: 'eq' }))}`,
  );
  const url = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=${limit}&includesCount=false&${qvParts.join('&')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Pinata pinList failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const rows = Array.isArray(json?.rows) ? json.rows : [];
  return rows.map((r) => ({
    cid: r.ipfs_pin_hash,
    name: r.metadata?.name || '',
    keyvalues: r.metadata?.keyvalues || {},
    pinnedAt: r.date_pinned || null,
  }));
}

export async function fetchJsonFromGateways(cid, gateways) {
  const list = gateways?.length
    ? gateways
    : ['https://w3s.link', 'https://gateway.pinata.cloud', 'https://ipfs.io'];
  for (const gw of list) {
    try {
      const res = await fetch(`${gw.replace(/\/$/, '')}/ipfs/${cid}`);
      if (!res.ok) continue;
      return await res.json();
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not fetch CID from gateways');
}
