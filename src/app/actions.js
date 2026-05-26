import { getAddress, isAddress } from 'viem';
import {
  addShort,
  addFlag,
  addModerationVote,
  commentShort,
  finalizeModerationIfReady,
  getShort,
  setModerationRulingCid,
  upvoteShort,
} from '../data/storage.js';
import { crcToAtto, isDemoMode, sendCrc } from '../chain/circlesTransfer.js';
import { PLATFORM_ORG } from '../chain/platformOrg.js';
import { isPinningEnabled, pinJson } from '../data/ipfs.js';
import { refreshFeedFromRemote } from '../data/feed.js';
import { resolveVideoDuration } from '../data/videoDuration.js';
import { MIN_MODERATION_VOTES } from '../data/moderation.js';
import {
  computePublishPrice,
  formatPublishPriceLabel,
} from '../data/reputation.js';
import { normalizeError } from '../utils/format.js';
import {
  validateCategories,
  validateCommentText,
  validateFlagSubmission,
  validateTitle,
  validateVideoUrl,
} from '../utils/validation.js';
import {
  markFeedSynced,
  refreshShorts,
  resetAccountScopedState,
  setConnectedAddress,
  setFeedError,
  setFeedLoading,
  setStatus,
  setView,
  setWalletPhase,
  state,
} from './state.js';

export { PLATFORM_ORG, PLATFORM_ORG as PLATFORM_CREATOR } from '../chain/platformOrg.js';

export const PRICE_PUBLISH_CRC = '1';
export const PRICE_INTERACT_CRC = '0.5';
export const PRICE_FLAG_CRC = '0.5';

function assertNotViolated(short) {
  if (short.moderation?.status === 'violated') {
    throw new Error('This short was removed for a policy violation');
  }
}

export function handleWalletChange(rawAddress) {
  let address = null;
  try {
    address = rawAddress ? getAddress(rawAddress) : null;
  } catch {
    address = null;
  }

  resetAccountScopedState();

  if (!address) {
    setConnectedAddress(null);
    setWalletPhase('disconnected');
    return;
  }

  setConnectedAddress(address);
  setWalletPhase('connecting');
  refreshShorts();
  void syncFeed({ silent: true });
  setWalletPhase('connected');
}

function requireConnected() {
  const addr = state.connectedAddress;
  if (!addr || !isAddress(addr)) {
    throw new Error('Connect a wallet (open inside the Circles host)');
  }
  return addr;
}

let refreshInFlight = null;
let lastBackgroundRefresh = 0;

/**
 * Refresh the cross-user feed from Pinata + IPFS gateways.
 * Coalesces concurrent callers and re-renders the UI on completion.
 */
