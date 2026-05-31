import { getAddress, isAddress } from 'viem';
import { contentKind } from './config.js';
import {
  addShort,
  addFlag,
  addModerationVote,
  commentShort,
  deleteCommentFromShort,
  finalizeModerationIfReady,
  getShort,
  hasUpvoted,
  isSavedBy,
  removeShort,
  revokeComment,
  revokeFlag,
  revokeModVote,
  revokeSaveForShort,
  revokeShort,
  revokeUpvoteForShort,
  saveShort,
  setModerationRulingCid,
  clearSaveRevoked,
  clearUpvoteRevoked,
  unsaveShort,
  unupvoteShort,
  updateShort,
  upvoteShort,
  withdrawFlagFromShort,
} from '../data/storage.js';
import { crcToAtto, isDemoMode, sendCrc } from '../chain/circlesTransfer.js';
import { PLATFORM_ORG } from '../chain/platformOrg.js';
import { isPinningEnabled, pinJson, unpinCid, unpinMatchingPins } from '../data/ipfs.js';
import { refreshFeedFromRemote } from '../data/feed.js';
import { resolveProfileDisplayName } from '../data/profiles.js';
import { resolveVideoDuration } from '../data/videoDuration.js';
import { MIN_MODERATION_VOTES, isShortUnderReview } from '../data/moderation.js';
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
  setProfileTab,
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
  const recipient = await resolveProfileDisplayName(toAddr);
  if (isDemoMode()) {
    const message = `Demo mode: skipping ${amountCrc} CRC ${label} to ${recipient}…`;
    setStatus('pending', message, { highlight: recipient });
    return [];
  }
  const from = requireConnected();
  const atto = crcToAtto(amountCrc);
  const message = `Paying ${recipient} ${amountCrc} CRC ${label}…`;
  setStatus('pending', message, { highlight: recipient });
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

/** Unpin from Pinata so feed sync stops discovering the interaction globally. */
async function unpinIfEnabled(task, message = 'Removing from IPFS…') {
  if (!isPinningEnabled()) return [];
  setStatus('pending', message);
  return task();
}

async function unpinUpvoteFromIpfs(short, voter) {
  if (!short?.cid) return [];
  return unpinIfEnabled(() =>
    unpinMatchingPins({
      keyvalues: {
        kind: 'upvote',
        shortCid: short.cid,
        voter: voter.toLowerCase(),
      },
    }),
  );
}

async function unpinSaveFromIpfs(short, saver) {
  if (!short?.cid) return [];
  return unpinIfEnabled(() =>
    unpinMatchingPins({
      keyvalues: {
        kind: 'save',
        shortCid: short.cid,
        saver: saver.toLowerCase(),
      },
    }),
  );
}

async function unpinCommentFromIpfs(short, comment) {
  if (!short?.cid || !comment?.cid) return [];
  return unpinIfEnabled(async () => {
    await unpinCid(comment.cid);
    return [comment.cid];
  });
}

async function unpinShortFromIpfs(short, { message } = {}) {
  if (!short?.cid) return [];
  return unpinIfEnabled(async () => {
    await unpinCid(short.cid);
    return [short.cid];
  }, message);
}

function requireOwnShort(short, address) {
  if (!short) throw new Error('Short not found');
  if (short.creator?.toLowerCase() !== address.toLowerCase()) {
    throw new Error('You can only edit or delete your own uploads');
  }
  return short;
}

