/** Minimum unique votes before a flag can be ruled. */
export const MIN_MODERATION_VOTES = 5;

/** Days after a flag before ruling is allowed. */
export const MODERATION_DAYS = 7;

export const MODERATION_PERIOD_MS = MODERATION_DAYS * 24 * 60 * 60 * 1000;

/** @typedef {'none' | 'voting' | 'violated' | 'cleared'} ModerationStatus */
/** @typedef {'violation' | 'clear'} ModerationVerdict */

/**
 * @param {import('./storage.js').ShortRecord} short
 */
export function getActiveFlag(short) {
  const m = short.moderation;
  if (!m?.activeFlag) return null;
  if (m.status === 'violated' || m.status === 'cleared') return null;
  return m.activeFlag;
}

/**
 * @param {import('./storage.js').ShortRecord} short
 */
export function getModerationVotes(short) {
  const flag = getActiveFlag(short);
  if (!flag?.cid) return [];
  const votes = short.moderation?.votes || [];
  const flagCid = flag.cid;
  const seen = new Set();
  const out = [];
  for (const v of votes) {
    if (v.flagCid !== flagCid) continue;
    const key = (v.voter || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * @param {import('./storage.js').ShortRecord} short
 */
export function computeModerationTally(short) {
  const votes = getModerationVotes(short);
  let violation = 0;
  let clear = 0;
  for (const v of votes) {
    if (v.verdict === 'violation') violation++;
    else if (v.verdict === 'clear') clear++;
  }
  return { violation, clear, total: votes.length };
}

/**
 * @param {import('./storage.js').ShortRecord} short
 * @returns {{ status: ModerationStatus, canRule: boolean, msUntilRule: number, waitingPeriodComplete: boolean, votesNeeded: number, tally: ReturnType<typeof computeModerationTally>, activeFlag: object | null }}
 */
export function moderationSnapshot(short) {
  const m = short.moderation || {};
  const activeFlag = getActiveFlag(short);
  const tally = computeModerationTally(short);
  const now = Date.now();

  if (m.status === 'violated' || m.status === 'cleared') {
    return {
      status: m.status,
      canRule: false,
      msUntilRule: 0,
      tally: m.ruling || tally,
      activeFlag: null,
    };
  }

  if (!activeFlag) {
    return { status: 'none', canRule: false, msUntilRule: 0, tally, activeFlag: null };
  }

  const flagAge = now - (activeFlag.createdAt || 0);
  const waitingPeriodComplete = flagAge >= MODERATION_PERIOD_MS;
  const msUntilPeriodEnd = Math.max(0, MODERATION_PERIOD_MS - flagAge);
  const votesNeeded = Math.max(0, MIN_MODERATION_VOTES - tally.total);
  // Ruling only after 7 days AND MIN_MODERATION_VOTES; if day 7 passes with fewer votes, stay open until threshold.
  const canRule = waitingPeriodComplete && votesNeeded === 0;

  let status = /** @type {ModerationStatus} */ ('voting');
  if (canRule) {
    status = tally.violation > tally.clear ? 'violated' : 'cleared';
  }

  return {
    status,
    canRule,
    msUntilRule: msUntilPeriodEnd,
    waitingPeriodComplete,
    votesNeeded,
    tally,
    activeFlag,
  };
}

export function isShortViolated(short) {
  const snap = moderationSnapshot(short);
  if (snap.status === 'violated') return true;
  if (short.moderation?.status === 'violated') return true;
  return false;
}

export function isShortUnderReview(short) {
  return moderationSnapshot(short).status === 'voting';
}

/**
 * @param {string | null | undefined} address
 * @param {import('./storage.js').ShortRecord[]} shorts
 */
export function countFlaggerWins(address, shorts) {
  if (!address) return 0;
  const me = address.toLowerCase();
  let n = 0;
  for (const s of shorts) {
    if (s.moderation?.status !== 'violated') continue;
    const flagger = s.moderation?.resolvedFlagger || s.moderation?.activeFlag?.flagger;
    if (flagger?.toLowerCase() === me) n++;
  }
  return n;
}

/**
 * Removed shorts on a creator's record (🚩 strikes).
 * @param {string | null | undefined} address
 * @param {import('./storage.js').ShortRecord[]} shorts
 */
export function countCreatorViolations(address, shorts) {
  if (!address) return 0;
  const me = address.toLowerCase();
  let n = 0;
  for (const s of shorts) {
    if (s.moderation?.status !== 'violated') continue;
    if (s.creator?.toLowerCase() === me) n++;
  }
  return n;
}
