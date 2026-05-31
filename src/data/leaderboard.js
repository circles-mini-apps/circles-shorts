import { PUBLISH_BASE_CRC } from './reputation.js';
import { countFlaggerWins } from './moderation.js';

const INTERACT_CRC = 0.5;
const FLAG_CRC = 0.5;

/** @typedef {'total' | 'uploaded' | 'liked' | 'saved' | 'commented' | 'spentCrc' | 'earnedCrc' | 'removed'} LeaderboardSort */

function countFlagsByUser(address, shorts) {
  const me = address.toLowerCase();
  let n = 0;
  for (const s of shorts) {
    const m = s.moderation;
    if (!m) continue;
    const flagger = m.activeFlag?.flagger || m.resolvedFlagger;
    if (flagger?.toLowerCase() === me) n += 1;
  }
  return n;
}

function crcEarnedForUser(address, shorts) {
  const me = address.toLowerCase();
  let earned = 0;
  for (const s of shorts) {
    if (s.moderation?.status === 'violated') continue;
    if (s.creator?.toLowerCase() !== me) continue;
    for (const voter of s.voters || []) {
      if (voter?.toLowerCase() !== me) earned += INTERACT_CRC;
    }
    for (const c of s.comments || []) {
      if (c.by?.toLowerCase() !== me) earned += INTERACT_CRC;
    }
  }
  return earned;
}

function crcSpentForUser(address, row, shorts) {
  const flags = countFlagsByUser(address, shorts);
  return (
    row.uploaded * PUBLISH_BASE_CRC +
    row.liked * INTERACT_CRC +
    row.commented * INTERACT_CRC +
    flags * FLAG_CRC
  );
}

export function formatLeaderboardCrc(amount) {
  const n = Math.round(amount * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Aggregate per-user activity from the local shorts cache.
 * @param {ReturnType<import('./storage.js').listShorts>} shorts
 */
export function computeLeaderboard(shorts) {
  /** @type {Map<string, { uploaded: number, liked: number, saved: number, commented: number }>} */
  const stats = new Map();

  function touch(addr) {
    if (!addr || typeof addr !== 'string') return null;
    const key = addr.toLowerCase();
    if (!key.startsWith('0x')) return null;
    if (!stats.has(key)) {
      stats.set(key, { uploaded: 0, liked: 0, saved: 0, commented: 0 });
    }
    return key;
  }

  for (const s of shorts) {
    if (s.moderation?.status === 'violated') continue;

    const creator = touch(s.creator);

    if (creator) {
      stats.get(creator).uploaded += 1;
    }

    for (const voter of s.voters || []) {
      const key = touch(voter);
      if (!key) continue;
      if (creator && key === creator) continue;
      stats.get(key).liked += 1;
    }

    for (const saver of s.savers || []) {
      const key = touch(saver);
      if (key) stats.get(key).saved += 1;
    }

    for (const c of s.comments || []) {
      const key = touch(c.by);
      if (key) stats.get(key).commented += 1;
    }
  }

  for (const s of shorts) {
    for (const m of [s.moderation?.activeFlag?.flagger, s.moderation?.resolvedFlagger]) {
      touch(m);
    }
  }

  return Array.from(stats.entries())
    .map(([address, row]) => {
      const spentCrc = crcSpentForUser(address, row, shorts);
      const earnedCrc = crcEarnedForUser(address, shorts);
      const removed = countFlaggerWins(address, shorts);
      return {
        address,
        uploaded: row.uploaded,
        liked: row.liked,
        saved: row.saved,
        commented: row.commented,
        spentCrc,
        earnedCrc,
        removed,
        total: row.uploaded + row.liked + row.saved + row.commented,
      };
    })
    .filter(
      (row) => row.total > 0 || row.spentCrc > 0 || row.earnedCrc > 0 || row.removed > 0,
    );
}

/** @param {ReturnType<typeof computeLeaderboard>} rows @param {LeaderboardSort} sortKey */
export function sortLeaderboardRows(rows, sortKey = 'earnedCrc') {
  const key = sortKey || 'earnedCrc';
  return [...rows].sort((a, b) => {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    return (
      bv - av ||
      b.total - a.total ||
      b.uploaded - a.uploaded ||
      a.address.localeCompare(b.address)
    );
  });
}