function normalizeCategories(categories) {
  return [...(categories || [])]
    .map((c) => String(c).trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

function uploadFieldsUnchanged(existing, { title, url, categories }) {
  return (
    existing.title === title &&
    existing.url === url &&
    normalizeCategories(existing.categories).join('\0') === normalizeCategories(categories).join('\0')
  );
}

async function maybePublishRuling(shortId) {
  const short = finalizeModerationIfReady(shortId);
  if (!short?.cid) return;
  const m = short.moderation;
  if (!m || (m.status !== 'violated' && m.status !== 'cleared')) return;
  if (m.rulingCid) return;

  const payload = {
    kind: contentKind('moderation-ruling'),
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
      kind: contentKind('short'),
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

export async function updateUpload(shortId, { title, url, categories }) {
  try {
    const from = requireConnected();
    const existing = requireOwnShort(getShort(shortId), from);
    const cleanTitle = validateTitle(title);
    const cleanUrl = validateVideoUrl(url);
    const cleanCategories = validateCategories(categories);

    if (uploadFieldsUnchanged(existing, { title: cleanTitle, url: cleanUrl, categories: cleanCategories })) {
      return existing;
    }

    let durationSeconds = existing.durationSeconds ?? null;
    if (cleanUrl !== existing.url) {
      durationSeconds = null;
      try {
        durationSeconds = await resolveVideoDuration(cleanUrl);
      } catch {
        /* optional metadata */
      }
    }

    const payload = {
      kind: contentKind('short'),
      v: 1,
      title: cleanTitle,
      url: cleanUrl,
      categories: cleanCategories,
      creator: from,
      createdAt: existing.createdAt,
      shortId: existing.id,
      editedAt: Date.now(),
      ...(durationSeconds ? { durationSeconds } : {}),
    };
    const pinOpts = {
      name: `short:${cleanTitle}`,
      keyvalues: { kind: 'short', creator: from.toLowerCase() },
    };

    const oldCid = existing.cid;
    let newCid = oldCid;
    if (isPinningEnabled()) {
      const pinnedCid = await pinIfEnabled(payload, pinOpts);
      if (pinnedCid) {
        newCid = pinnedCid;
        if (oldCid && oldCid !== newCid) {
          try {
            await unpinShortFromIpfs({ cid: oldCid }, { message: 'Removing old IPFS pin…' });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('IPFS unpin failed after edit', err);
          }
        }
      }
    }

    updateShort(shortId, {
      title: cleanTitle,
      url: cleanUrl,
      categories: cleanCategories,
      durationSeconds,
      cid: newCid,
      editedAt: Date.now(),
    });
    refreshShorts();
    state.editingShortId = null;
    const wasFlagged = isShortUnderReview(existing);
    setStatus(
      'success',
      wasFlagged
        ? `Updated "${cleanTitle}". The flagger can review and withdraw their flag if the issue is fixed.`
        : `Updated "${cleanTitle}".`,
    );
    setView('detail', shortId);
    return getShort(shortId);
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function deleteUpload(shortId) {
  try {
    const from = requireConnected();
    const short = requireOwnShort(getShort(shortId), from);
    try {
      await unpinShortFromIpfs(short);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('IPFS unpin failed', err);
      setStatus('pending', 'Removed locally; IPFS unpin failed — may still show for others.');
    }
    revokeShort(short);
    removeShort(shortId);
    refreshShorts();
    state.editingShortId = null;
    setStatus('success', 'Short deleted.');
    setProfileTab('published');
    setView('profile', null, { profileAddress: from });
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

async function unpinFlagFromIpfs(flagCid) {
  if (!flagCid || flagCid.startsWith('local-')) return [];
  return unpinIfEnabled(async () => {
    await unpinCid(flagCid);
    return [flagCid];
  });
}

export async function withdrawFlag(shortId) {
  try {
    const flagger = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    const { flagCid, voteCids } = withdrawFlagFromShort(shortId, flagger);
    try {
      await unpinFlagFromIpfs(flagCid);
      for (const voteCid of voteCids) {
        if (!voteCid || voteCid.startsWith('local-')) continue;
        try {
          await unpinIfEnabled(async () => {
            await unpinCid(voteCid);
            return [voteCid];
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('IPFS unpin failed for mod vote', err);
        }
        revokeModVote(voteCid);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('IPFS unpin failed for flag', err);
      setStatus('pending', 'Flag withdrawn locally; IPFS unpin failed — may still show for others.');
    }
    if (flagCid) revokeFlag(flagCid);
    refreshShorts();
    setStatus('success', 'Flag withdrawn. This short is no longer under review.');
    return getShort(shortId);
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
    if (hasUpvoted(short, voter)) {
      throw new Error('Already upvoted');
    }

    // Pay before pinning — otherwise a cancelled payment still leaves a discoverable IPFS upvote.
    await payCrc(getAddress(short.creator), PRICE_INTERACT_CRC, 'to upvote', {
      cid: short.cid || null,
    });

    const upvotePayload = {
      kind: contentKind('upvote'),
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
    clearUpvoteRevoked(getShort(shortId), voter);
    refreshShorts();
    setStatus('success', 'Upvoted.');
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function unupvote(shortId) {
  try {
    const voter = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    if (!hasUpvoted(short, voter)) {
      throw new Error('Not upvoted');
    }
    try {
      await unpinUpvoteFromIpfs(short, voter);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('IPFS unpin failed', err);
      setStatus('pending', 'Removed locally; IPFS unpin failed — may still show for others.');
    }
    unupvoteShort(shortId, voter);
    revokeUpvoteForShort(short, voter);
    refreshShorts();
    setStatus('success', 'Upvote removed.');
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function save(shortId) {
  try {
    const saver = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    if (isSavedBy(short, saver)) {
      setStatus('success', 'Already saved.');
      return;
    }

    saveShort(shortId, saver);
    clearSaveRevoked(getShort(shortId), saver);

    const savePayload = {
      kind: contentKind('save'),
      v: 1,
      shortCid: short.cid || null,
      saver,
      createdAt: Date.now(),
    };
    if (short.cid) {
      await pinIfEnabled(savePayload, {
        name: `save:${short.cid}`,
        keyvalues: { kind: 'save', shortCid: short.cid, saver: saver.toLowerCase() },
      });
    }

    refreshShorts();
    setStatus('success', 'Saved.');
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function unsave(shortId) {
  try {
    const saver = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    if (!isSavedBy(short, saver)) {
      throw new Error('Not saved');
    }
    try {
      await unpinSaveFromIpfs(short, saver);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('IPFS unpin failed', err);
      setStatus('pending', 'Removed locally; IPFS unpin failed — may still show for others.');
    }
    unsaveShort(shortId, saver);
    revokeSaveForShort(short, saver);
    refreshShorts();
    setStatus('success', 'Removed from saved.');
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
      kind: contentKind('comment'),
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
    setStatus('success', 'Comment posted.');
  } catch (err) {
    setStatus('error', normalizeError(err));
    throw err;
  }
}

export async function deleteComment(shortId, commentId) {
  try {
    const author = requireConnected();
    const short = getShort(shortId);
    if (!short) throw new Error('Short not found');
    const comment = (short.comments || []).find((c) => c.id === commentId);
    if (!comment) throw new Error('Comment not found');
    if (comment.by?.toLowerCase() !== author.toLowerCase()) {
      throw new Error('You can only delete your own comments');
    }
    try {
      await unpinCommentFromIpfs(short, comment);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('IPFS unpin failed', err);
      setStatus('pending', 'Removed locally; IPFS unpin failed — may still show for others.');
    }
    deleteCommentFromShort(shortId, commentId);
    revokeComment(comment);
    refreshShorts();
    setStatus('success', 'Comment deleted.');
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
      kind: contentKind('flag'),
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
      kind: contentKind('moderation-vote'),
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
