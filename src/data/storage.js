import { moderationSnapshot } from './moderation.js';
import { recordUserFlag, removeUserFlag } from './userFlags.js';

const KEY = 'shorts:v1';
const LEGACY_KEY = 'circles-shorts:v1';

function readRawStorage() {
  if (typeof localStorage === 'undefined') return null;
  let raw = localStorage.getItem(KEY);
  if (!raw) {
    raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      try {
        localStorage.setItem(KEY, raw);
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* ignore quota */
      }
    }
  }
  return raw;
}

function nowMs() {
  return Date.now();
}

function uid() {
  return `${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function read() {
  if (typeof localStorage === 'undefined') return { shorts: [] };
  try {
    const raw = readRawStorage();
    if (!raw) return { shorts: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.shorts)) return { shorts: [] };
    return parsed;
  } catch {
    return { shorts: [] };
  }
}

function write(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

function findShort(state, { cid, id }) {
  if (cid) {
    const byCid = state.shorts.find((s) => s.cid === cid);
    if (byCid) return byCid;
  }
  if (id) return state.shorts.find((s) => s.id === id) || null;
  return null;
}

function ensureModeration(short) {
  if (!short.moderation) {
    short.moderation = {
      status: 'none',
      activeFlag: null,
      votes: [],
      resolvedFlagger: null,
      ruledAt: null,
      ruling: null,
      rulingCid: null,
    };
  }
  return short.moderation;
}

export function listShorts() {
  return read().shorts;
}

export function getShort(id) {
  return read().shorts.find((s) => s.id === id) || null;
}

export function updateShort(
  id,
  { title, url, categories, durationSeconds = undefined, cid = undefined, editedAt = undefined } = {},
) {
  const state = read();
  const short = state.shorts.find((s) => s.id === id);
  if (!short) throw new Error('Short not found');
  if (title != null) short.title = title;
  if (url != null) short.url = url;
  if (categories != null) short.categories = categories;
  if (durationSeconds !== undefined) {
    if (typeof durationSeconds === 'number' && durationSeconds > 0) {
      short.durationSeconds = durationSeconds;
    } else {
      delete short.durationSeconds;
    }
  }
  if (cid !== undefined) short.cid = cid;
  if (editedAt !== undefined) short.editedAt = editedAt;
  write(state);
  return short;
}

export function removeShort(id) {
  const state = read();
  const idx = state.shorts.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error('Short not found');
  state.shorts.splice(idx, 1);
  write(state);
}

export function addShort({ title, url, categories, creator, cid = null, durationSeconds = null }) {
  const state = read();
  const short = {
    id: uid(),
    title,
    url,
    categories,
    creator,
    createdAt: nowMs(),
    upvotes: 0,
    saves: 0,
    comments: [],
    voters: [],
    savers: [],
    cid,
    ...(typeof durationSeconds === 'number' && durationSeconds > 0 ? { durationSeconds } : {}),
  };
  state.shorts.push(short);
  write(state);
  return short;
}

export function hasUpvoted(short, address) {
  if (!short || !address) return false;
  return (short.voters || []).some((v) => v.toLowerCase() === address.toLowerCase());
}

export function upvoteShort(id, voter) {
  const state = read();
  const short = state.shorts.find((s) => s.id === id);
  if (!short) throw new Error('Short not found');
  short.voters = short.voters || [];
  if (short.voters.some((v) => v.toLowerCase() === voter.toLowerCase())) {
    return short;
  }
  short.voters.push(voter);
  short.upvotes = short.voters.length;
  write(state);
  return short;
}

export function unupvoteShort(id, voter) {
  const state = read();
  const short = state.shorts.find((s) => s.id === id);
  if (!short) throw new Error('Short not found');
  short.voters = (short.voters || []).filter((v) => v.toLowerCase() !== voter.toLowerCase());
  short.upvotes = short.voters.length;
  write(state);
  return short;
}

export function isSavedBy(short, address) {
  if (!short || !address) return false;
  return (short.savers || []).some((v) => v.toLowerCase() === address.toLowerCase());
}

export function saveShort(id, saver) {
  const state = read();
  const short = state.shorts.find((s) => s.id === id);
  if (!short) throw new Error('Short not found');
  short.savers = short.savers || [];
  if (short.savers.some((v) => v.toLowerCase() === saver.toLowerCase())) {
    return short;
  }
  short.savers.push(saver);
  short.saves = short.savers.length;
  write(state);
  return short;
}

export function unsaveShort(id, saver) {
  const state = read();
  const short = state.shorts.find((s) => s.id === id);
  if (!short) throw new Error('Short not found');
  short.savers = (short.savers || []).filter((v) => v.toLowerCase() !== saver.toLowerCase());
  short.saves = short.savers.length;
  write(state);
  return short;
}

export function commentShort(id, { by, text, cid = null }) {
  const state = read();
  const short = state.shorts.find((s) => s.id === id);
  if (!short) throw new Error('Short not found');
  const comment = { id: uid(), by, text, createdAt: nowMs(), cid };
  short.comments = [...(short.comments || []), comment];
  write(state);
  return { short, comment };
}

export function deleteCommentFromShort(shortId, commentId) {
  const state = read();
  const short = state.shorts.find((s) => s.id === shortId);
  if (!short) throw new Error('Short not found');
  short.comments = (short.comments || []).filter((c) => c.id !== commentId);
  write(state);
  return short;
}

const REVOKED_KEY = 'shorts:revoked:v1';

function readRevoked() {
  if (typeof localStorage === 'undefined') {
    return { upvotes: [], saves: [], comments: [], shorts: [], flags: [], modVotes: [] };
  }
  try {
    const raw = localStorage.getItem(REVOKED_KEY);
    if (!raw) return { upvotes: [], saves: [], comments: [], shorts: [], flags: [], modVotes: [] };
    const parsed = JSON.parse(raw);
    return {
      upvotes: Array.isArray(parsed.upvotes) ? parsed.upvotes : [],
      saves: Array.isArray(parsed.saves) ? parsed.saves : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      shorts: Array.isArray(parsed.shorts) ? parsed.shorts : [],
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      modVotes: Array.isArray(parsed.modVotes) ? parsed.modVotes : [],
    };
  } catch {
    return { upvotes: [], saves: [], comments: [], shorts: [], flags: [], modVotes: [] };
  }
}

function writeRevoked(revoked) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(REVOKED_KEY, JSON.stringify(revoked));
  } catch {
    /* ignore quota */
  }
}

function interactionKey(scope, actor) {
  return `${String(scope).toLowerCase()}:${String(actor).toLowerCase()}`;
}

export function isUpvoteRevoked(shortCidOrId, voter) {
  if (!shortCidOrId || !voter) return false;
  return readRevoked().upvotes.includes(interactionKey(shortCidOrId, voter));
}

export function isSaveRevoked(shortCidOrId, saver) {
  if (!shortCidOrId || !saver) return false;
  return readRevoked().saves.includes(interactionKey(shortCidOrId, saver));
}

export function isCommentRevoked(commentCidOrId) {
  if (!commentCidOrId) return false;
  return readRevoked().comments.includes(commentCidOrId);
}

export function revokeUpvoteForShort(short, voter) {
  const scope = short?.cid || short?.id;
  if (!scope || !voter) return;
  const key = interactionKey(scope, voter);
  const revoked = readRevoked();
  if (revoked.upvotes.includes(key)) return;
  revoked.upvotes.push(key);
  writeRevoked(revoked);
}

export function revokeSaveForShort(short, saver) {
  const scope = short?.cid || short?.id;
  if (!scope || !saver) return;
  const key = interactionKey(scope, saver);
  const revoked = readRevoked();
  if (revoked.saves.includes(key)) return;
  revoked.saves.push(key);
  writeRevoked(revoked);
}

export function revokeComment(comment) {
  if (!comment) return;
  const revoked = readRevoked();
  for (const key of [comment.cid, comment.id].filter(Boolean)) {
    if (!revoked.comments.includes(key)) revoked.comments.push(key);
  }
  writeRevoked(revoked);
}

export function isShortRevoked(cidOrId) {
  if (!cidOrId) return false;
  return readRevoked().shorts.includes(cidOrId);
}

export function revokeShort(short) {
  if (!short) return;
  const revoked = readRevoked();
  for (const key of [short.cid, short.id].filter(Boolean)) {
    if (!revoked.shorts.includes(key)) revoked.shorts.push(key);
  }
  writeRevoked(revoked);
}

export function isFlagRevoked(flagCid) {
  if (!flagCid) return false;
  return readRevoked().flags.includes(flagCid);
}

export function revokeFlag(flagCid) {
  if (!flagCid) return;
  const revoked = readRevoked();
  if (revoked.flags.includes(flagCid)) return;
  revoked.flags.push(flagCid);
  writeRevoked(revoked);
}

export function revokeModVote(voteCid) {
  if (!voteCid) return;
  const revoked = readRevoked();
  if (!revoked.modVotes) revoked.modVotes = [];
  if (revoked.modVotes.includes(voteCid)) return;
  revoked.modVotes.push(voteCid);
  writeRevoked(revoked);
}

export function clearUpvoteRevoked(short, voter) {
  const scope = short?.cid || short?.id;
  if (!scope || !voter) return;
  const key = interactionKey(scope, voter);
  const revoked = readRevoked();
  const next = revoked.upvotes.filter((k) => k !== key);
  if (next.length === revoked.upvotes.length) return;
  revoked.upvotes = next;
  writeRevoked(revoked);
}

export function clearSaveRevoked(short, saver) {
  const scope = short?.cid || short?.id;
  if (!scope || !saver) return;
  const key = interactionKey(scope, saver);
  const revoked = readRevoked();
  const next = revoked.saves.filter((k) => k !== key);
  if (next.length === revoked.saves.length) return;
  revoked.saves = next;
  writeRevoked(revoked);
}

export function allCategories() {
  const set = new Set();
  for (const s of listShorts()) {
    for (const c of s.categories || []) set.add(c);
  }
  return Array.from(set).sort();
}

export function reconcileModeration(short) {
  const m = ensureModeration(short);
  if (m.status === 'violated' || m.status === 'cleared') return short;

  const snap = moderationSnapshot(short);
  if (snap.status !== 'violated' && snap.status !== 'cleared') {
    if (snap.activeFlag) m.status = 'voting';
    return short;
  }

  m.status = snap.status;
  m.ruledAt = Date.now();
  m.ruling = { ...snap.tally };
  m.resolvedFlagger = snap.activeFlag?.flagger || m.activeFlag?.flagger || null;
  return short;
}

export function reconcileAllModeration() {
  const state = read();
  for (const short of state.shorts) {
    reconcileModeration(short);
  }
  write(state);
}

export function finalizeModerationIfReady(shortId) {
  const state = read();
  const short = findShort(state, { id: shortId });
  if (!short) return null;
  reconcileModeration(short);
  write(state);
  const status = short.moderation?.status;
  if (status === 'violated' || status === 'cleared') return short;
  return null;
}

export function setModerationRulingCid(shortId, rulingCid) {
  const state = read();
  const short = findShort(state, { id: shortId });
  if (!short) return;
  ensureModeration(short).rulingCid = rulingCid;
  write(state);
}

export function addFlag(shortId, { flagger, category, explanation, reason, cid }) {
  const state = read();
  const short = findShort(state, { id: shortId });
  if (!short) throw new Error('Short not found');
  const m = ensureModeration(short);
  if (m.status === 'violated') {
    throw new Error('This short was removed and cannot be flagged again');
  }
  if (m.status === 'voting' && m.activeFlag) {
    throw new Error('This short already has an active flag');
  }
  if (short.creator?.toLowerCase() === flagger.toLowerCase()) {
    throw new Error('You cannot flag your own short');
  }
  m.votes = [];
  m.activeFlag = { cid, flagger, category, explanation, reason, createdAt: Date.now() };
  m.status = 'voting';
  m.resolvedFlagger = null;
  m.ruledAt = null;
  m.ruling = null;
  m.rulingCid = null;
  write(state);
  recordUserFlag(flagger, { shortId, shortCid: short.cid || null, flagCid: cid });
  return short;
}

/** Clear an active flag when the original flagger withdraws it. */
export function withdrawFlagFromShort(shortId, flagger) {
  const state = read();
  const short = findShort(state, { id: shortId });
  if (!short) throw new Error('Short not found');
  const m = ensureModeration(short);
  const flag = m.activeFlag;
  if (!flag) {
    throw new Error('No active flag to withdraw');
  }
  if (m.status === 'violated' || m.status === 'cleared') {
    throw new Error('No active flag to withdraw');
  }
  if (flag.flagger?.toLowerCase() !== flagger.toLowerCase()) {
    throw new Error('Only the flagger can withdraw this flag');
  }
  const flagCid = flag.cid;
  const voteCids = (m.votes || [])
    .filter((v) => v.flagCid === flagCid)
    .map((v) => v.cid)
    .filter(Boolean);
  m.status = 'none';
  m.activeFlag = null;
  m.votes = [];
  m.resolvedFlagger = null;
  m.ruledAt = null;
  m.ruling = null;
  m.rulingCid = null;
  write(state);
  removeUserFlag(flagger, { shortId, shortCid: short.cid || null, flagCid });
  return { short, flagCid, voteCids };
}

export function addModerationVote(shortId, { voter, verdict, flagCid, cid }) {
  const state = read();
  const short = findShort(state, { id: shortId });
  if (!short) throw new Error('Short not found');
  const m = ensureModeration(short);
  const flag = m.activeFlag;
  if (!flag || m.status !== 'voting') {
    throw new Error('No active flag on this short');
  }
  if (flag.cid !== flagCid) {
    throw new Error('Flag mismatch');
  }
  if (short.creator?.toLowerCase() === voter.toLowerCase()) {
    throw new Error('The creator cannot vote on their own flag');
  }
  m.votes = m.votes || [];
  if (m.votes.some((v) => v.voter?.toLowerCase() === voter.toLowerCase() && v.flagCid === flagCid)) {
    throw new Error('You already voted on this flag');
  }
  m.votes.push({ cid, flagCid, voter, verdict, createdAt: Date.now() });
  reconcileModeration(short);
  write(state);
  return short;
}

export function upsertRemoteShort({
  cid,
  title,
  url,
  categories,
  creator,
  createdAt,
  durationSeconds,
  shortId,
  editedAt,
}) {
  if (!cid || isShortRevoked(cid)) return null;
  const state = read();
  let short = findShort(state, { cid });
  if (!short && shortId) short = findShort(state, { id: shortId });
  if (!short && creator && createdAt) {
    short = state.shorts.find(
      (s) => s.creator?.toLowerCase() === String(creator).toLowerCase() && s.createdAt === createdAt,
    );
  }
  if (short) {
    short.cid = cid;
    short.title = title ?? short.title;
    short.url = url ?? short.url;
    short.categories = Array.isArray(categories) ? categories : short.categories;
    short.creator = creator ?? short.creator;
    short.createdAt = createdAt ?? short.createdAt;
    if (typeof durationSeconds === 'number' && durationSeconds > 0) {
      short.durationSeconds = durationSeconds;
    }
    if (typeof editedAt === 'number' && editedAt > 0) {
      short.editedAt = editedAt;
    }
  } else {
    short = {
      id: shortId || cid,
      title: title || '',
      url: url || '',
      categories: Array.isArray(categories) ? categories : [],
      creator: creator || '',
      createdAt: createdAt || nowMs(),
      upvotes: 0,
      saves: 0,
      comments: [],
      voters: [],
      savers: [],
      cid,
      ...(typeof durationSeconds === 'number' && durationSeconds > 0 ? { durationSeconds } : {}),
      ...(typeof editedAt === 'number' && editedAt > 0 ? { editedAt } : {}),
    };
    state.shorts.push(short);
  }
  write(state);
  return short;
}

export function upsertRemoteComment({ shortCid, commentCid, by, text, createdAt }) {
  if (!shortCid) return null;
  const state = read();
  const short = findShort(state, { cid: shortCid });
  if (!short) return null;
  short.comments = short.comments || [];
  if (commentCid && isCommentRevoked(commentCid)) return short;
  const alreadyById = commentCid && short.comments.some((c) => c.cid === commentCid);
  if (!alreadyById) {
    const id = commentCid || uid();
    if (isCommentRevoked(id)) return short;
    short.comments.push({
      id,
      by: by || '',
      text: text || '',
      createdAt: createdAt || nowMs(),
      cid: commentCid || null,
    });
  }
  write(state);
  return short;
}

export function resetAllUpvoteCounts() {
  const state = read();
  for (const short of state.shorts) {
    short.voters = [];
    short.upvotes = 0;
  }
  write(state);
}

export function resetAllSaveCounts() {
  const state = read();
  for (const short of state.shorts) {
    short.savers = [];
    short.saves = 0;
  }
  write(state);
}

export function upsertRemoteUpvote({ shortCid, voter }) {
  if (!shortCid || !voter) return null;
  if (isUpvoteRevoked(shortCid, voter)) return null;
  const state = read();
  const short = findShort(state, { cid: shortCid });
  if (!short) return null;
  short.voters = short.voters || [];
  if (!short.voters.some((v) => v.toLowerCase() === voter.toLowerCase())) {
    short.voters.push(voter);
  }
  short.upvotes = short.voters.length;
  write(state);
  return short;
}

export function upsertRemoteSave({ shortCid, saver }) {
  if (!shortCid || !saver) return null;
  if (isSaveRevoked(shortCid, saver)) return null;
  const state = read();
  const short = findShort(state, { cid: shortCid });
  if (!short) return null;
  short.savers = short.savers || [];
  if (!short.savers.some((v) => v.toLowerCase() === saver.toLowerCase())) {
    short.savers.push(saver);
  }
  short.saves = short.savers.length;
  write(state);
  return short;
}

export function upsertRemoteFlag({ shortCid, shortId, flagCid, flagger, category, explanation, reason, createdAt }) {
  if (!flagCid || isFlagRevoked(flagCid)) return null;
  if (!shortCid && !shortId) return null;
  const state = read();
  let short = shortCid ? findShort(state, { cid: shortCid }) : null;
  if (!short && shortId) short = findShort(state, { id: shortId });
  if (!short) return null;
  const m = ensureModeration(short);
  if (m.status === 'violated') return short;
  const flaggerNorm = (flagger || m.activeFlag?.flagger || '').toLowerCase();
  if (m.status === 'voting' && m.activeFlag && m.activeFlag.cid !== flagCid) {
    if (m.activeFlag.flagger?.toLowerCase() !== flaggerNorm || !flaggerNorm) {
      return short;
    }
  }
  const resolvedFlagger = flagger || m.activeFlag?.flagger || '';
  m.activeFlag = {
    cid: flagCid,
    flagger: resolvedFlagger,
    category: category || m.activeFlag?.category || null,
    explanation: explanation || m.activeFlag?.explanation || '',
    reason: reason || m.activeFlag?.reason || '',
    createdAt: createdAt || m.activeFlag?.createdAt || nowMs(),
  };
  m.status = 'voting';
  reconcileModeration(short);
  write(state);
  if (resolvedFlagger) {
    recordUserFlag(resolvedFlagger, {
      shortId: short.id,
      shortCid: short.cid || shortCid || null,
      flagCid,
    });
  }
  return short;
}

export function upsertRemoteModVote({ shortCid, voteCid, flagCid, voter, verdict, createdAt }) {
  if (!shortCid || !voteCid || !flagCid || !voter || isFlagRevoked(flagCid)) return null;
  const revoked = readRevoked();
  if (revoked.modVotes?.includes(voteCid)) return null;
  const state = read();
  const short = findShort(state, { cid: shortCid });
  if (!short) return null;
  const m = ensureModeration(short);
  m.votes = m.votes || [];
  if (m.votes.some((v) => v.cid === voteCid)) return short;
  if (m.votes.some((v) => v.voter?.toLowerCase() === voter.toLowerCase() && v.flagCid === flagCid)) {
    return short;
  }
  m.votes.push({
    cid: voteCid,
    flagCid,
    voter,
    verdict: verdict === 'violation' ? 'violation' : 'clear',
    createdAt: createdAt || nowMs(),
  });
  reconcileModeration(short);
  write(state);
  return short;
}

export function upsertRemoteRuling({ shortCid, rulingCid, outcome, flagger, ruling, ruledAt }) {
  if (!shortCid || !outcome) return null;
  const state = read();
  const short = findShort(state, { cid: shortCid });
  if (!short) return null;
  const m = ensureModeration(short);
  if (m.status === 'violated' || m.status === 'cleared') return short;
  m.status = outcome === 'violation' ? 'violated' : 'cleared';
  m.ruledAt = ruledAt || Date.now();
  m.ruling = ruling || m.ruling;
  m.resolvedFlagger = flagger || m.resolvedFlagger;
  if (rulingCid) m.rulingCid = rulingCid;
  write(state);
  return short;
}
