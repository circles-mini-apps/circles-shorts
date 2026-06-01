/**
 * Upload activity notifications for creators (upvotes, saves, comments, flags, rulings)
 * and flaggers (edits on shorts they flagged).
 */

import { listShorts } from './storage.js';

const STORE_KEY = 'shorts:notifications:v1';
const SEEN_KEY = 'shorts:notify-seen:v1';
const FLAGGER_SEEN_KEY = 'shorts:notify-flagger-seen:v1';
const MAX_ITEMS = 100;

/** @typedef {'upvote' | 'save' | 'comment' | 'flag' | 'ruling' | 'flag-edit'} NotificationType */

/**
 * @typedef {{
 *   id: string;
 *   type: NotificationType;
 *   shortId: string;
 *   shortTitle: string;
 *   actor: string | null;
 *   createdAt: number;
 *   meta?: { verdict?: 'violation' | 'clear'; commentPreview?: string };
 * }} UploadNotification
 */

function addrKey(address) {
  return String(address || '').toLowerCase();
}

function readStore(address) {
  const key = addrKey(address);
  if (!key || typeof localStorage === 'undefined') {
    return { items: [], readIds: [] };
  }
  try {
    const raw = localStorage.getItem(`${STORE_KEY}:${key}`);
    if (!raw) return { items: [], readIds: [] };
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      readIds: Array.isArray(parsed.readIds) ? parsed.readIds : [],
    };
  } catch {
    return { items: [], readIds: [] };
  }
}

function writeStore(address, store) {
  const key = addrKey(address);
  if (!key || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${STORE_KEY}:${key}`, JSON.stringify(store));
  } catch {
    /* ignore quota */
  }
}

function readSeen(address) {
  const key = addrKey(address);
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${SEEN_KEY}:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSeen(address, snapshot) {
  const key = addrKey(address);
  if (!key || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${SEEN_KEY}:${key}`, JSON.stringify(snapshot));
  } catch {
    /* ignore quota */
  }
}

