import { listShorts, reconcileAllModeration } from '../data/storage.js';
import { ensureVideoDurations } from '../data/videoDuration.js';

/** @typedef {'disconnected' | 'connecting' | 'connected' | 'error'} WalletPhase */
/** @typedef {'recent' | 'top' | 'comments' | 'saved'} SortMode */
/** @typedef {'list' | 'create' | 'detail' | 'profile' | 'leaderboard'} View */
/** @typedef {'published' | 'upvoted' | 'commented' | 'saved'} ProfileTab */

export const state = {
  /** @type {WalletPhase} */
  walletPhase: 'disconnected',
  /** @type {`0x${string}` | null} */
  connectedAddress: null,
  /** @type {Record<string, unknown>} */
  hostContext: {},
  /** @type {{ kind: 'idle' | 'pending' | 'success' | 'error'; message: string; highlight: string | null }} */
  status: { kind: 'idle', message: '', highlight: null },
  /** @type {View} */
  view: 'list',
  /** @type {string | null} */
  selectedShortId: null,
  /** Show the flag report form on detail view (opened via 🚩). */
  /** @type {boolean} */
  flagFormOpen: false,

  // Browsing controls
  /** @type {string} */
  search: '',
  /** @type {boolean} */
  searchOpen: false,
  /** @type {string[]} */
  filterCategories: [],
  /** @type {boolean} */
  filterOpen: false,
  /** @type {string} */
  filterQuery: '',
  /** Duration filter panel open (list view). */
  /** @type {boolean} */
  durationFilterOpen: false,
  /** Selected duration range in seconds; null = no duration filter. */
  /** @type {{ min: number; max: number } | null} */
  durationFilterRange: null,
  /** @type {SortMode} */
  sort: 'recent',
  /** @type {boolean} */
  sortOpen: false,

  // Create form draft
  createDraft: {
    title: '',
    url: '',
    /** @type {string[]} */
    categories: [],
  },
  /** @type {boolean} */
  createCategoryOpen: false,
  /** @type {string} */
  createCategoryQuery: '',
  /** Focus genre search after opening the create-form dropdown. */
  /** @type {boolean} */
  focusCreateCategorySearch: false,

  /** Profile view active tab. */
  /** @type {ProfileTab} */
  profileTab: 'published',
  /** Avatar address shown on profile view (defaults to connected wallet). */
  /** @type {string | null} */
  profileAddress: null,

  /** @type {ReturnType<typeof listShorts>} */
  shorts: [],

  /** True while the cross-user feed is being fetched from Pinata + IPFS. */
  /** @type {boolean} */
  feedLoading: false,
  /** @type {string | null} */
  feedError: null,
  /** @type {number | null} */
  feedLastSyncedAt: null,

  /** Profile cache by checksum address. */
  /** @type {Record<string, { name: string | null, imageUrl: string | null, loaded: boolean }>} */
  profiles: {},

  /** How many shorts to show before lazy-loading more. */
  /** @type {number} */
  listVisibleCount: 10,

  /** Restored list scroll Y when returning from detail. */
  /** @type {number | null} */
  listScrollY: null,
  /** @type {{ scrollY: number, visibleCount: number } | null} */
  pendingListRestore: null,

  /** Saved views when opening a profile (back restores scroll + context). */
  /** @type {{ view: View, scrollY: number, selectedShortId: string | null, profileAddress: string | null, listVisibleCount: number }[]} */
  navStack: [],
  /** One-shot scroll restore after goBack(). */
  /** @type {number | null} */
  scrollRestoreY: null,
  /** Scroll profile to top on the next render (forward profile navigation). */
  /** @type {boolean} */
  scrollProfileToTop: false,

  /** Leaderboard column sort (rankings view). */
  /** @type {'total' | 'uploaded' | 'liked' | 'saved' | 'commented' | 'spentCrc' | 'earnedCrc'} */
  leaderboardSort: 'earnedCrc',

  /** Runtime cache keyed by video URL (seconds). */
  /** @type {Record<string, number | null>} */
  videoDurations: {},
};

export const LIST_PAGE_SIZE = 10;

const listeners = new Set();
const statusListeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function subscribeStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

function notifyStatus() {
  for (const fn of statusListeners) fn();
}

export function setVideoDuration(url, seconds) {
  if (!url) return;
  const value = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (state.videoDurations[url] === value) return;
  state.videoDurations[url] = value;
  notify();
}

