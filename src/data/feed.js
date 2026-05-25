/**
 * Cross-user feed loader.
 *
 * Source of truth: Pinata pinList for discovery, IPFS gateways for content.
 * Local storage is used as the canonical cache the UI renders from; this module
 * upserts every remote item into local storage so the UI updates in place.
 *
 * Each on-chain CRC transfer also carries the CID (Circles V2 transferData 0x0003),
 * so anyone can verify a pinned object matches a paid action on Gnosis Chain.
 */

import {
  fetchJsonByCid,
  isPinningEnabled,
  listPinnedCids,
} from './ipfs.js';
import {
  upsertRemoteComment,
  upsertRemoteShort,
  upsertRemoteUpvote,
  upsertRemoteFlag,
  upsertRemoteModVote,
  upsertRemoteRuling,
  reconcileAllModeration,
} from './storage.js';

const MAX_CONCURRENT_FETCHES = 6;

/** Run an async map with a bounded concurrency. */
async function pMap(items, fn, concurrency = MAX_CONCURRENT_FETCHES) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { __error: err };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function isShortContent(obj) {
  return obj && obj.kind === 'circles-shorts:short' && typeof obj.title === 'string' && typeof obj.url === 'string';
}

function isCommentContent(obj) {
  return obj && obj.kind === 'circles-shorts:comment' && typeof obj.text === 'string';
}

function isUpvoteContent(obj) {
  return obj && obj.kind === 'circles-shorts:upvote' && typeof obj.voter === 'string';
}

function isFlagContent(obj) {
  return obj && obj.kind === 'circles-shorts:flag' && typeof obj.flagger === 'string';
}

function isModVoteContent(obj) {
  return obj && obj.kind === 'circles-shorts:moderation-vote' && typeof obj.voter === 'string';
}

function isRulingContent(obj) {
  return obj && obj.kind === 'circles-shorts:moderation-ruling' && typeof obj.outcome === 'string';
}

/**
 * Load every short, comment, and upvote that has been pinned through this app
 * and merge them into local storage. Returns counts for diagnostics.
 *
 * Safe to call repeatedly: dedup by CID/voter.
 */
export async function refreshFeedFromRemote() {
  if (!isPinningEnabled()) {
    return { shorts: 0, comments: 0, upvotes: 0, flags: 0, modVotes: 0, rulings: 0, skipped: 'no-pinata' };
  }

  // 1. Discover all shorts.
  const shortPins = await listPinnedCids({ keyvalues: { kind: 'short' } });
  const shortRecords = await pMap(shortPins, async (pin) => {
    const data = await fetchJsonByCid(pin.cid);
    return { pin, data };
  });
  let shortsAdded = 0;
  for (const r of shortRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    if (!isShortContent(data)) continue;
    upsertRemoteShort({
      cid: pin.cid,
      title: data.title,
      url: data.url,
      categories: Array.isArray(data.categories) ? data.categories : [],
      creator: data.creator,
      createdAt: data.createdAt,
    });
    shortsAdded++;
  }

  // 2. Discover comments, upvotes, flags, moderation votes, rulings.
  const [commentPins, upvotePins, flagPins, modVotePins, rulingPins] = await Promise.all([
    listPinnedCids({ keyvalues: { kind: 'comment' } }),
    listPinnedCids({ keyvalues: { kind: 'upvote' } }),
    listPinnedCids({ keyvalues: { kind: 'flag' } }),
    listPinnedCids({ keyvalues: { kind: 'mod-vote' } }),
    listPinnedCids({ keyvalues: { kind: 'ruling' } }),
  ]);

  const commentRecords = await pMap(commentPins, async (pin) => {
    const data = await fetchJsonByCid(pin.cid);
    return { pin, data };
  });
  let commentsAdded = 0;
  for (const r of commentRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    if (!isCommentContent(data)) continue;
    const shortCid = data.shortCid || pin.keyvalues?.shortCid;
    if (!shortCid) continue;
    const out = upsertRemoteComment({
      shortCid,
      commentCid: pin.cid,
      by: data.author,
      text: data.text,
      createdAt: data.createdAt,
    });
    if (out) commentsAdded++;
  }

  let upvotesAdded = 0;
  for (const pin of upvotePins) {
    const shortCid = pin.keyvalues?.shortCid;
    const voter = pin.keyvalues?.voter;
    if (!shortCid || !voter) continue;
    const out = upsertRemoteUpvote({ shortCid, voter });
    if (out) upvotesAdded++;
  }

  const flagRecords = await pMap(flagPins, async (pin) => {
    const data = await fetchJsonByCid(pin.cid);
    return { pin, data };
  });
  let flagsAdded = 0;
  for (const r of flagRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    if (!isFlagContent(data)) continue;
    const shortCid = data.shortCid || pin.keyvalues?.shortCid;
    if (!shortCid) continue;
    const out = upsertRemoteFlag({
      shortCid,
      flagCid: pin.cid,
      flagger: data.flagger,
      category: data.category,
      explanation: data.explanation,
      reason: data.reason,
      createdAt: data.createdAt,
    });
    if (out) flagsAdded++;
  }

  const modVoteRecords = await pMap(modVotePins, async (pin) => {
    const data = await fetchJsonByCid(pin.cid);
    return { pin, data };
  });
  let modVotesAdded = 0;
  for (const r of modVoteRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    if (!isModVoteContent(data)) continue;
    const shortCid = data.shortCid || pin.keyvalues?.shortCid;
    const flagCid = data.flagCid || pin.keyvalues?.flagCid;
    if (!shortCid || !flagCid) continue;
    const out = upsertRemoteModVote({
      shortCid,
      voteCid: pin.cid,
      flagCid,
      voter: data.voter,
      verdict: data.verdict,
      createdAt: data.createdAt,
    });
    if (out) modVotesAdded++;
  }

  const rulingRecords = await pMap(rulingPins, async (pin) => {
    const data = await fetchJsonByCid(pin.cid);
    return { pin, data };
  });
  let rulingsAdded = 0;
  for (const r of rulingRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    if (!isRulingContent(data)) continue;
    const shortCid = data.shortCid || pin.keyvalues?.shortCid;
    if (!shortCid) continue;
    const out = upsertRemoteRuling({
      shortCid,
      rulingCid: pin.cid,
      outcome: data.outcome,
      flagger: data.flagger,
      ruling: data.ruling,
      ruledAt: data.ruledAt,
    });
    if (out) rulingsAdded++;
  }

  reconcileAllModeration();

  return {
    shorts: shortsAdded,
    comments: commentsAdded,
    upvotes: upvotesAdded,
    flags: flagsAdded,
    modVotes: modVotesAdded,
    rulings: rulingsAdded,
  };
}
