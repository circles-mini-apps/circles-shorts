import { moderationSnapshot } from './moderation.js';
import { recordCidAlias, resolveShortForRemote, listAliasedCidsForShort } from './cidAliases.js';
import { recordUserFlag, removeUserFlag, updateUserFlagShortCid } from './userFlags.js';

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
  if (cid !== undefined) {
    const prevCid = short.cid;
    if (prevCid && cid && prevCid !== cid) {
      recordCidAlias(prevCid, id);
      updateUserFlagShortCid(id, cid);
    }
    short.cid = cid;
  }
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

export function setCommentCid(shortId, commentId, cid) {
  if (!cid) return null;
  const state = read();
  const short = state.shorts.find((s) => s.id === shortId);
  if (!short) return null;
  const comment = (short.comments || []).find((c) => c.id === commentId);
  if (!comment) return null;
  comment.cid = cid;
  write(state);
  return comment;
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

function interactionScopesForShort(short) {
  if (!short) return [];
  const scopes = new Set();
  if (short.id) scopes.add(short.id);
  if (short.cid) scopes.add(short.cid);
  for (const cid of listAliasedCidsForShort(short.id)) scopes.add(cid);
  return [...scopes];
}

function isInteractionRevoked(scopes, actor, list) {
  if (!actor) return false;
  for (const scope of scopes) {
    if (list.includes(interactionKey(scope, actor))) return true;
  }
  return false;
}

function addInteractionRevoked(scopes, actor, listKey) {
  if (!actor) return;
  const revoked = readRevoked();
  const list = revoked[listKey];
  for (const scope of scopes) {
    const key = interactionKey(scope, actor);
    if (!list.includes(key)) list.push(key);
  }
  writeRevoked(revoked);
}

function removeInteractionRevoked(scopes, actor, listKey) {
  if (!actor) return;
  const revoked = readRevoked();
  const keys = new Set(scopes.map((s) => interactionKey(s, actor)));
  const next = revoked[listKey].filter((k) => !keys.has(k));
  if (next.length === revoked[listKey].length) return;
  revoked[listKey] = next;
  writeRevoked(revoked);
}

export function isUpvoteRevokedForShort(short, voter) {
  return isInteractionRevoked(interactionScopesForShort(short), voter, readRevoked().upvotes);
}

export function isSaveRevokedForShort(short, saver) {
  return isInteractionRevoked(interactionScopesForShort(short), saver, readRevoked().saves);
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
  addInteractionRevoked(interactionScopesForShort(short), voter, 'upvotes');
}

export function revokeSaveForShort(short, saver) {
  addInteractionRevoked(interactionScopesForShort(short), saver, 'saves');
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
  removeInteractionRevoked(interactionScopesForShort(short), voter, 'upvotes');
}

export function clearSaveRevoked(short, saver) {
  removeInteractionRevoked(interactionScopesForShort(short), saver, 'saves');
}

const PENDING_KEY = 'shorts:pending:v1';

function readPending() {
  if (typeof localStorage === 'undefined') return { upvotes: [], saves: [] };
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return { upvotes: [], saves: [] };
    const parsed = JSON.parse(raw);
    return {
      upvotes: Array.isArray(parsed.upvotes) ? parsed.upvotes : [],
      saves: Array.isArray(parsed.saves) ? parsed.saves : [],
    };
  } catch {
    return { upvotes: [], saves: [] };
  }
}

function writePending(data) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

function pendingActorKey(shortId, actor) {
  return `${shortId}:${String(actor).toLowerCase()}`;
}

export function addPendingUpvote(shortId, voter) {
  if (!shortId || !voter) return;
  const pending = readPending();
  const key = pendingActorKey(shortId, voter);
  if (pending.upvotes.some((e) => pendingActorKey(e.shortId, e.voter) === key)) return;
  pending.upvotes.push({ shortId, voter });
  writePending(pending);
}

export function removePendingUpvote(shortId, voter) {
  if (!shortId || !voter) return;
  const pending = readPending();
  const key = pendingActorKey(shortId, voter);
  const next = pending.upvotes.filter((e) => pendingActorKey(e.shortId, e.voter) !== key);
  if (next.length === pending.upvotes.length) return;
  pending.upvotes = next;
  writePending(pending);
}

export function addPendingSave(shortId, saver) {
  if (!shortId || !saver) return;
  const pending = readPending();
  const key = pendingActorKey(shortId, saver);
  if (pending.saves.some((e) => pendingActorKey(e.shortId, e.saver) === key)) return;
  pending.saves.push({ shortId, saver });
  writePending(pending);
}

export function removePendingSave(shortId, saver) {
  if (!shortId || !saver) return;
  const pending = readPending();
  const key = pendingActorKey(shortId, saver);
  const next = pending.saves.filter((e) => pendingActorKey(e.shortId, e.saver) !== key);
  if (next.length === pending.saves.length) return;
  pending.saves = next;
  writePending(pending);
}

