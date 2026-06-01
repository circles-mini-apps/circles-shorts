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
import { crcDecimalToAtto, verifyCrcPayment, verifyInteractionPaymentForFeed } from '../../lib/ipfsTransferVerify.js';
import { isDemoMode } from '../chain/circlesTransfer.js';
import { PLATFORM_ORG } from '../chain/platformOrg.js';
import { state } from '../app/state.js';
import { recordCidAlias } from './cidAliases.js';
import {
  getShort,
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
  reconcilePendingUpvotes,
  reconcilePendingSaves,
  isShortRevoked,
} from './storage.js';

const MAX_CONCURRENT_FETCHES = 6;
const INTERACT_ATTO = crcDecimalToAtto('0.5');
const FLAG_ATTO = crcDecimalToAtto('0.5');

function resolveFeedRpcUrl() {
  return (
    state?.hostContext?.circlesRpcUrl ||
    import.meta.env.VITE_CIRCLES_RPC_URL ||
    'https://rpc.aboutcircles.com/'
  );
}

function shouldVerifyPayments() {
  return !isDemoMode();
}

async function verifyInteractPayment(from, to, createdAtMs) {
  if (!shouldVerifyPayments()) return true;
  if (!from || !to) return false;
  return verifyInteractionPaymentForFeed({
    rpcUrl: resolveFeedRpcUrl(),
    from,
    to,
    minAttoCrc: INTERACT_ATTO,
    createdAtMs,
  });
}

async function verifyFlagPayment(from, createdAtMs) {
  if (!shouldVerifyPayments()) return true;
  if (!from) return false;
  return verifyCrcPayment({
    rpcUrl: resolveFeedRpcUrl(),
    from,
    to: PLATFORM_ORG,
    minAtto: FLAG_ATTO,
    sinceMs: Math.max(0, (createdAtMs || Date.now()) - 24 * 60 * 60 * 1000),
  });
}

function resolveShortCreator({ shortCid, shortId, data, creatorByShortCid, creatorByShortId }) {
  return (
    data?.creator ||
    creatorByShortCid.get(shortCid) ||
    (shortId ? creatorByShortId.get(shortId) : null) ||
    null
  );
}

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

/** Map superseded short CIDs to stable short ids using all pinned short JSON versions. */
function reconcileCidAliasesFromShortRecords(shortRecords) {
  /** @type {Map<string, Set<string>>} */
  const cidsByShortId = new Map();
  for (const r of shortRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    if (!isShortContent(data) || !data.shortId || !pin.cid) continue;
    const set = cidsByShortId.get(data.shortId) || new Set();
    set.add(pin.cid);
    cidsByShortId.set(data.shortId, set);
  }
  for (const [shortId, cids] of cidsByShortId) {
    const short = getShort(shortId);
    const currentCid = short?.cid;
    for (const cid of cids) {
      if (cid && cid !== currentCid) {
        recordCidAlias(cid, shortId);
      }
    }
  }
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
  /** @type {Map<string, string>} */
  const creatorByShortCid = new Map();
  /** @type {Map<string, string>} */
  const creatorByShortId = new Map();
  for (const r of shortRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    if (isShortRevoked(pin.cid)) continue;
    if (!isShortContent(data)) continue;
    if (data.creator) {
      creatorByShortCid.set(pin.cid, data.creator);
      if (data.shortId) creatorByShortId.set(data.shortId, data.creator);
    }
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

  // Older short CIDs (from edits) still have upvote/save/comment pins keyed to them.
  reconcileCidAliasesFromShortRecords(shortRecords);

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
    const shortId = data.shortId || pin.keyvalues?.shortId;
    const creator = resolveShortCreator({
      shortCid,
      shortId,
      data,
      creatorByShortCid,
      creatorByShortId,
    });
    if (!(await verifyInteractPayment(data.author, creator, data.createdAt))) continue;
    const out = upsertRemoteComment({
      shortCid,
      shortId: data.shortId || pin.keyvalues?.shortId,
      commentCid: pin.cid,
      by: data.author,
      text: data.text,
      createdAt: data.createdAt,
    });
    if (out) commentsAdded++;
  }

  let upvotesAdded = 0;
  resetAllUpvoteCounts();
  const upvoteRecords = await pMap(upvotePins, async (pin) => {
    const data = await fetchJsonByCid(pin.cid);
    return { pin, data };
  });
  for (const r of upvoteRecords) {
    if (r.__error) continue;
    const { pin, data } = r;
    const shortCid = data?.shortCid || pin.keyvalues?.shortCid;
    const shortId = data?.shortId || pin.keyvalues?.shortId;
    const voter = data?.voter || pin.keyvalues?.voter;
    if ((!shortCid && !shortId) || !voter) continue;
    const creator = resolveShortCreator({
      shortCid,
      shortId,
      data,
      creatorByShortCid,
      creatorByShortId,
    });
    if (!(await verifyInteractPayment(voter, creator, data?.createdAt))) continue;
    const out = upsertRemoteUpvote({ shortCid, shortId, voter });
    if (out) upvotesAdded++;
  }
  reconcilePendingUpvotes(upvotePins);

  let savesAdded = 0;
  resetAllSaveCounts();
  for (const pin of savePins) {
    const shortCid = pin.keyvalues?.shortCid;
    const shortId = pin.keyvalues?.shortId;
    const saver = pin.keyvalues?.saver;
    if ((!shortCid && !shortId) || !saver) continue;
    const out = upsertRemoteSave({ shortCid, shortId, saver });
    if (out) savesAdded++;
  }
  reconcilePendingSaves(savePins);

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
    if (!(await verifyFlagPayment(data.flagger || pin.keyvalues?.flagger, data.createdAt))) continue;
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
      shortId: data.shortId || pin.keyvalues?.shortId,
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
      shortId: data.shortId || pin.keyvalues?.shortId,
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