export async function syncFeed({ silent = false } = {}) {
  if (refreshInFlight) return refreshInFlight;
  if (!silent) setFeedLoading(true);
  refreshInFlight = (async () => {
    try {
      await refreshFeedFromRemote();
      refreshShorts();
      await publishPendingRulings();
      markFeedSynced();
    } catch (err) {
      setFeedError(normalizeError(err));
    } finally {
      if (!silent) setFeedLoading(false);
      lastBackgroundRefresh = Date.now();
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Kick off a background refresh only if enough time has passed since the last one. */
export function maybeBackgroundSync(minIntervalMs = 30_000) {
  if (Date.now() - lastBackgroundRefresh < minIntervalMs) return;
  void syncFeed({ silent: true });
}

async function payCrc(toAddr, amountCrc, label, { cid } = {}) {
  if (isDemoMode()) {
    setStatus('pending', `Demo mode: skipping ${amountCrc} CRC ${label}…`);
    return [];
  }
  const from = requireConnected();
  const atto = crcToAtto(amountCrc);
  setStatus('pending', `Paying ${amountCrc} CRC ${label}…`);
  return sendCrc(from, toAddr, atto, { cid });
}

/** Pin after payment succeeds — never pin discoverable content before payCrc resolves. */
async function pinIfEnabled(payload, { name, keyvalues = {} }) {
  if (!isPinningEnabled()) return null;
  try {
    setStatus('pending', 'Pinning to IPFS…');
    return await pinJson(payload, { name, keyvalues });
  } catch (err) {
    // Pinning failure shouldn't block the on-chain action — surface a warning instead.
    // eslint-disable-next-line no-console
    console.warn('IPFS pinning failed', err);
    return null;
  }
}

async function maybePublishRuling(shortId) {
  const short = finalizeModerationIfReady(shortId);
  if (!short?.cid) return;
  const m = short.moderation;
  if (!m || (m.status !== 'violated' && m.status !== 'cleared')) return;
  if (m.rulingCid) return;

  const payload = {
    kind: 'circles-shorts:moderation-ruling',
    v: 1,
    shortCid: short.cid,
    flagCid: m.activeFlag?.cid || null,
    outcome: m.status === 'violated' ? 'violation' : 'clear',
    flagger: m.resolvedFlagger || m.activeFlag?.flagger || null,
    ruling: m.ruling,
    ruledAt: m.ruledAt || Date.now(),
  };
  const rulingCid = await pinIfEnabled(payload, {
    name: `ruling:${short.cid}`,
    keyvalues: { kind: 'ruling', shortCid: short.cid },
  });
  if (rulingCid) {
    setModerationRulingCid(shortId, rulingCid);
  }
}

/** Finalize and pin rulings for shorts that crossed the vote threshold. */
export async function publishPendingRulings() {
  refreshShorts();
  for (const s of state.shorts) {
    await maybePublishRuling(s.id);
  }
  refreshShorts();
}

export function getPublishPriceFor(address) {
  return computePublishPrice(address, state.shorts);
}

export async function publishShort({ title, url, categories }) {
  try {
    const from = requireConnected();
    const { priceCrc, isFree } = getPublishPriceFor(from);
    const cleanTitle = validateTitle(title);
    const cleanUrl = validateVideoUrl(url);
    const cleanCategories = validateCategories(categories);

    let durationSeconds = null;
    try {
      durationSeconds = await resolveVideoDuration(cleanUrl);
    } catch {
      /* optional metadata */
    }

    const payload = {
      kind: 'circles-shorts:short',
      v: 1,
      title: cleanTitle,
      url: cleanUrl,
      categories: cleanCategories,
      creator: from,
      createdAt: Date.now(),
      ...(durationSeconds ? { durationSeconds } : {}),
    };
    const pinOpts = {
      name: `short:${cleanTitle}`,
      keyvalues: { kind: 'short', creator: from.toLowerCase() },
    };

    let cid = null;
    if (isFree) {
      if (isDemoMode()) {
        setStatus('pending', 'Demo mode: publishing for free…');
      }
      cid = await pinIfEnabled(payload, pinOpts);
    } else {
      // Pay before pinning — otherwise a cancelled payment still leaves a discoverable IPFS short.
      await payCrc(PLATFORM_ORG, priceCrc, 'to publish', { cid: null });
      cid = await pinIfEnabled(payload, pinOpts);
    }

    const short = addShort({
      title: cleanTitle,
      url: cleanUrl,
      categories: cleanCategories,
      creator: from,
      cid,
      durationSeconds,
    });
    refreshShorts();
    const paidLabel = isFree ? 'for free' : `(${formatPublishPriceLabel(getPublishPriceFor(from))})`;
    setStatus('success', cid ? `Published "${cleanTitle}" ${paidLabel} · CID ${cid.slice(0, 8)}…` : `Published "${cleanTitle}" ${paidLabel}.`);
    setView('detail', short.id);
    return short;
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function upvote(shortId) {
  try {
    const voter = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    assertNotViolated(short);
    if (short.creator.toLowerCase() === voter.toLowerCase()) {
      throw new Error('You cannot upvote your own short');
    }

    // Pay before pinning — otherwise a cancelled payment still leaves a discoverable IPFS upvote.
    await payCrc(getAddress(short.creator), PRICE_INTERACT_CRC, 'to upvote', {
      cid: short.cid || null,
    });

    const upvotePayload = {
      kind: 'circles-shorts:upvote',
      v: 1,
      shortCid: short.cid || null,
      voter,
      createdAt: Date.now(),
    };
    if (short.cid) {
      await pinIfEnabled(upvotePayload, {
        name: `upvote:${short.cid}`,
        keyvalues: { kind: 'upvote', shortCid: short.cid, voter: voter.toLowerCase() },
      });
    }

    upvoteShort(shortId, voter);
    refreshShorts();
    setStatus('success', 'Upvoted.');
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function comment(shortId, text) {
  try {
    const author = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    assertNotViolated(short);
    if (short.creator.toLowerCase() === author.toLowerCase()) {
      throw new Error('You cannot comment on your own short');
    }
    const cleanText = validateCommentText(text);

    await payCrc(getAddress(short.creator), PRICE_INTERACT_CRC, 'to comment', {
      cid: short.cid || null,
    });

    const payload = {
      kind: 'circles-shorts:comment',
      v: 1,
      shortCid: short.cid || null,
      shortId: short.id,
      author,
      text: cleanText,
      createdAt: Date.now(),
    };
    const cid = short.cid
      ? await pinIfEnabled(payload, {
          name: `comment:${short.cid}`,
          keyvalues: { kind: 'comment', shortCid: short.cid, author: author.toLowerCase() },
        })
      : null;

    commentShort(shortId, { by: author, text: cleanText, cid });
    refreshShorts();
    setStatus('success', 'Comment posted (+1 upvote).');
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function flagShort(shortId, { category, explanation }) {
  try {
    const flagger = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    assertNotViolated(short);
    const flagData = validateFlagSubmission({ category, explanation });
    if (!short.cid) throw new Error('Short must be pinned to IPFS before it can be flagged');

    const flagPayload = {
      kind: 'circles-shorts:flag',
      v: 1,
      shortCid: short.cid,
      shortId: short.id,
      flagger,
      category: flagData.category,
      explanation: flagData.explanation,
      reason: flagData.reason,
      createdAt: Date.now(),
    };

    // Pay before pinning — otherwise a cancelled payment still leaves a discoverable IPFS flag.
    await payCrc(PLATFORM_ORG, PRICE_FLAG_CRC, 'to flag', { cid: short.cid });
    const flagCid = await pinIfEnabled(flagPayload, {
      name: `flag:${short.cid}`,
      keyvalues: { kind: 'flag', shortCid: short.cid, flagger: flagger.toLowerCase() },
    });

    addFlag(shortId, {
      flagger,
      category: flagData.category,
      explanation: flagData.explanation,
      reason: flagData.reason,
      cid: flagCid || `local-${Date.now()}`,
    });
    refreshShorts();
    setStatus('success', `Flag submitted. Voting opens for at least 7 days and until ${MIN_MODERATION_VOTES} votes are cast.`);
    return getShort(shortId);
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function voteModeration(shortId, verdict) {
  try {
    const voter = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    assertNotViolated(short);
    const flag = short.moderation?.activeFlag;
    if (!flag?.cid) throw new Error('No active flag on this short');
    if (short.moderation?.status !== 'voting') {
      throw new Error('This flag is no longer open for voting');
    }
    if (verdict !== 'violation' && verdict !== 'clear') {
      throw new Error('Invalid vote');
    }
    if (!short.cid) throw new Error('Short is missing IPFS reference');

    const votePayload = {
      kind: 'circles-shorts:moderation-vote',
      v: 1,
      shortCid: short.cid,
      flagCid: flag.cid,
      voter,
      verdict,
      createdAt: Date.now(),
    };
    const voteCid = await pinIfEnabled(votePayload, {
      name: `mod-vote:${flag.cid}`,
      keyvalues: {
        kind: 'mod-vote',
        shortCid: short.cid,
        flagCid: flag.cid,
        voter: voter.toLowerCase(),
      },
    });

    addModerationVote(shortId, {
      voter,
      verdict,
      flagCid: flag.cid,
      cid: voteCid || `local-${Date.now()}`,
    });
    await maybePublishRuling(shortId);
    refreshShorts();
    const updated = getShort(shortId);
    if (updated?.moderation?.status === 'violated') {
      setStatus('success', 'Vote recorded. Ruling: removed for violation.');
    } else if (updated?.moderation?.status === 'cleared') {
      setStatus('success', 'Vote recorded. Ruling: no violation.');
    } else {
      setStatus('success', 'Vote recorded.');
    }
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}