export function refreshShorts() {
  reconcileAllModeration();
  state.shorts = listShorts();
  notify();
  void ensureVideoDurations(state.shorts, (url, seconds) => {
    setVideoDuration(url, seconds);
  });
}

export function setFeedLoading(loading) {
  state.feedLoading = Boolean(loading);
  notify();
}

export function setFeedError(message) {
  state.feedError = message || null;
  notify();
}

export function markFeedSynced() {
  state.feedLastSyncedAt = Date.now();
  state.feedError = null;
  notify();
}

export function setWalletPhase(phase) {
  state.walletPhase = phase;
  notify();
}

export function setConnectedAddress(address) {
  state.connectedAddress = address;
  notify();
}

export function applyHostContext(data) {
  state.hostContext = { ...state.hostContext, ...data };
  notify();
}

export function resetAccountScopedState() {
  setStatus('idle', '');
}

const STATUS_DISMISS_MS = 4000;
/** @type {ReturnType<typeof setTimeout> | null} */
let statusDismissTimer = null;

export function setStatus(kind, message, options = {}) {
  if (statusDismissTimer) {
    clearTimeout(statusDismissTimer);
    statusDismissTimer = null;
  }

  const highlight = kind === 'idle' ? null : options.highlight || null;
  state.status = { kind, message, highlight };
  notifyStatus();

  if (kind === 'success' || kind === 'error') {
    const captured = message;
    const capturedHighlight = highlight;
    statusDismissTimer = setTimeout(() => {
      statusDismissTimer = null;
      if (
        state.status.kind === kind &&
        state.status.message === captured &&
        state.status.highlight === capturedHighlight
      ) {
        setStatus('idle', '');
      }
    }, STATUS_DISMISS_MS);
  }
}

export function resetListPagination() {
  state.listVisibleCount = LIST_PAGE_SIZE;
}

export function loadMoreListItems() {
  state.listVisibleCount += LIST_PAGE_SIZE;
  notify();
}

function captureNavFrame() {
  return {
    view: state.view,
    scrollY: window.scrollY,
    selectedShortId: state.selectedShortId,
    profileAddress: state.profileAddress,
    listVisibleCount: state.listVisibleCount,
  };
}

function resetTransientUiState() {
  setStatus('idle', '');
  state.filterOpen = false;
  state.durationFilterOpen = false;
  state.sortOpen = false;
  state.createCategoryOpen = false;
}

export function goBack() {
  const prev = state.navStack.pop();
  if (!prev) {
    setView('list');
    return;
  }

  state.view = prev.view;
  state.selectedShortId = prev.selectedShortId;
  state.profileAddress = prev.profileAddress;
  state.listVisibleCount = prev.listVisibleCount;
  state.scrollRestoreY = prev.scrollY;
  state.flagFormOpen = false;
  resetTransientUiState();
  notify();
}

export function setView(view, selectedShortId = null, options = {}) {
  const from = state.view;

  if (from === 'list' && view === 'detail') {
    state.pendingListRestore = {
      scrollY: window.scrollY,
      visibleCount: state.listVisibleCount,
    };
  } else if (view === 'list' && from === 'detail' && state.pendingListRestore) {
    state.listVisibleCount = state.pendingListRestore.visibleCount;
    state.listScrollY = state.pendingListRestore.scrollY;
    state.pendingListRestore = null;
  } else if (!(from === 'list' && view === 'detail')) {
    resetListPagination();
    state.pendingListRestore = null;
    state.listScrollY = null;
  }

  if (view === 'profile') {
    const newAddress = options.profileAddress?.trim() || state.connectedAddress || null;
    const sameProfile =
      from === 'profile' &&
      state.profileAddress?.toLowerCase() === newAddress?.toLowerCase();
    if (!sameProfile) {
      state.navStack.push(captureNavFrame());
    }
    state.scrollProfileToTop = true;
  } else if (view === 'leaderboard' && from !== 'leaderboard') {
    state.navStack.push(captureNavFrame());
    state.scrollProfileToTop = true;
  } else if (view === 'list') {
    state.navStack = [];
  }

  state.view = view;
  state.selectedShortId = selectedShortId;
  state.flagFormOpen = view === 'detail' && Boolean(options.openFlagForm);
  if (view === 'profile') {
    state.profileAddress = options.profileAddress?.trim() || state.connectedAddress || null;
  }
  resetTransientUiState();
  if (view === 'create') {
    state.createDraft = { title: '', url: '', categories: [] };
    state.createCategoryQuery = '';
  }
  notify();
}