function readFlaggerSeen(address) {
  const key = addrKey(address);
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${FLAGGER_SEEN_KEY}:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeFlaggerSeen(address, snapshot) {
  const key = addrKey(address);
  if (!key || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${FLAGGER_SEEN_KEY}:${key}`, JSON.stringify(snapshot));
  } catch {
    /* ignore quota */
  }
}

/** @param {{ id?: string; cid?: string | null } | null | undefined} comment */
function commentStableKey(comment) {
  if (!comment) return null;
  return comment.cid || comment.id || null;
}

/** All keys that identify the same comment across local id → IPFS cid migration. */
function commentIdentityKeys(comments) {
  const keys = [];
  for (const comment of comments || []) {
    if (comment.cid) keys.push(String(comment.cid));
    if (comment.id) keys.push(String(comment.id));
  }
  return keys;
}

/** @param {import('./storage.js').listShorts extends () => infer R ? R[number] : never} short */
function snapshotForShort(short) {
  const voters = (short.voters || []).map((v) => v.toLowerCase());
  const savers = (short.savers || []).map((v) => v.toLowerCase());
  const commentIds = commentIdentityKeys(short.comments);
  const flagCid = short.moderation?.activeFlag?.cid || null;
  const moderationStatus = short.moderation?.status || 'none';
  const ruledAt = short.moderation?.ruledAt || null;
  return { voters, savers, commentIds, flagCid, moderationStatus, ruledAt };
}

/** @param {import('./storage.js').listShorts extends () => infer R ? R[number] : never} short */
function snapshotForFlaggedShort(short) {
  return {
    cid: short.cid || null,
    editedAt: short.editedAt || null,
  };
}

function isActiveFlagger(short, flaggerLower) {
  const m = short.moderation;
  return m?.status === 'voting' && m.activeFlag?.flagger?.toLowerCase() === flaggerLower;
}

/** @param {Array<{ id: string; cid?: string | null; editedAt?: number | null; moderation?: Record<string, unknown> }>} shorts @param {string} flaggerLower */
function buildFlaggerSnapshot(shorts, flaggerLower) {
  /** @type {Record<string, ReturnType<typeof snapshotForFlaggedShort>>} */
  const out = {};
  for (const short of shorts) {
    if (!isActiveFlagger(short, flaggerLower)) continue;
    out[short.id] = snapshotForFlaggedShort(short);
  }
  return out;
}

/** @param {Array<{ id: string; creator?: string; title?: string; voters?: string[]; savers?: string[]; comments?: Array<{ id: string; by?: string; text?: string; createdAt?: number }>; moderation?: Record<string, unknown> }>} shorts */
function buildSnapshot(shorts, creatorLower) {
  /** @type {Record<string, ReturnType<typeof snapshotForShort>>} */
  const out = {};
  for (const short of shorts) {
    if (short.creator?.toLowerCase() !== creatorLower) continue;
    out[short.id] = snapshotForShort(short);
  }
  return out;
}

/** Empty snapshot used when a short wasn't in the previous baseline yet. */
function emptyShortSnapshot() {
  return {
    voters: [],
    savers: [],
    commentIds: [],
    flagCid: null,
    moderationStatus: 'none',
    ruledAt: null,
  };
}

/** @param {UploadNotification[]} items @param {ReturnType<typeof snapshotForShort>} cur @param {object} short */
function appendFlagNotification(items, cur, short) {
  if (!cur.flagCid) return items;
  const title = short.title || 'Untitled';
  const flagger = short.moderation?.activeFlag?.flagger || null;
  return prependNotification(items, {
    id: `flag:${short.id}:${cur.flagCid}`,
    type: 'flag',
    shortId: short.id,
    shortTitle: title,
    actor: flagger,
    createdAt: short.moderation?.activeFlag?.createdAt || Date.now(),
  });
}

/** @param {UploadNotification[]} items @param {ReturnType<typeof snapshotForShort>} cur @param {ReturnType<typeof snapshotForShort>} prev @param {object} short */
function appendRulingNotification(items, cur, prev, short) {
  if (
    cur.moderationStatus === prev.moderationStatus ||
    (cur.moderationStatus !== 'violated' && cur.moderationStatus !== 'cleared')
  ) {
    return items;
  }
  const verdict = cur.moderationStatus === 'violated' ? 'violation' : 'clear';
  const title = short.title || 'Untitled';
  return prependNotification(items, {
    id: `ruling:${short.id}:${cur.ruledAt || verdict}`,
    type: 'ruling',
    shortId: short.id,
    shortTitle: title,
    actor: null,
    createdAt: cur.ruledAt || Date.now(),
    meta: { verdict },
  });
}

/** Diff one short against a previous snapshot and append new notifications. */
function diffShortNotifications(items, short, prev, creatorLower) {
  const cur = snapshotForShort(short);
  const title = short.title || 'Untitled';

  for (const voter of cur.voters) {
    if (prev.voters.includes(voter) || voter === creatorLower) continue;
    items = prependNotification(items, {
      id: `upvote:${short.id}:${voter}`,
      type: 'upvote',
      shortId: short.id,
      shortTitle: title,
      actor: voter,
      createdAt: Date.now(),
    });
  }

  for (const saver of cur.savers) {
    if (prev.savers.includes(saver) || saver === creatorLower) continue;
    items = prependNotification(items, {
      id: `save:${short.id}:${saver}`,
      type: 'save',
      shortId: short.id,
      shortTitle: title,
      actor: saver,
      createdAt: Date.now(),
    });
  }

  const prevCommentIds = new Set(prev.commentIds || []);
  for (const comment of short.comments || []) {
    const stableKey = commentStableKey(comment);
    if (!stableKey) continue;
    if (prevCommentIds.has(stableKey)) continue;
    if (comment.id && prevCommentIds.has(comment.id)) continue;
    if (comment.cid && prevCommentIds.has(comment.cid)) continue;
    if (comment.by?.toLowerCase() === creatorLower) continue;
    const preview = (comment.text || '').trim().slice(0, 80);
    items = prependNotification(items, {
      id: `comment:${short.id}:${stableKey}`,
      type: 'comment',
      shortId: short.id,
      shortTitle: title,
      actor: comment.by || null,
      createdAt: comment.createdAt || Date.now(),
      meta: preview ? { commentPreview: preview } : undefined,
    });
  }

  if (cur.flagCid && cur.flagCid !== prev.flagCid) {
    items = appendFlagNotification(items, cur, short);
  }

  items = appendRulingNotification(items, cur, prev, short);
  return items;
}

/** @param {UploadNotification[]} items @param {object} short @param {ReturnType<typeof snapshotForFlaggedShort>} cur @param {ReturnType<typeof snapshotForFlaggedShort>} prev */
function appendFlagEditNotification(items, short, cur, prev) {
  const cidChanged = Boolean(cur.cid && prev.cid && cur.cid !== prev.cid);
  const editedAtChanged = Boolean(cur.editedAt && cur.editedAt !== prev.editedAt);
  if (!cidChanged && !editedAtChanged) return items;
  const title = short.title || 'Untitled';
  return prependNotification(items, {
    id: `flag-edit:${short.id}:${cur.editedAt || cur.cid}`,
    type: 'flag-edit',
    shortId: short.id,
    shortTitle: title,
    actor: short.creator || null,
    createdAt: cur.editedAt || Date.now(),
  });
}

/** @param {UploadNotification[]} items @param {UploadNotification} item */
function prependNotification(items, item) {
  if (items.some((n) => n.id === item.id)) return items;
  return [item, ...items].slice(0, MAX_ITEMS);
}

/** Align diff baselines with current shorts so feed sync after reload does not re-notify. */
export function baselineNotificationSnapshots(address, shorts = listShorts()) {
  const key = addrKey(address);
  if (!key) return;
  writeSeen(address, buildSnapshot(shorts, key));
  writeFlaggerSeen(address, buildFlaggerSnapshot(shorts, key));
}

/** When a comment gets an IPFS cid, keep read state on the same inbox entry. */
export function remapCommentNotificationId(address, shortId, localCommentId, cid) {
  if (!address || !shortId || !localCommentId || !cid || localCommentId === cid) return;
  const oldId = `comment:${shortId}:${localCommentId}`;
  const newId = `comment:${shortId}:${cid}`;
  const store = readStore(address);
  let changed = false;
  const itemIdx = store.items.findIndex((n) => n.id === oldId);
  if (itemIdx >= 0) {
    store.items[itemIdx] = { ...store.items[itemIdx], id: newId };
    changed = true;
  }
  if (store.readIds.includes(oldId)) {
    store.readIds = store.readIds.filter((id) => id !== oldId);
    if (!store.readIds.includes(newId)) store.readIds.push(newId);
    changed = true;
  }
  if (changed) writeStore(address, store);
}

/**
 * @param {Array<{ id: string; creator?: string; title?: string; voters?: string[]; savers?: string[]; comments?: Array<{ id: string; by?: string; text?: string; createdAt?: number }>; moderation?: Record<string, unknown> }>} shorts
 */
export function syncUploadNotifications(address, shorts) {
  const creatorLower = addrKey(address);
  if (!creatorLower) return;

  const mine = shorts.filter((s) => s.creator?.toLowerCase() === creatorLower);
  const nextSnapshot = buildSnapshot(mine, creatorLower);
  const prevSnapshot = readSeen(address);
  const store = readStore(address);
  let items = store.items;

  if (!prevSnapshot) {
    // First run: skip old upvotes/saves/comments, but still alert for active flags & rulings.
    for (const short of mine) {
      const cur = snapshotForShort(short);
      if (cur.flagCid) {
        items = appendFlagNotification(items, cur, short);
      }
      items = appendRulingNotification(items, cur, emptyShortSnapshot(), short);
    }
    writeSeen(address, nextSnapshot);
    writeStore(address, { ...store, items });
    return;
  }

  for (const short of mine) {
    const prev = prevSnapshot[short.id] || emptyShortSnapshot();
    items = diffShortNotifications(items, short, prev, creatorLower);
  }

  // Repair: active flags must always have an inbox entry (fixes first-baseline misses).
  for (const short of mine) {
    const cur = snapshotForShort(short);
    if (cur.flagCid && cur.moderationStatus === 'voting') {
      items = appendFlagNotification(items, cur, short);
    }
  }

  writeSeen(address, nextSnapshot);
  writeStore(address, { ...store, items });
}

/**
 * Notify flaggers when a creator updates a short they flagged (still under review).
 * @param {Array<{ id: string; creator?: string; title?: string; cid?: string | null; editedAt?: number | null; moderation?: Record<string, unknown> }>} shorts
 */
export function syncFlaggerNotifications(address, shorts) {
  const flaggerLower = addrKey(address);
  if (!flaggerLower) return;

  const flagged = shorts.filter((s) => isActiveFlagger(s, flaggerLower));
  const nextSnapshot = buildFlaggerSnapshot(flagged, flaggerLower);
  const prevSnapshot = readFlaggerSeen(address);
  const store = readStore(address);
  let items = store.items;

  if (!prevSnapshot) {
    writeFlaggerSeen(address, nextSnapshot);
    writeStore(address, { ...store, items });
    return;
  }

  for (const short of flagged) {
    if (!(short.id in prevSnapshot)) continue;
    const prev = prevSnapshot[short.id];
    const cur = snapshotForFlaggedShort(short);
    items = appendFlagEditNotification(items, short, cur, prev);
  }

  writeFlaggerSeen(address, nextSnapshot);
  writeStore(address, { ...store, items });
}

/** @returns {{ items: UploadNotification[]; unreadCount: number }} */
export function getUploadNotifications(address) {
  const store = readStore(address);
  const readSet = new Set(store.readIds);
  const items = [...store.items].sort((a, b) => b.createdAt - a.createdAt);
  const unreadCount = items.filter((n) => !readSet.has(n.id)).length;
  return { items, unreadCount };
}

export function markNotificationRead(address, id) {
  if (!id) return;
  const store = readStore(address);
  if (store.readIds.includes(id)) return;
  store.readIds = [...store.readIds, id];
  writeStore(address, store);
}

export function markAllNotificationsRead(address) {
  const store = readStore(address);
  const allIds = store.items.map((n) => n.id);
  store.readIds = Array.from(new Set([...store.readIds, ...allIds]));
  writeStore(address, store);
  baselineNotificationSnapshots(address);
}

export function isNotificationRead(address, id) {
  return readStore(address).readIds.includes(id);
}
