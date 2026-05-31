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
  listAllAppPins,
} from './ipfs.js';
import { isContentKind } from '../app/config.js';
import {
  upsertRemoteComment,
  upsertRemoteShort,
  upsertRemoteUpvote,
  resetAllUpvoteCounts,
  resetAllSaveCounts,
  upsertRemoteSave,
  upsertRemoteFlag,
  upsertRemoteModVote,
  upsertRemoteRuling,
  reconcileAllModeration,
  isShortRevoked,
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
  return isContentKind(obj, 'short') && typeof obj.title === 'string' && typeof obj.url === 'string';
}

function isCommentContent(obj) {
  return isContentKind(obj, 'comment') && typeof obj.text === 'string';
}

function isUpvoteContent(obj) {
  return isContentKind(obj, 'upvote') && typeof obj.voter === 'string';
}

function isSaveContent(obj) {
  return isContentKind(obj, 'save') && typeof obj.saver === 'string';
}

function isFlagContent(obj) {
  return isContentKind(obj, 'flag') && typeof obj.flagger === 'string';
}

function isModVoteContent(obj) {
  return isContentKind(obj, 'moderation-vote') && typeof obj.voter === 'string';
}

function isRulingContent(obj) {
  return isContentKind(obj, 'moderation-ruling') && typeof obj.outcome === 'string';
}

/**
 * Load every short, comment, and upvote that has been pinned through this app
 * and merge them into local storage. Returns counts for diagnostics.
 *
 * Safe to call repeatedly: dedup by CID/voter.
 */
export async function refreshFeedFromRemote() {
  if (!isPinningEnabled()) {
    return { shorts: 0, comments: 0, upvotes: 0, saves: 0, flags: 0, modVotes: 0, rulings: 0, skipped: 'no-pinata' };
  }

  // One pinList round-trip per namespace (current + legacy), filter kinds locally.
  const allPins = await listAllAppPins();
  const pinsByKind = (kind) => allPins.filter((p) => p.keyvalues?.kind === kind);

  const shortPins = pinsByKind('short');
  const shortRecords = await pMap(shortPins, async (pin) => {
    const data = await fetchJsonByCid(pin.cid);
    return { pin, data };
  });
  let shortsAdded = 0;
  for (const r of shortRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    if (isShortRevoked(pin.cid)) continue;
    if (!isShortContent(data)) continue;
    upsertRemoteShort({
      cid: pin.cid,
      title: data.title,
      url: data.url,
      categories: Array.isArray(data.categories) ? data.categories : [],
      creator: data.creator,
      createdAt: data.createdAt,
      durationSeconds: data.durationSeconds,
      shortId: data.shortId,
      editedAt: data.editedAt,
    });
    shortsAdded++;
  }

  const commentPins = pinsByKind('comment');
  const upvotePins = pinsByKind('upvote');
  const savePins = pinsByKind('save');
  const flagPins = pinsByKind('flag');
  const modVotePins = pinsByKind('mod-vote');
  const rulingPins = pinsByKind('ruling');

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
  resetAllUpvoteCounts();
  for (const pin of upvotePins) {
    const shortCid = pin.keyvalues?.shortCid;
    const voter = pin.keyvalues?.voter;
    if (!shortCid || !voter) continue;
    const out = upsertRemoteUpvote({ shortCid, voter });
    if (out) upvotesAdded++;
  }

  let savesAdded = 0;
  resetAllSaveCounts();
  for (const pin of savePins) {
    const shortCid = pin.keyvalues?.shortCid;
    const saver = pin.keyvalues?.saver;
    if (!shortCid || !saver) continue;
    const out = upsertRemoteSave({ shortCid, saver });
    if (out) savesAdded++;
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
      shortId: data.shortId || pin.keyvalues?.shortId,
      flagCid: pin.cid,
      flagger: data.flagger || pin.keyvalues?.flagger,
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
    saves: savesAdded,
    flags: flagsAdded,
    modVotes: modVotesAdded,
    rulings: rulingsAdded,
  };
}
