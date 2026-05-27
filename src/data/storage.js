import { moderationSnapshot } from './moderation.js';

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

export function upvoteShort(id, voter) {
  const state = read();
  const short = state.shorts.find((s) => s.id === id);
  if (!short) throw new Error('Short not found');
  short.upvotes = (short.upvotes || 0) + 1;
  short.voters = Array.from(new Set([...(short.voters || []), voter]));
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

export function commentShort(id, { by, text, cid = null }) {
  const state = read();
  const short = state.shorts.find((s) => s.id === id);
  if (!short) throw new Error('Short not found');
  const comment = { id: uid(), by, text, createdAt: nowMs(), cid };
  short.comments = [...(short.comments || []), comment];
  write(state);
  return { short, comment };
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
  return short;
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
}) {
  if (!cid) return null;
  const state = read();
  let short = findShort(state, { cid });
  if (short) {
    short.title = title ?? short.title;
    short.url = url ?? short.url;
    short.categories = Array.isArray(categories) ? categories : short.categories;
    short.creator = creator ?? short.creator;
    short.createdAt = createdAt ?? short.createdAt;
    if (typeof durationSeconds === 'number' && durationSeconds > 0) {
      short.durationSeconds = durationSeconds;
    }
  } else {
    short = {
      id: cid,
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
  const alreadyById = commentCid && short.comments.some((c) => c.cid === commentCid);
  if (!alreadyById) {
    short.comments.push({
      id: commentCid || uid(),
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

export function upsertRemoteFlag({ shortCid, flagCid, flagger, category, explanation, reason, createdAt }) {
  if (!shortCid || !flagCid) return null;
  const state = read();
  const short = findShort(state, { cid: shortCid });
  if (!short) return null;
  const m = ensureModeration(short);
  if (m.status === 'violated') return short;
  if (m.status === 'voting' && m.activeFlag && m.activeFlag.cid !== flagCid) return short;
  m.activeFlag = {
    cid: flagCid,
    flagger: flagger || '',
    category: category || null,
    explanation: explanation || '',
    reason: reason || '',
    createdAt: createdAt || nowMs(),
  };
  m.status = 'voting';
  reconcileModeration(short);
  write(state);
  return short;
}

export function upsertRemoteModVote({ shortCid, voteCid, flagCid, voter, verdict, createdAt }) {
  if (!shortCid || !voteCid || !flagCid || !voter) return null;
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