export function setFlagFormOpen(open) {
  state.flagFormOpen = Boolean(open);
  notify();
}

export function setProfileTab(tab) {
  if (!['published', 'upvoted', 'commented', 'saved'].includes(tab)) return;
  state.profileTab = tab;
  resetListPagination();
  notify();
}

export function setSearch(search) {
  state.search = search;
  resetListPagination();
  notify();
}

export function setSearchOpen(open) {
  state.searchOpen = Boolean(open);
  notify();
}

export function setSortOpen(open) {
  state.sortOpen = Boolean(open);
  if (state.sortOpen) {
    state.filterOpen = false;
    state.durationFilterOpen = false;
  }
  notify();
}

export function toggleFilterCategory(category) {
  const c = String(category).trim();
  if (!c) return;
  const has = state.filterCategories.some((x) => x.toLowerCase() === c.toLowerCase());
  state.filterCategories = has
    ? state.filterCategories.filter((x) => x.toLowerCase() !== c.toLowerCase())
    : [...state.filterCategories, c];
  resetListPagination();
  notify();
}

export function clearFilterCategories() {
  state.filterCategories = [];
  resetListPagination();
  notify();
}

export function setFilterOpen(open) {
  state.filterOpen = Boolean(open);
  if (state.filterOpen) {
    state.durationFilterOpen = false;
    state.sortOpen = false;
  }
  if (!state.filterOpen) state.filterQuery = '';
  notify();
}

export function setDurationFilterOpen(open) {
  state.durationFilterOpen = Boolean(open);
  if (state.durationFilterOpen) {
    state.filterOpen = false;
    state.sortOpen = false;
  }
  notify();
}

/** @param {number} min @param {number} max */
export function setDurationFilterRange(min, max) {
  let lo = Math.round(min);
  let hi = Math.round(max);
  if (lo > hi) [lo, hi] = [hi, lo];
  state.durationFilterRange = { min: lo, max: hi };
  resetListPagination();
  notify();
}

export function clearDurationFilter() {
  if (!state.durationFilterRange) return;
  state.durationFilterRange = null;
  resetListPagination();
  notify();
}

export function applyDurationFilterValues(min, max, bounds) {
  if (!bounds) return;
  const lo = Math.max(bounds.min, Math.min(min, bounds.max));
  const hi = Math.min(bounds.max, Math.max(max, bounds.min));
  if (lo <= bounds.min && hi >= bounds.max) {
    clearDurationFilter();
  } else {
    setDurationFilterRange(lo, hi);
  }
}

export function setFilterQuery(q) {
  state.filterQuery = q;
  notify();
}

export function setSort(sort) {
  if (!['recent', 'top', 'comments', 'saved'].includes(sort)) return;
  state.sort = sort;
  state.sortOpen = false;
  resetListPagination();
  notify();
}

export function setLeaderboardSort(sort) {
  const allowed = ['total', 'uploaded', 'liked', 'saved', 'commented', 'spentCrc', 'earnedCrc'];
  if (!allowed.includes(sort)) return;
  state.leaderboardSort = sort;
  notify();
}

export function setCreateDraft(patch) {
  state.createDraft = { ...state.createDraft, ...patch };
  notify();
}

export function toggleCreateCategory(category) {
  const c = String(category).trim();
  if (!c) return;
  const cats = state.createDraft.categories;
  const has = cats.some((x) => x.toLowerCase() === c.toLowerCase());
  state.createDraft = {
    ...state.createDraft,
    categories: has
      ? cats.filter((x) => x.toLowerCase() !== c.toLowerCase())
      : [...cats, c],
  };
  notify();
}

export function setCreateCategoryOpen(open) {
  const next = Boolean(open);
  if (next && !state.createCategoryOpen) {
    state.focusCreateCategorySearch = true;
  }
  state.createCategoryOpen = next;
  if (!state.createCategoryOpen) state.createCategoryQuery = '';
  notify();
}

export function setCreateCategoryQuery(q) {
  state.createCategoryQuery = q;
  notify();
}

export function setProfiles(patch) {
  state.profiles = { ...state.profiles, ...patch };
  notify();
}