function shortCidScopes(short) {
  const scopes = new Set(listAliasedCidsForShort(short.id));
  if (short.cid) scopes.add(short.cid);
  return scopes;
}

function upvotePinMatches(upvotePins, short, voter) {
  const v = voter.toLowerCase();
  const cidScopes = shortCidScopes(short);
  for (const pin of upvotePins) {
    if (String(pin.keyvalues?.voter || '').toLowerCase() !== v) continue;
    if (pin.keyvalues?.shortId === short.id) return true;
    const sc = pin.keyvalues?.shortCid;
    if (sc && cidScopes.has(sc)) return true;
  }
  return false;
}

function savePinMatches(savePins, short, saver) {
  const s = saver.toLowerCase();
  const cidScopes = shortCidScopes(short);
  for (const pin of savePins) {
    if (String(pin.keyvalues?.saver || '').toLowerCase() !== s) continue;
    if (pin.keyvalues?.shortId === short.id) return true;
    const sc = pin.keyvalues?.shortCid;
    if (sc && cidScopes.has(sc)) return true;
  }
  return false;
}

/** Re-apply local upvotes whose IPFS pin is still in flight; drop confirmed/revoked entries. */
export function reconcilePendingUpvotes(upvotePins) {
  const pending = readPending();
  if (!pending.upvotes.length) return;
  const next = [];
  for (const { shortId, voter } of pending.upvotes) {
    const short = getShort(shortId);
    if (!short) continue;
    if (isUpvoteRevokedForShort(short, voter)) continue;
    if (upvotePinMatches(upvotePins, short, voter)) continue;
    upvoteShort(shortId, voter);
    next.push({ shortId, voter });
  }
  if (next.length !== pending.upvotes.length) {
    pending.upvotes = next;
    writePending(pending);
  }
}

/** Re-apply local saves whose IPFS pin is still in flight; drop confirmed/revoked entries. */
export function reconcilePendingSaves(savePins) {
  const pending = readPending();
  if (!pending.saves.length) return;
  const next = [];
  for (const { shortId, saver } of pending.saves) {
    const short = getShort(shortId);
    if (!short) continue;
    if (isSaveRevokedForShort(short, saver)) continue;
    if (savePinMatches(savePins, short, saver)) continue;
    saveShort(shortId, saver);
    next.push({ shortId, saver });
  }
  if (next.length !== pending.saves.length) {
    pending.saves = next;
    writePending(pending);
  }
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
    if (short.cid && cid && short.cid !== cid) {
      recordCidAlias(short.cid, short.id);
      updateUserFlagShortCid(short.id, cid);
    }
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

export function upsertRemoteComment({ shortCid, shortId, commentCid, by, text, createdAt }) {
  if (!shortCid && !shortId) return null;
  const state = read();
  const short = resolveShortForRemote(state, { shortCid, shortId });
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

export function upsertRemoteUpvote({ shortCid, shortId, voter }) {
  if ((!shortCid && !shortId) || !voter) return null;
  const state = read();
  const short = resolveShortForRemote(state, { shortCid, shortId });
  if (!short) return null;
  if (isUpvoteRevokedForShort(short, voter)) return null;
  if (shortCid && isUpvoteRevoked(shortCid, voter)) return null;
  if (shortId && isUpvoteRevoked(shortId, voter)) return null;
  short.voters = short.voters || [];
  if (!short.voters.some((v) => v.toLowerCase() === voter.toLowerCase())) {
    short.voters.push(voter);
  }
  short.upvotes = short.voters.length;
  write(state);
  return short;
}

export function upsertRemoteSave({ shortCid, shortId, saver }) {
  if ((!shortCid && !shortId) || !saver) return null;
  const state = read();
  const short = resolveShortForRemote(state, { shortCid, shortId });
  if (!short) return null;
  if (isSaveRevokedForShort(short, saver)) return null;
  if (shortCid && isSaveRevoked(shortCid, saver)) return null;
  if (shortId && isSaveRevoked(shortId, saver)) return null;
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
  let short = resolveShortForRemote(state, { shortCid, shortId });
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

export function upsertRemoteModVote({ shortCid, shortId, voteCid, flagCid, voter, verdict, createdAt }) {
  if ((!shortCid && !shortId) || !voteCid || !flagCid || !voter || isFlagRevoked(flagCid)) return null;
  const revoked = readRevoked();
  if (revoked.modVotes?.includes(voteCid)) return null;
  const state = read();
  const short = resolveShortForRemote(state, { shortCid, shortId });
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

export function upsertRemoteRuling({ shortCid, shortId, rulingCid, outcome, flagger, ruling, ruledAt }) {
  if ((!shortCid && !shortId) || !outcome) return null;
  const state = read();
  const short = resolveShortForRemote(state, { shortCid, shortId });
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
