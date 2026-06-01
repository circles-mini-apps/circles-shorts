import {
  PRICE_FLAG_CRC,
  PRICE_INTERACT_CRC,
  PRICE_PUBLISH_CRC,
  getPublishPriceFor,
  comment as commentAction,
  deleteComment as deleteCommentAction,
  deleteUpload,
  flagShort,
  publishShort,
  save as saveAction,
  unsave as unsaveAction,
  updateUpload,
  upvote as upvoteAction,
  unupvote as unupvoteAction,
  voteModeration,
  withdrawFlag,
} from './actions.js';
import { formatPublishPriceLabel, PRAISE_KARMA_TIP, STRIKE_KARMA_TIP, publishPriceHint } from '../data/reputation.js';
import { isDemoMode } from '../chain/circlesTransfer.js';
import { allKnownCategories, genreDescription, submittedGenresWithCounts } from '../data/categories.js';
import { computeLeaderboard, formatLeaderboardCrc, sortLeaderboardRows } from '../data/leaderboard.js';
import { APP_NAME } from './config.js';
import { FLAG_CATEGORIES, flagCategoryLabel } from '../data/flagReasons.js';
import {
  MIN_MODERATION_VOTES,
  MODERATION_DAYS,
  countCreatorViolations,
  countProfileFlagged,
  countFlaggerWins,
  isCreatorStrike,
  isProfileFlagged,
  isFlaggerWin,
  isShortViolated,
  isShortUnderReview,
  moderationSnapshot,
} from '../data/moderation.js';
import { ensureProfilesLoaded, profileFor, profileNameFor } from '../data/profiles.js';
import {
  getUploadNotifications,
  isNotificationRead,
  markAllNotificationsRead,
  markNotificationRead,
} from '../data/notifications.js';
import { getShort, hasUpvoted, isSavedBy } from '../data/storage.js';
import {
  durationBoundsForShorts,
  getShortDurationSeconds,
} from '../data/videoDuration.js';
import {
  clearFilterCategories,
  clearDurationFilter,
  applyDurationFilterValues,
  setCreateCategoryOpen,
  setCreateCategoryQuery,
  setCreateDraft,
  setFilterOpen,
  setFilterQuery,
  setDurationFilterOpen,
  setSort,
  setSortOpen,
  setFlagFormOpen,
  setLeaderboardSort,
  setNotificationsOpen,
  setPendingWithdrawFlag,
  clearPendingWithdrawFlag,
  setPendingDeleteShort,
  clearPendingDeleteShort,
  setProfileTab,
  setSearch,
  setSearchOpen,
  setStatus,
  setView,
  goBack,
  state,
  subscribe,
  subscribeStatus,
  toggleCreateCategory,
  toggleFilterCategory,
  loadMoreListItems,
} from './state.js';
import {
  circlesProfileUrl,
  copyToClipboard,
  escapeHtml,
  shortAddress,
  timeAgo,
  truncateText,
} from '../utils/format.js';
import { formatDuration } from '../utils/duration.js';
import { limits } from '../utils/validation.js';

const FEEDBACK_URL = 'https://tally.so/r/xXlMNG';
const UPLOADED_ICON = '⬆️';

const LEADERBOARD_COLUMNS = [
  {
    key: 'earnedCrc',
    icon: '🤑',
    title: 'CRC earned',
    rankingLabel: 'Earnings',
    description: 'CRC received from upvotes and comments on their shorts',
  },
  {
    key: 'spentCrc',
    icon: '💸',
    title: 'CRC spent',
    rankingLabel: 'Spending',
    description: 'CRC paid to publish, upvote, comment, and flag',
  },
  {
    key: 'uploaded',
    icon: UPLOADED_ICON,
    title: 'Uploaded',
    rankingLabel: 'Upload',
    description: 'Shorts this user has published',
  },
  {
    key: 'liked',
    icon: '👍',
    title: 'Upvoted',
    rankingLabel: 'Upvote',
    description: 'Upvotes this user gave to other creators\' shorts',
  },
  {
    key: 'saved',
    icon: '💾',
    title: 'Saved',
    rankingLabel: 'Saved',
    description: 'Shorts this user bookmarked for free',
  },
  {
    key: 'commented',
    icon: '💬',
    title: 'Commented',
    rankingLabel: 'Comments',
    description: 'Comments this user posted on shorts',
  },
  {
    key: 'removed',
    icon: '👮',
    title: 'I removed',
    rankingLabel: 'I removed',
    description: 'Shorts this user flagged that were removed after moderation',
  },
];

function leaderboardPageTitle(sortKey) {
  const col = LEADERBOARD_COLUMNS.find((c) => c.key === sortKey) || LEADERBOARD_COLUMNS[0];
  return {
    icon: col.icon,
    label: `${col.rankingLabel} Ranking`,
  };
}

function leaderboardStatHtml(row, col, sortKey) {
  const sorted = col.key === sortKey ? ' leaderboard-stat--sorted' : '';
  if (col.key === 'spentCrc' || col.key === 'earnedCrc') {
    return `<span class="leaderboard-stat leaderboard-stat--crc${sorted}" title="${escapeHtml(col.title)}">${formatLeaderboardCrc(row[col.key])} CRC</span>`;
  }
  return `<span class="leaderboard-stat${sorted}">${row[col.key]}</span>`;
}

function leaderboardRowClass(isMe) {
  return isMe ? 'leaderboard-row-shell leaderboard-row-shell--me' : 'leaderboard-row-shell';
}

/** Rank of the connected wallet for the current sort column (1-based). */
function myLeaderboardRank(sortedRows, sortKey) {
  if (!state.connectedAddress) return null;

  const idx = sortedRows.findIndex((row) => isOwnProfileAddress(row.address));
  if (idx >= 0) return idx + 1;

  // Connected wallet with no leaderboard activity yet — rank last for this sort.
  const me = state.connectedAddress.toLowerCase();
  const withMe = sortLeaderboardRows(
    [
      ...sortedRows,
      {
        address: me,
        uploaded: 0,
        liked: 0,
        saved: 0,
        commented: 0,
        spentCrc: 0,
        earnedCrc: 0,
        removed: 0,
        total: 0,
      },
    ],
    sortKey,
  );
  const idxWithMe = withMe.findIndex((row) => row.address?.toLowerCase() === me);
  return idxWithMe >= 0 ? idxWithMe + 1 : null;
}

const SORT_PREFIX = '🔝';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Most recent', icon: '🕑' },
  { value: 'top', label: 'Most upvotes', icon: '👍' },
  { value: 'saved', label: 'Most saved', icon: '💾' },
  { value: 'comments', label: 'Most comments', icon: '💬' },
];

function sortOptionLabel(value) {
  return SORT_OPTIONS.find((o) => o.value === value)?.label || 'Sort';
}

function sortOptionIcon(value) {
  return SORT_OPTIONS.find((o) => o.value === value)?.icon || '🕑';
}

function activeProfileAddress() {
  return state.profileAddress || state.connectedAddress || '';
}

function isOwnProfileAddress(address) {
  if (!address || !state.connectedAddress) return false;
  return address.toLowerCase() === state.connectedAddress.toLowerCase();
}

/** @param {string} address @param {string} [label] */
function userProfileLinkHtml(address, label) {
  if (!address) return escapeHtml(label || '');
  const display = label || profileNameFor(address) || shortAddress(address);
  return `<button type="button" class="profile-link" data-action="go-user-profile" data-address="${escapeHtml(address)}" title="${escapeHtml(address)}">${escapeHtml(display)}</button>`;
}

function myPublishPrice() {
  if (!state.connectedAddress) return null;
  return getPublishPriceFor(state.connectedAddress);
}

function publishButtonLabel() {
  const info = myPublishPrice();
  if (!info) return `Pay ${PRICE_PUBLISH_CRC} CRC & publish`;
  if (info.isFree) return 'Publish for free';
  return `Pay ${formatPublishPriceLabel(info)} & publish`;
}

const root = () => document.getElementById('app');

function formatMinimumDuration(ms) {
  if (ms <= 0) return 'Complete';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  const mins = Math.ceil(ms / (60 * 1000));
  return `${mins}m`;
}

function flagReasonOptions() {
  return FLAG_CATEGORIES.map(
    (c) =>
      `<option value="${escapeHtml(c.value)}" title="${escapeHtml(c.description)}">${escapeHtml(c.label)}</option>`,
  ).join('');
}

function flagDisplay(flag) {
  if (flag?.category) {
    return {
      label: flagCategoryLabel(flag.category),
      text: flag.explanation || flag.reason || '',
    };
  }
  return { label: null, text: flag?.reason || '' };
}

function updateFlagCharCount(form) {
  const textarea = form.querySelector('[name="explanation"]');
  const counter = form.querySelector('[data-flag-char-count]');
  if (!textarea || !counter) return;
  const len = textarea.value.trim().length;
  const min = limits.MIN_FLAG_CHARS;
  counter.textContent = `${len} / ${min} characters minimum`;
  counter.classList.toggle('flag-char-count--ok', len >= min);
  counter.classList.toggle('flag-char-count--low', len < min);
}

function updateFlagCategoryDesc(form) {
  const select = form.querySelector('[name="category"]');
  const desc = form.querySelector('[data-flag-category-desc]');
  if (!select || !desc) return;
  const cat = FLAG_CATEGORIES.find((c) => c.value === select.value);
  desc.textContent = cat?.description || 'Select a reason to see what it covers.';
}

function updateGenreDesc(genre) {
  const desc = document.querySelector('[data-genre-desc]');
  if (!desc) return;
  const text = genre ? genreDescription(genre) : null;
  desc.textContent =
    text || (genre ? 'No description for this genre.' : 'Hover or tap a genre to see what it covers.');
}

function renderModerationPanel(s) {
  const snap = moderationSnapshot(s);
  const violated = isShortViolated(s);
  const underReview = isShortUnderReview(s);
  const me = state.connectedAddress?.toLowerCase();
  const isOwn = me && s.creator?.toLowerCase() === me;
  const flag = snap.activeFlag;

  if (violated) {
    return `
      <section class="card moderation moderation--violated">
        <h3>Removed</h3>
        <p class="muted">This short was removed after community moderation.</p>
        ${
          snap.tally
            ? `<p class="small muted">Final vote: ${snap.tally.violation} violation · ${snap.tally.clear} not violation</p>`
            : ''
        }
      </section>
    `;
  }

  if (snap.status === 'cleared' && s.moderation?.ruledAt) {
    return `
      <section class="card moderation moderation--cleared">
        <h3>Moderation cleared</h3>
        <p class="muted">Community voted this short does not violate the rules.</p>
      </section>
    `;
  }

  if (underReview && flag) {
    const flaggerName = profileNameFor(flag.flagger) || shortAddress(flag.flagger);
    const display = flagDisplay(flag);
    const isFlagger = me && flag.flagger?.toLowerCase() === me;
    const userVote = (s.moderation?.votes || []).find(
      (v) => v.flagCid === flag.cid && v.voter?.toLowerCase() === me,
    );
    const canVote = me && !isOwn && !userVote;
    const editedAfterFlag =
      typeof s.editedAt === 'number' && s.editedAt > (flag.createdAt || 0);
    const creatorBlock = isOwn
      ? `
        <div class="moderation-role-block moderation-role-block--creator">
          <p class="muted">This short was flagged. Edit your upload to address the reported issue.</p>
          <button class="btn btn--primary btn--sm" type="button" data-action="go-edit" data-id="${escapeHtml(s.id)}">Edit upload</button>
        </div>
      `
      : '';
    const flaggerBlock = isFlagger
      ? `
        <div class="moderation-role-block moderation-role-block--flagger">
          ${
            editedAfterFlag
              ? `<p class="muted">The creator updated this upload ${escapeHtml(timeAgo(s.editedAt))} after your flag.</p>`
              : '<p class="muted">The creator can edit their upload to fix the issue.</p>'
          }
          ${
            state.pendingWithdrawFlagId === s.id
              ? `<div class="actions-row moderation-withdraw-confirm">
                  <button class="btn btn--primary btn--sm" type="button" data-action="confirm-withdraw-flag" data-id="${escapeHtml(s.id)}">Confirm withdraw</button>
                  <button class="btn btn--ghost btn--sm" type="button" data-action="cancel-withdraw-flag">Cancel</button>
                </div>
                <p class="small muted">Withdraw only if the creator fixed the issue.</p>`
              : `<button class="btn btn--ghost btn--sm" type="button" data-action="withdraw-flag" data-id="${escapeHtml(s.id)}">Withdraw flag</button>`
          }
        </div>
      `
      : '';
    return `
      <section class="card moderation moderation--open" data-flag-vote>
        <div class="moderation-head">
          <h3>🚩 Under review</h3>
          <span class="chip chip--warn">Active flag</span>
        </div>
        <p class="moderation-reason-label">${display.label ? `<span class="chip chip--warn">${escapeHtml(display.label)}</span>` : ''}</p>
        <p class="moderation-reason">${escapeHtml(display.text)}</p>
        <p class="small muted">Flagged by ${escapeHtml(flaggerName)} · ${escapeHtml(timeAgo(flag.createdAt))}</p>
        ${creatorBlock}
        ${flaggerBlock}
        <div class="moderation-stats">
          <span>Violation: <strong>${snap.tally.violation}</strong></span>
          <span>Not violation: <strong>${snap.tally.clear}</strong></span>
          <span class="moderation-stats__full">
            <span>Votes: <strong>${snap.tally.total}</strong> / ${MIN_MODERATION_VOTES}</span>
            <span>Minimum Duration: <strong>${escapeHtml(formatMinimumDuration(snap.msUntilRule))}</strong></span>
          </span>
        </div>
        ${
          canVote
            ? `<div class="actions-row moderation-votes">
                <button class="btn btn--primary" type="button" data-action="vote-violation" data-id="${escapeHtml(s.id)}">Violation</button>
                <button class="btn btn--ghost" type="button" data-action="vote-clear" data-id="${escapeHtml(s.id)}">Not violation</button>
              </div>`
            : userVote
              ? `<p class="muted">You voted: ${userVote.verdict === 'violation' ? 'Violation' : 'Not violation'}.</p>`
              : isOwn || isFlagger
                ? ''
                : !me
                  ? '<p class="muted">Connect a wallet to vote.</p>'
                  : ''
        }
      </section>
    `;
  }

  if (isOwn || !me) {
    return isOwn
      ? ''
      : `<section class="card moderation">
          <p class="muted">Connect a wallet to report content.</p>
        </section>`;
  }

  if (!state.flagFormOpen || state.selectedShortId !== s.id) {
    return '';
  }

  return `
    <section class="card moderation" data-flag-report>
      <div class="moderation-head">
        <h3>Report</h3>
        <button class="btn btn--ghost btn--sm" type="button" data-action="hide-flag-form">Cancel</button>
      </div>
      <p class="small muted">Flag costs ${PRICE_FLAG_CRC} CRC. After ${MODERATION_DAYS} days, a ruling requires ${MIN_MODERATION_VOTES} votes — if not reached, voting stays open until it is.</p>
      <form class="flag-form" data-action="submit-flag" data-id="${escapeHtml(s.id)}">
        <label class="form-label" for="flag-category">Reason</label>
        <select class="input" id="flag-category" name="category" required data-focus-key="flag-category">
          <option value="">Select a reason…</option>
          ${flagReasonOptions()}
        </select>
        <p class="small muted flag-category-desc" data-flag-category-desc>Select a reason to see what it covers.</p>
        <label class="form-label" for="flag-explanation">Your reasoning</label>
        <textarea
          class="input"
          id="flag-explanation"
          name="explanation"
          rows="4"
          maxlength="${limits.MAX_FLAG}"
          placeholder="Explain why you selected this reason (at least ${limits.MIN_FLAG_CHARS} characters)…"
          data-focus-key="flag-explanation"
          required
        ></textarea>
        <p class="small flag-char-count flag-char-count--low" data-flag-char-count>0 / ${limits.MIN_FLAG_CHARS} characters minimum</p>
        <button class="btn btn--ghost" type="submit">🚩 Flag (${PRICE_FLAG_CRC} CRC)</button>
      </form>
    </section>
  `;
}

function scrollToModerationSection(selector) {
  requestAnimationFrame(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function scrollToFlagReport() {
  scrollToModerationSection('[data-flag-report]');
}

function scrollToFlagVote() {
  scrollToModerationSection('[data-flag-vote]');
}

function scrollToComments() {
  scrollToModerationSection('[data-comment-section]');
}

let listLazyObserver = null;
let videoLazyObserver = null;

function captureFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const key = el.dataset?.focusKey;
  if (!key) return null;
  const start = 'selectionStart' in el ? el.selectionStart : null;
  const end = 'selectionEnd' in el ? el.selectionEnd : null;
  return { key, start, end };
}

function restoreFocus(snap) {
  if (!snap) return;
  const el = document.querySelector(`[data-focus-key="${CSS.escape(snap.key)}"]`);
  if (!el) return;
  el.focus();
  if (snap.start != null && typeof el.setSelectionRange === 'function') {
    try {
      el.setSelectionRange(snap.start, snap.end ?? snap.start);
    } catch {
      /* some input types don't support setSelectionRange */
    }
  }
}

function visibleAddresses() {
  const out = new Set();
  if (state.view === 'list') {
    for (const s of state.shorts) out.add(s.creator);
  } else if (state.view === 'detail') {
    const s = getShort(state.selectedShortId);
    if (s) {
      out.add(s.creator);
      for (const c of s.comments || []) out.add(c.by);
    }
  } else if (state.view === 'profile') {
    const addr = activeProfileAddress();
    if (addr) out.add(addr);
    for (const s of profileShorts()) out.add(s.creator);
  } else if (state.view === 'leaderboard') {
    for (const row of computeLeaderboard(state.shorts)) out.add(row.address);
  }
  return Array.from(out);
}

/** @type {Map<string, { iframe: HTMLIFrameElement; expanded: boolean }>} */
let preservedPlayers = new Map();
let lastRenderedView = null;
/** @type {string | null} */
let lastRenderedShortId = null;

function captureLoadedPlayers() {
  preservedPlayers = new Map();
  for (const player of document.querySelectorAll('.player[data-short-id]')) {
    const id = player.dataset.shortId;
    const iframe = player.querySelector('.player-media iframe');
    if (!id || !iframe) continue;
    iframe.remove();
    preservedPlayers.set(id, {
      iframe,
      expanded: player.classList.contains('player--expanded'),
    });
  }
}

function restoreLoadedPlayers() {
  if (preservedPlayers.size === 0) return;
  for (const [id, { iframe, expanded }] of preservedPlayers) {
    const player = document.querySelector(
      `.player[data-short-id="${CSS.escape(id)}"]`,
    );
    if (!player) continue;
    const media = player.querySelector('.player-media');
    if (!media) continue;
    media.replaceChildren(iframe);
    player.dataset.loaded = '1';
    if (expanded) setPlayerExpanded(player, true);
  }
  preservedPlayers.clear();
}

/** Persistent host outside #app so rerenders never wipe snackbars. */
let snackbarHost = null;

function ensureSnackbarHost() {
  if (!snackbarHost) {
    snackbarHost = document.createElement('div');
    snackbarHost.id = 'snackbar-host';
    document.body.appendChild(snackbarHost);
  }
  return snackbarHost;
}

function updateStatusBanner() {
  ensureSnackbarHost().innerHTML = statusBanner();
}

function rerender() {
  const el = root();
  if (!el) return;
  const navigatedToDetail =
    state.view === 'detail' &&
    (lastRenderedView !== 'detail' || lastRenderedShortId !== state.selectedShortId);
  lastRenderedView = state.view;
  lastRenderedShortId = state.selectedShortId;

  captureLoadedPlayers();
  clearPlayerExpanded();
  const snap = captureFocus();
  el.innerHTML = renderApp();
  bindEvents();
  restoreLoadedPlayers();
  setupLazyObservers();
  restoreFocus(snap);
  if (state.focusCreateCategorySearch) {
    state.focusCreateCategorySearch = false;
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-focus-key="create-cat-query"]');
      input?.focus();
    });
  }
  const addrs = visibleAddresses();
  if (addrs.length) {
    ensureProfilesLoaded(addrs);
  }

  if (navigatedToDetail || state.scrollProfileToTop) {
    state.scrollProfileToTop = false;
    window.scrollTo(0, 0);
  } else if (state.scrollRestoreY != null) {
    const y = state.scrollRestoreY;
    state.scrollRestoreY = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
    });
  } else if (state.view === 'list' && state.listScrollY != null) {
    const y = state.listScrollY;
    state.listScrollY = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
    });
  }
}

function formatStatusMessage({ message, highlight }) {
  if (!highlight || !message.includes(highlight)) {
    return escapeHtml(message);
  }
  const idx = message.indexOf(highlight);
  const before = escapeHtml(message.slice(0, idx));
  const name = escapeHtml(highlight);
  const after = escapeHtml(message.slice(idx + highlight.length));
  return `${before}<strong class="snackbar-highlight">${name}</strong>${after}`;
}

function statusBanner() {
  const { status } = state;
  if (status.kind === 'idle' || !status.message) return '';
  return `<div class="snackbar snackbar--${status.kind}" role="status" aria-live="polite">${formatStatusMessage(status)}</div>`;
}

function paginateShorts(shorts) {
  const total = shorts.length;
  const visible = Math.min(state.listVisibleCount, total);
  return {
    slice: shorts.slice(0, visible),
    hasMore: visible < total,
    visible,
    total,
  };
}

function renderShortList(shorts, { emptyHtml = '' } = {}) {
  if (shorts.length === 0) return emptyHtml;
  const { slice, hasMore, visible, total } = paginateShorts(shorts);
  const cards = slice.map(shortCard).join('');
  const sentinel = hasMore
    ? `<div class="list-sentinel muted" data-lazy-sentinel aria-hidden="true">Showing ${visible} of ${total}…</div>`
    : '';
  return cards + sentinel;
}

function setupLazyObservers() {
  if (listLazyObserver) {
    listLazyObserver.disconnect();
    listLazyObserver = null;
  }
  if (videoLazyObserver) {
    videoLazyObserver.disconnect();
    videoLazyObserver = null;
  }

  const sentinel = document.querySelector('[data-lazy-sentinel]');
  if (sentinel) {
    listLazyObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          loadMoreListItems();
        }
      },
      { rootMargin: '240px' },
    );
    listLazyObserver.observe(sentinel);
  }

  const players = document.querySelectorAll('.lazy-player:not([data-loaded])');
  if (players.length) {
    videoLazyObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          const src = el.dataset.embed;
          if (!src || el.dataset.loaded) continue;
          el.dataset.loaded = '1';
          const media = el.querySelector('.player-media');
          if (media) media.innerHTML = iframeHtml(src);
          videoLazyObserver?.unobserve(el);
        }
      },
      { rootMargin: '120px' },
    );
    players.forEach((el) => videoLazyObserver.observe(el));
  }
}

function listShortCount() {
  return state.shorts.filter((s) => s.moderation?.status !== 'violated').length;
}

const NOTIFICATION_ICONS = {
  upvote: '👍',
  save: '💾',
  comment: '💬',
  flag: '🚩',
  ruling: '⚖️',
  'flag-edit': '✏️',
};

function notificationMessage(n) {
  const title = n.shortTitle || 'your short';
  const actor = n.actor ? profileNameFor(n.actor) || shortAddress(n.actor) : null;
  switch (n.type) {
    case 'upvote':
      return `${actor || 'Someone'} upvoted “${title}”`;
    case 'save':
      return `${actor || 'Someone'} saved “${title}”`;
    case 'comment':
      return `${actor || 'Someone'} commented on “${title}”`;
    case 'flag':
      return actor ? `“${title}” was flagged by ${actor}` : `“${title}” was flagged for review`;
    case 'ruling':
      return n.meta?.verdict === 'violation'
        ? `“${title}” was removed after moderation`
        : `“${title}” was cleared after moderation`;
    case 'flag-edit':
      return actor
        ? `${actor} updated “${title}” after your flag`
        : `The creator updated “${title}” after your flag`;
    default:
      return `Activity on “${title}”`;
  }
}

function notificationsPanelHtml() {
  if (!state.connectedAddress) return '';
  const { items, unreadCount } = getUploadNotifications(state.connectedAddress);
  const open = state.notificationsOpen;
  const badge =
    unreadCount > 0
      ? `<span class="notify-badge" aria-hidden="true">${unreadCount > 99 ? '99+' : unreadCount}</span>`
      : '';
  const list =
    items.length === 0
      ? '<p class="notify-empty muted">No notifications yet. You\'ll be notified about activity on your uploads and edits to shorts you flagged.</p>'
      : `<ul class="notify-list">${items
          .map((n) => {
            const unread = !isNotificationRead(state.connectedAddress, n.id);
            const preview =
              n.type === 'comment' && n.meta?.commentPreview
                ? `<span class="notify-preview">${escapeHtml(n.meta.commentPreview)}</span>`
                : '';
            return `
              <li>
                <button
                  type="button"
                  class="notify-item${unread ? ' notify-item--unread' : ''}"
                  data-action="open-notification"
                  data-id="${escapeHtml(n.id)}"
                  data-short-id="${escapeHtml(n.shortId)}"
                >
                  <span class="notify-item-icon" aria-hidden="true">${NOTIFICATION_ICONS[n.type] || '🔔'}</span>
                  <span class="notify-item-body">
                    <span class="notify-item-text">${escapeHtml(notificationMessage(n))}</span>
                    ${preview}
                    <span class="notify-item-time muted">${escapeHtml(timeAgo(n.createdAt))}</span>
                  </span>
                </button>
              </li>
            `;
          })
          .join('')}</ul>`;
  const markAll =
    unreadCount > 0
      ? `<button type="button" class="btn btn--ghost btn--sm notify-mark-all" data-action="mark-all-notifications-read">Mark all read</button>`
      : '';

  return `
    <div class="notify-wrap">
      <button
        type="button"
        class="notify-btn${open ? ' notify-btn--active' : ''}${unreadCount ? ' notify-btn--unread' : ''}"
        data-action="toggle-notifications"
        aria-label="Notifications${unreadCount ? `, ${unreadCount} unread` : ''}"
        aria-expanded="${open}"
        title="Notifications"
      >
        <span class="notify-bell" aria-hidden="true">🔔</span>
        ${badge}
      </button>
      ${
        open
          ? `
        <button
          type="button"
          class="notify-backdrop"
          data-action="close-notifications"
          aria-label="Close notifications"
          tabindex="-1"
        ></button>
        <div class="notify-panel dropdown" id="notify-dd" role="dialog" aria-label="Notifications">
          <div class="notify-panel-head">
            <span class="notify-panel-title">Notifications</span>
            ${markAll}
          </div>
          ${list}
        </div>
      `
          : ''
      }
    </div>
  `;
}

function header() {
  const n = listShortCount();
  const countLabel = `${n} short${n === 1 ? '' : 's'}`;
  const demo = isDemoMode() ? '<span class="badge">demo · no CRC</span>' : '';

  let walletBtn;
  if (state.connectedAddress) {
    const me = profileFor(state.connectedAddress);
    const initial = ((me?.name || state.connectedAddress).trim().charAt(0) || '?').toUpperCase();
    const avatar = me?.imageUrl
      ? `<img class="avatar avatar--xs" src="${escapeHtml(me.imageUrl)}" alt="" />`
      : `<span class="avatar avatar--xs avatar--placeholder" aria-hidden="true">${escapeHtml(initial)}</span>`;
    const label = me?.name || shortAddress(state.connectedAddress);
    const onOwnProfile =
      state.view === 'profile' && isOwnProfileAddress(activeProfileAddress());
    walletBtn = `
      <button
        class="wallet-btn ${onOwnProfile ? 'wallet-btn--active' : ''}"
        type="button"
        data-action="go-profile"
        title="${escapeHtml(state.connectedAddress)}"
        aria-label="My profile"
      >
        ${avatar}
        <span class="wallet-btn-label">${escapeHtml(label)}</span>
      </button>
    `;
  } else {
    walletBtn = `<span class="wallet wallet--off"><span class="wallet-off-long">Wallet disconnected</span><span class="wallet-off-short">Offline</span></span>`;
  }

  return `
    <header class="topbar">
      <div class="brand">
        <button class="brand-btn" data-action="go-list" type="button">${APP_NAME}</button>
        <span class="brand-meta muted">${escapeHtml(countLabel)} · community mini app</span>
        ${demo}
      </div>
      <div class="topbar-right">${notificationsPanelHtml()}${walletBtn}</div>
    </header>
  `;
}

function renderDropdown({
  id,
  options,
  selected,
  query,
  queryKey,
  toggleAction,
  allowAdd,
  describeGenres = false,
  optionCounts = null,
  emptyLabel = 'No genres match',
}) {
  const q = query.trim().toLowerCase();
  const selectedLower = selected.map((s) => s.toLowerCase());
  const filtered = q ? options.filter((c) => c.toLowerCase().includes(q)) : options;
  const items = filtered
    .map((c) => {
      const on = selectedLower.includes(c.toLowerCase());
      const desc = describeGenres ? genreDescription(c) : null;
      const titleAttr = desc ? ` title="${escapeHtml(desc)}"` : '';
      const genreAttr = describeGenres ? ` data-genre="${escapeHtml(c)}"` : '';
      const count = optionCounts?.[c];
      const countHtml =
        count != null ? `<span class="dd-item-count muted">${count}</span>` : '';
      return `
        <button
          type="button"
          class="dd-item${on ? ' dd-item--on' : ''}"
          data-action="${toggleAction}"
          data-cat="${escapeHtml(c)}"${genreAttr}${titleAttr}
        >
          <span class="dd-check" aria-hidden="true">${on ? '✓' : ''}</span>
          <span class="dd-item-label">${escapeHtml(c)}</span>
          ${countHtml}
        </button>
      `;
    })
    .join('');

  const addBlock =
    allowAdd && q && !options.includes(q)
      ? `<button
            type="button"
            class="dd-item dd-item--add"
            data-action="${toggleAction}"
            data-cat="${escapeHtml(q)}"
          >+ Add "${escapeHtml(q)}"</button>`
      : '';

  const emptyBlock =
    !items && !addBlock
      ? `<div class="dd-empty muted">${escapeHtml(emptyLabel)}</div>`
      : '';

  return `
    <div class="dropdown" id="${id}">
      <div class="dd-search">
        <input
          class="input"
          type="search"
          placeholder="Search genres…"
          value="${escapeHtml(query)}"
          data-action="${queryKey}"
          data-focus-key="${queryKey}"
          autocomplete="off"
        />
      </div>
      <div class="dd-list">
        ${addBlock}
        ${items}
        ${emptyBlock}
      </div>
    </div>
  `;
}

function renderSortDropdown() {
  const items = SORT_OPTIONS.map(
    (opt) => `
      <button
        type="button"
        class="dd-item${state.sort === opt.value ? ' dd-item--on' : ''}"
        data-action="set-sort"
        data-sort="${opt.value}"
      >
        <span class="dd-check" aria-hidden="true">${state.sort === opt.value ? '✓' : ''}</span>
        <span class="dd-item-icon" aria-hidden="true">${opt.icon}</span>
        <span class="dd-item-label">${escapeHtml(opt.label)}</span>
      </button>
    `,
  ).join('');

  return `
    <div class="dropdown dropdown--sort" id="sort-dd">
      <div class="dd-list">${items}</div>
    </div>
  `;
}

function categoryBadges(selected, removeAction, { showGenreTitles = false } = {}) {
  if (!selected.length) return '';
  return `
    <div class="chips chips--sm">
      ${selected
        .map((c) => {
          const desc = showGenreTitles ? genreDescription(c) : null;
          const titleAttr = desc ? ` title="${escapeHtml(desc)}"` : '';
          return `
            <button
              type="button"
              class="chip chip--on chip--removable"
              data-action="${removeAction}"
              data-cat="${escapeHtml(c)}"${titleAttr}
            >${escapeHtml(c)} ✕</button>
          `;
        })
        .join('')}
    </div>
  `;
}

function youtubeEmbed(videoId) {
  if (!videoId) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&fs=1`;
}

const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';

function iframeHtml(src) {
  return `<iframe src="${escapeHtml(src)}" allow="${IFRAME_ALLOW}" allowfullscreen loading="lazy" title="Video player"></iframe>`;
}

function videoPlayerHtml({
  embed,
  variant = 'sm',
  lazy = false,
  shortId = null,
  videoUrl = null,
  controlsExtra = '',
}) {
  const variantClass = variant === 'bleed' ? 'player--bleed' : 'player--sm';
  const lazyClass = lazy ? ' lazy-player' : '';
  const lazyAttr = lazy ? ` data-embed="${escapeHtml(embed)}"` : '';
  const shortIdAttr = shortId ? ` data-short-id="${escapeHtml(shortId)}"` : '';
  const mediaContent = lazy
    ? '<div class="player-skeleton" aria-hidden="true"></div>'
    : iframeHtml(embed);
  const copyBtn = videoUrl
    ? `<a class="video-link player-copy-btn" href="${escapeHtml(videoUrl)}" title="Copy video link" aria-label="Copy video link">🔗</a>`
    : '';

  return `
    <div class="player ${variantClass}${lazyClass}"${lazyAttr}${shortIdAttr}>
      <div class="player-media">${mediaContent}</div>
      <div class="player-controls">
        <button type="button" class="player-fs-btn" data-action="player-fullscreen" aria-label="Fullscreen" title="Fullscreen">⛶</button>
        ${copyBtn}${controlsExtra}
      </div>
    </div>
  `;
}

function videoLinkHtml(url, { className = 'video-link', label = 'Copy video link' } = {}) {
  return `<a class="${className}" href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

let expandedPlayer = null;

function updatePlayerFsButton(player, mode) {
  const btn = player.querySelector('[data-action="player-fullscreen"]');
  if (!btn) return;
  if (mode === 'exit') {
    btn.textContent = '✕';
    btn.setAttribute('aria-label', 'Exit fullscreen');
    btn.title = 'Exit fullscreen';
  } else {
    btn.textContent = '⛶';
    btn.setAttribute('aria-label', 'Fullscreen');
    btn.title = 'Fullscreen';
  }
}

function setPlayerExpanded(player, expanded) {
  if (expanded) {
    if (expandedPlayer && expandedPlayer !== player) {
      setPlayerExpanded(expandedPlayer, false);
    }
    player.classList.add('player--expanded');
    document.body.classList.add('player-expanded-active');
    expandedPlayer = player;
    updatePlayerFsButton(player, 'exit');
  } else {
    player.classList.remove('player--expanded');
    if (!document.querySelector('.player--expanded')) {
      document.body.classList.remove('player-expanded-active');
    }
    if (expandedPlayer === player) expandedPlayer = null;
    updatePlayerFsButton(player, 'enter');
  }
}

function clearPlayerExpanded() {
  if (expandedPlayer) {
    expandedPlayer.classList.remove('player--expanded');
    expandedPlayer = null;
  }
  document.body.classList.remove('player-expanded-active');
}

async function togglePlayerFullscreen(player) {
  const isExpanded = player.classList.contains('player--expanded');
  const isNativeFs = document.fullscreenElement === player;

  if (isExpanded || isNativeFs) {
    setPlayerExpanded(player, false);
    if (isNativeFs) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (document.fullscreenEnabled) {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await player.requestFullscreen();
      updatePlayerFsButton(player, 'exit');
      return;
    } catch {
      /* miniapp host often blocks native fullscreen — use in-app expand */
    }
  }

  setPlayerExpanded(player, true);
}

function handlePlayerExpandEscape(e) {
  if (e.key !== 'Escape') return;
  if (expandedPlayer) {
    void togglePlayerFullscreen(expandedPlayer);
    return;
  }
  const nativeFs = document.fullscreenElement;
  if (nativeFs?.classList?.contains('player')) {
    void togglePlayerFullscreen(nativeFs);
  }
}

function handlePlayerNativeFullscreenChange() {
  document.querySelectorAll('.player').forEach((player) => {
    if (player.classList.contains('player--expanded')) return;
    updatePlayerFsButton(player, document.fullscreenElement === player ? 'exit' : 'enter');
  });
}

let playerFsInstalled = false;

function setupPlayerFullscreen() {
  if (playerFsInstalled) return;
  playerFsInstalled = true;
  document.addEventListener('keydown', handlePlayerExpandEscape);
  document.addEventListener('fullscreenchange', handlePlayerNativeFullscreenChange);
}

function videoEmbedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.toLowerCase();
    if (h === 'youtu.be') return youtubeEmbed(u.pathname.slice(1));
    if (h.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return youtubeEmbed(v);
      if (u.pathname.startsWith('/embed/')) {
        return youtubeEmbed(u.pathname.replace('/embed/', ''));
      }
      if (u.pathname.startsWith('/shorts/')) {
        return youtubeEmbed(u.pathname.replace('/shorts/', '').split('/')[0]);
      }
    }
    if (h.endsWith('vimeo.com') && /^\/\d+/.test(u.pathname)) {
      return `https://player.vimeo.com/video${u.pathname}?title=0&byline=0&portrait=0`;
    }
    if (h.endsWith('streamable.com')) {
      return `https://streamable.com/e${u.pathname}`;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function applyShortFilters(list, { search = true } = {}) {
  const q = state.search.trim().toLowerCase();
  const cats = state.filterCategories.map((c) => c.toLowerCase());
  let out = [...list];
  if (search && q) {
    out = out.filter((s) => s.title.toLowerCase().includes(q));
  }
  if (cats.length) {
    out = out.filter((s) => {
      const shortCats = (s.categories || []).map((x) => x.toLowerCase());
      return cats.every((c) => shortCats.includes(c));
    });
  }
  const durationRange = state.durationFilterRange;
  if (durationRange) {
    out = out.filter((s) => {
      const d = getShortDurationSeconds(s, state.videoDurations);
      if (d == null) return false;
      return d >= durationRange.min && d <= durationRange.max;
    });
  }
  if (state.sort === 'top') {
    out.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0) || b.createdAt - a.createdAt);
  } else if (state.sort === 'saved') {
    out.sort((a, b) => (b.saves || 0) - (a.saves || 0) || b.createdAt - a.createdAt);
  } else if (state.sort === 'comments') {
    out.sort(
      (a, b) =>
        (b.comments?.length || 0) - (a.comments?.length || 0) || b.createdAt - a.createdAt,
    );
  } else {
    out.sort((a, b) => b.createdAt - a.createdAt);
  }
  return out;
}

function filterShorts() {
  let list = [...state.shorts];
  if (state.view === 'list') {
    list = list.filter((s) => s.moderation?.status !== 'violated');
  }
  return applyShortFilters(list);
}

function renderCardFlagBtn(s, { underReview, isOwn, violated, onDetail = false, inPlayer = false }) {
  const flagTitle = underReview
    ? 'Under moderation review — tap to vote'
    : isOwn
      ? 'You cannot flag your own short'
      : violated
        ? 'This short was removed'
        : !state.connectedAddress
          ? 'Connect wallet to report'
          : 'Report this short';
  let action = 'open-flag';
  if (underReview) action = onDetail ? 'scroll-to-vote' : 'open-vote';
  else if (onDetail) action = 'show-flag-form';

  const actionAttr = action ? `data-action="${action}"` : '';
  const disabled = violated || (isOwn && !underReview);
  const baseClass = inPlayer ? 'player-flag-btn' : 'card-flag-btn';
  const flagClass = underReview ? ` ${baseClass}--active` : ` ${baseClass}--idle`;

  return `
    <button
      type="button"
      class="${baseClass}${flagClass}"
      ${actionAttr}
      data-id="${escapeHtml(s.id)}"
      ${disabled ? 'disabled' : ''}
      title="${escapeHtml(flagTitle)}"
      aria-label="${escapeHtml(flagTitle)}"
    >🚩</button>
  `;
}

function shortDurationSeconds(s) {
  return getShortDurationSeconds(s, state.videoDurations);
}

function shortsForDurationBounds() {
  return state.shorts.filter((s) => s.moderation?.status !== 'violated');
}

function durationFilterBounds() {
  const shorts =
    state.view === 'profile' ? profileShortsBase() : shortsForDurationBounds();
  return durationBoundsForShorts(shorts, state.videoDurations);
}

function isDurationFilterActive(bounds) {
  if (!bounds || !state.durationFilterRange) return false;
  return (
    state.durationFilterRange.min > bounds.min || state.durationFilterRange.max < bounds.max
  );
}

function effectiveDurationSliderRange(bounds) {
  if (!bounds) return null;
  if (!state.durationFilterRange) {
    return { min: bounds.min, max: bounds.max };
  }
  return {
    min: Math.max(bounds.min, Math.min(state.durationFilterRange.min, bounds.max)),
    max: Math.min(bounds.max, Math.max(state.durationFilterRange.max, bounds.min)),
  };
}

function renderDurationFilterDropdown(bounds) {
  if (!bounds) {
    return `
      <div class="dropdown duration-filter-dd" id="duration-filter-dd">
        <p class="duration-filter-empty muted">No duration data yet. Lengths appear after videos load.</p>
      </div>
    `;
  }

  const range = effectiveDurationSliderRange(bounds);
  const minLabel = formatDuration(range.min) || '0:00';
  const maxLabel = formatDuration(range.max) || '0:00';
  const active = isDurationFilterActive(bounds);
  const span = bounds.max - bounds.min || 1;
  const fillLeft = ((range.min - bounds.min) / span) * 100;
  const fillWidth = ((range.max - range.min) / span) * 100;

  return `
    <div class="dropdown duration-filter-dd" id="duration-filter-dd">
      <div class="duration-range-wrap">
        <div class="duration-filter-row">
          <div class="duration-filter-values" aria-live="polite">${escapeHtml(minLabel)} – ${escapeHtml(maxLabel)}</div>
          ${
            active
              ? `<button class="btn btn--ghost btn--sm duration-filter-reset" type="button" data-action="clear-duration-filter">Reset</button>`
              : ''
          }
        </div>
        <div class="duration-range-track">
          <div class="duration-range-rail" aria-hidden="true"></div>
          <div
            class="duration-range-fill"
            data-duration-range-fill
            style="left: ${fillLeft}%; width: ${fillWidth}%;"
          ></div>
          <input
            type="range"
            class="duration-range-input duration-range-input--min"
            min="${bounds.min}"
            max="${bounds.max}"
            value="${range.min}"
            step="1"
            data-action="duration-filter-min"
            aria-label="Minimum duration"
          />
          <input
            type="range"
            class="duration-range-input duration-range-input--max"
            min="${bounds.min}"
            max="${bounds.max}"
            value="${range.max}"
            step="1"
            data-action="duration-filter-max"
            aria-label="Maximum duration"
          />
        </div>
      </div>
    </div>
  `;
}

function shortTitleWithDurationHtml(s) {
  const label = formatDuration(shortDurationSeconds(s));
  const durationHtml = label
    ? `<span class="short-duration muted"> (${escapeHtml(label)})</span>`
    : '';
  return `${escapeHtml(s.title)}${durationHtml}`;
}

function saveButtonHtml(s, { action = 'card-save' } = {}) {
  const saved = isSavedBy(s, state.connectedAddress);
  const isOwn =
    state.connectedAddress && s.creator.toLowerCase() === state.connectedAddress.toLowerCase();
  const saveTitle = !state.connectedAddress
    ? 'Connect wallet to save'
    : saved
      ? 'Unsave (CRC not refunded)'
      : isOwn
        ? 'Save your short for free'
        : 'Save for free';
  return `
    <button
      type="button"
      class="btn btn--icon${saved ? ' btn--saved' : ''}"
      data-action="${action}"
      data-id="${escapeHtml(s.id)}"
      ${!state.connectedAddress ? 'disabled' : ''}
      title="${escapeHtml(saveTitle)}"
    >💾 <span class="count">${s.saves || 0}</span></button>
  `;
}

function upvoteButtonHtml(s, { action = 'card-upvote' } = {}) {
  const isOwn =
    state.connectedAddress && s.creator.toLowerCase() === state.connectedAddress.toLowerCase();
  const upvoted = hasUpvoted(s, state.connectedAddress);
  const violated = isShortViolated(s);
  const upvoteTitle = isOwn
    ? 'You cannot upvote your own short'
    : upvoted
      ? 'Remove upvote (CRC not refunded)'
      : `Pay ${PRICE_INTERACT_CRC} CRC to upvote`;
  return `
    <button
      type="button"
      class="btn btn--icon${upvoted ? ' btn--upvoted' : ''}"
      data-action="${action}"
      data-id="${escapeHtml(s.id)}"
      ${isOwn || violated || !state.connectedAddress ? 'disabled' : ''}
      title="${escapeHtml(upvoteTitle)}"
    >👍 <span class="count">${s.upvotes || 0}</span></button>
  `;
}

function shortCardActionsHtml(s) {
  return `
    <div class="card-actions">
      ${upvoteButtonHtml(s)}
      ${saveButtonHtml(s)}
      <button
        type="button"
        class="btn btn--icon"
        data-action="card-comment"
        data-id="${escapeHtml(s.id)}"
        title="Open comments"
      >💬 <span class="count">${s.comments?.length || 0}</span></button>
    </div>
  `;
}

function shortCard(s) {
  const cats = (s.categories || [])
    .map((c) => `<span class="chip chip--sm">${escapeHtml(c)}</span>`)
    .join('');
  const embed = videoEmbedUrl(s.url);
  const violated = isShortViolated(s);
  const underReview = isShortUnderReview(s);
  const isOwn =
    state.connectedAddress && s.creator.toLowerCase() === state.connectedAddress.toLowerCase();
  const flagBtn = renderCardFlagBtn(s, {
    underReview,
    isOwn,
    violated,
    inPlayer: Boolean(embed),
  });
  const player = embed
    ? videoPlayerHtml({
        embed,
        variant: 'sm',
        lazy: true,
        shortId: s.id,
        videoUrl: s.url,
        controlsExtra: flagBtn,
      })
    : `<div class="player-link-row">${videoLinkHtml(s.url, { className: 'video-link player-link' })}${flagBtn}</div>`;

  const name = profileNameFor(s.creator);
  const byLabel = name || shortAddress(s.creator);
  const byHtml = userProfileLinkHtml(s.creator, byLabel);
  const removedBadge =
    violated && state.view === 'profile'
      ? `<span class="chip chip--warn">Removed</span>`
      : '';
  const showEdit = isOwn && state.view === 'profile' && state.profileTab === 'published';
  const editBtn = showEdit
    ? `<button type="button" class="btn btn--ghost btn--sm short-edit-btn" data-action="go-edit" data-id="${escapeHtml(s.id)}" title="Edit">Edit</button>`
    : '';

  return `
    <article class="card short-card${violated ? ' short-card--violated' : ''}${isOwn ? ' short-card--own' : ''}">
      <div class="short-card-media">
        ${player}
      </div>
      <div class="short-body">
        <div class="short-title-row">
          <h3 class="short-title clickable" data-action="go-detail" data-id="${escapeHtml(s.id)}">${shortTitleWithDurationHtml(s)}</h3>
          ${removedBadge}
          ${editBtn}
        </div>
        <div class="short-sub muted">by ${byHtml} · ${escapeHtml(timeAgo(s.createdAt))}</div>
        <div class="chips chips--sm">${cats}</div>
        ${shortCardActionsHtml(s)}
      </div>
    </article>
  `;
}

const FLAGGED_PROFILE_TIP = 'Shorts you flagged and your uploads that were flagged. Tap to view them all.';

function profileShortsBase() {
  const me = activeProfileAddress().toLowerCase();
  if (!me) return [];
  const all = state.shorts;
  if (state.profileTab === 'published') {
    return all.filter((s) => s.creator?.toLowerCase() === me);
  }
  if (state.profileTab === 'upvoted') {
    return all.filter(
      (s) =>
        s.creator?.toLowerCase() !== me &&
        (s.voters || []).some((v) => v?.toLowerCase() === me),
    );
  }
  if (state.profileTab === 'saved') {
    return all.filter((s) => (s.savers || []).some((v) => v?.toLowerCase() === me));
  }
  if (state.profileTab === 'strikes') {
    return all.filter((s) => isCreatorStrike(s, me));
  }
  if (state.profileTab === 'flagged') {
    return all.filter((s) => isProfileFlagged(s, me));
  }
  if (state.profileTab === 'praise') {
    return all.filter((s) => isFlaggerWin(s, me));
  }
  return all.filter((s) => (s.comments || []).some((c) => c.by?.toLowerCase() === me));
}

function profileShorts() {
  return applyShortFilters(profileShortsBase(), { search: false });
}

function renderBrowseControls({ genreShorts, durationShorts, showSearch = false, publishTitle = '' }) {
  const filterCount = state.filterCategories.length;
  const searchActive = Boolean(state.search.trim());
  const sortLabel = sortOptionLabel(state.sort);
  const sortIcon = sortOptionIcon(state.sort);
  const genreRows = submittedGenresWithCounts(genreShorts);
  const filterGenres = genreRows.map((r) => r.genre);
  const genreCounts = Object.fromEntries(genreRows.map((r) => [r.genre, r.count]));
  const durationBounds = durationBoundsForShorts(durationShorts, state.videoDurations);
  const durationFilterActive = isDurationFilterActive(durationBounds);
  const filterDropdown = state.filterOpen
    ? renderDropdown({
        id: 'filter-dd',
        options: filterGenres,
        selected: state.filterCategories,
        query: state.filterQuery,
        queryKey: 'filter-query',
        toggleAction: 'toggle-filter-cat',
        allowAdd: false,
        optionCounts: genreCounts,
        emptyLabel: filterGenres.length ? 'No genres match' : 'No genres published yet',
      })
    : '';
  const durationDropdown = state.durationFilterOpen
    ? renderDurationFilterDropdown(durationBounds)
    : '';
  const sortDropdown = state.sortOpen ? renderSortDropdown() : '';

  const searchBar =
    showSearch && state.searchOpen
      ? `
      <div class="search-row">
        <input
          class="input"
          type="search"
          placeholder="Search by title…"
          value="${escapeHtml(state.search)}"
          data-action="search"
          data-focus-key="title-search"
          autocomplete="off"
        />
        ${
          searchActive
            ? `<button class="btn btn--ghost btn--icon" type="button" data-action="clear-search" title="Clear search">✕</button>`
            : ''
        }
      </div>
    `
      : '';

  return `
    <section class="toolbar toolbar--icons">
      ${
        showSearch
          ? `<button
        class="btn btn--icon ${state.searchOpen || searchActive ? 'btn--active' : ''}"
        type="button"
        data-action="toggle-search"
        title="Search by title"
        aria-label="Search"
      >🔍</button>`
          : ''
      }
      <button
        class="btn btn--icon ${state.filterOpen || filterCount ? 'btn--active' : ''}"
        type="button"
        data-action="toggle-filter-open"
        title="Filter by genre"
        aria-label="Genre"
      >🏷<span class="toolbar-text">Genre</span>${filterCount ? `<span class="toolbar-badge">${filterCount}</span>` : ''}</button>
      <button
        class="btn btn--icon ${state.durationFilterOpen || durationFilterActive ? 'btn--active' : ''}"
        type="button"
        data-action="toggle-duration-filter-open"
        title="${durationBounds ? 'Filter by duration' : 'Duration filter (waiting for video lengths)'}"
        aria-label="Duration"
        ${durationBounds ? '' : 'disabled'}
      >⏳<span class="toolbar-text">Duration</span>${durationFilterActive ? '<span class="toolbar-badge">•</span>' : ''}</button>
      <button
        class="btn btn--icon btn--sort ${state.sortOpen ? 'btn--active' : ''}"
        type="button"
        data-action="toggle-sort-open"
        title="Sort feed"
        aria-label="Sort: ${escapeHtml(sortLabel)}"
      ><span class="sort-prefix" aria-hidden="true">${SORT_PREFIX}</span><span class="sort-mode-icon" aria-hidden="true">${sortIcon}</span><span class="sort-label toolbar-text">${escapeHtml(sortLabel)}</span></button>
      ${
        showSearch
          ? `<div class="toolbar-spacer"></div>
      <button
        class="btn btn--ghost btn--round"
        type="button"
        data-action="go-leaderboard"
        title="User ranking"
        aria-label="User ranking"
      >🏆</button>
      <button
        class="btn btn--ghost btn--round"
        type="button"
        data-action="copy-feedback"
        title="Copy feedback link"
        aria-label="Send feedback"
      >🤔</button>
      <button
        class="btn btn--primary btn--round"
        type="button"
        data-action="go-create"
        title="${escapeHtml(publishTitle || 'Publish a new short')}"
        aria-label="New short"
      >+</button>`
          : ''
      }
    </section>

    ${searchBar}

    <section class="filters">
      ${categoryBadges(state.filterCategories, 'toggle-filter-cat')}
      ${filterDropdown}
      ${durationDropdown}
      ${sortDropdown}
    </section>
  `;
}

function listView() {
  const shorts = filterShorts();
  const publishTitle = (() => {
    const info = myPublishPrice();
    if (!info) return `Publish a new short (${PRICE_PUBLISH_CRC} CRC)`;
    return `Publish a new short (${formatPublishPriceLabel(info)})`;
  })();

  const feedSyncing = state.feedLoading;
  const feedError = state.feedError;
  const emptyMessage = feedSyncing
    ? 'Loading shorts from IPFS…'
    : state.shorts.length === 0
      ? 'Publish the first one.'
      : 'Try clearing filters.';
  const empty =
    shorts.length === 0
      ? `<p class="empty">${feedSyncing ? '' : 'No shorts match. '}${escapeHtml(emptyMessage)}</p>`
      : '';
  const feedBanner = feedError
    ? `<div class="banner banner--error" role="status">Couldn't sync remote feed: ${escapeHtml(feedError)}</div>`
    : '';

  const browseControls = renderBrowseControls({
    genreShorts: state.shorts,
    durationShorts: shortsForDurationBounds(),
    showSearch: true,
    publishTitle,
  });

  return `
    ${browseControls}

    ${feedBanner}

    <section class="list">
      ${renderShortList(shorts, { emptyHtml: empty })}
    </section>
  `;
}

function createView() {
  const d = state.createDraft;
  const editingId = state.editingShortId;
  const editing = editingId ? getShort(editingId) : null;
  const priceInfo = editing ? null : myPublishPrice();
  const priceHint =
    !editing && priceInfo && publishPriceHint(priceInfo)
      ? `<p class="small muted publish-price-hint">${escapeHtml(publishPriceHint(priceInfo))}</p>`
      : '';
  const options = allKnownCategories();
  const createDropdown = state.createCategoryOpen
    ? renderDropdown({
        id: 'create-dd',
        options,
        selected: d.categories,
        query: state.createCategoryQuery,
        queryKey: 'create-cat-query',
        toggleAction: 'toggle-create-cat',
        allowAdd: false,
        describeGenres: true,
      })
    : '';
  const backAction = editing ? 'go-back' : 'go-list';
  const heading = editing ? 'Edit short' : 'Publish a new short';
  const submitLabel = editing ? 'Save changes' : publishButtonLabel();
  const deleteBtn = editing
    ? state.pendingDeleteShortId === editingId
      ? `<div class="form-delete-confirm">
          <p class="small muted">Delete this short permanently? This cannot be undone.</p>
          <div class="actions-row">
            <button class="btn btn--danger btn--sm" type="button" data-action="confirm-delete-short" data-id="${escapeHtml(editingId)}">Confirm delete</button>
            <button class="btn btn--ghost btn--sm" type="button" data-action="cancel-delete-short">Cancel</button>
          </div>
        </div>`
      : `<button class="btn btn--danger form-delete" type="button" data-action="delete-short" data-id="${escapeHtml(editingId)}">Delete</button>`
    : '';

  return `
    <button class="btn btn--ghost back" type="button" data-action="${backAction}">← Back</button>
    <form class="card form" data-action="submit-create" novalidate>
      <h2>${escapeHtml(heading)}</h2>
      ${priceHint}

      <label>
        <span>Title</span>
        <input
          class="input"
          name="title"
          maxlength="${limits.MAX_TITLE}"
          value="${escapeHtml(d.title)}"
          data-action="create-title"
          data-focus-key="create-title"
          required
        />
      </label>

      <label>
        <span>Video link (YouTube, Vimeo, TikTok, Twitch, Streamable, Dailymotion)</span>
        <input
          class="input"
          name="url"
          type="url"
          placeholder="https://…"
          value="${escapeHtml(d.url)}"
          data-action="create-url"
          data-focus-key="create-url"
          required
        />
      </label>

      <div class="field">
        <div class="field-label">
          <span>Genres <span class="muted">(min 1)</span></span>
        </div>
        <button
          class="btn btn--ghost dd-trigger ${state.createCategoryOpen ? 'btn--active' : ''}"
          type="button"
          data-action="toggle-create-open"
        >
          ${d.categories.length
            ? escapeHtml(`Selected: ${d.categories.length}`)
            : 'Select genres…'}
          <span aria-hidden="true">▾</span>
        </button>
        ${categoryBadges(d.categories, 'toggle-create-cat', { showGenreTitles: true })}
        ${createDropdown}
        <p class="small muted genre-category-desc" data-genre-desc>Hover or tap a genre to see what it covers.</p>
      </div>

      <div class="form-actions">
        <button class="btn btn--primary" type="submit">${escapeHtml(submitLabel)}</button>
        <button class="btn btn--ghost" type="button" data-action="${backAction}">Cancel</button>
        ${deleteBtn}
      </div>
    </form>
  `;
}

function leaderboardUserAvatar(address) {
  const me = profileFor(address);
  const initial = ((me?.name || address).trim().charAt(0) || '?').toUpperCase();
  if (me?.imageUrl) {
    return `<img class="avatar avatar--xs leaderboard-avatar" src="${escapeHtml(me.imageUrl)}" alt="" />`;
  }
  return `<span class="avatar avatar--xs avatar--placeholder leaderboard-avatar" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function leaderboardView() {
  const sortKey = state.leaderboardSort;
  const rows = sortLeaderboardRows(computeLeaderboard(state.shorts), sortKey);

  const pageTitle = leaderboardPageTitle(sortKey);
  const myRank = myLeaderboardRank(rows, sortKey);
  const myRankHtml =
    myRank != null
      ? `<span class="leaderboard-my-rank" aria-label="Your rank">#${myRank}</span>`
      : '';
  const titleLabelHtml = `<span class="leaderboard-title-text"><span class="leaderboard-title-label">${escapeHtml(pageTitle.label)}</span>${myRankHtml}</span>`;

  const headerStats = LEADERBOARD_COLUMNS.map(
    (col) => `
      <button
        type="button"
        class="leaderboard-head-stat leaderboard-head-sort${sortKey === col.key ? ' leaderboard-head-sort--on' : ''}"
        data-action="leaderboard-sort"
        data-sort="${col.key}"
        title="${escapeHtml(col.description)}"
        aria-label="Sort by ${escapeHtml(col.title)}"
        aria-pressed="${sortKey === col.key}"
      >${col.icon}</button>
    `,
  ).join('');

  const header = `
    <div class="leaderboard-head">
      <span class="leaderboard-head-rank">#</span>
      <span class="leaderboard-head-avatar" aria-hidden="true"></span>
      <span class="leaderboard-head-user">User</span>
      ${headerStats}
    </div>
  `;

  const list =
    rows.length === 0
      ? '<p class="empty">No activity yet. Publish, upvote, save, or comment to appear here.</p>'
      : rows
          .map((row, i) => {
            const rank = i + 1;
            const fullName = profileNameFor(row.address) || shortAddress(row.address);
            const name = truncateText(fullName, 12);
            const isMe = isOwnProfileAddress(row.address);
            return `
              <div class="${leaderboardRowClass(isMe)}">
                <div class="leaderboard-row">
                  <span class="leaderboard-rank" aria-label="Rank ${rank}">#${rank}</span>
                  <button
                    type="button"
                    class="leaderboard-avatar-btn"
                    data-action="go-user-profile"
                    data-address="${escapeHtml(row.address)}"
                    title="View profile"
                    aria-label="View ${escapeHtml(fullName)} profile"
                  >${leaderboardUserAvatar(row.address)}</button>
                  <button
                    type="button"
                    class="profile-link leaderboard-name"
                    data-action="go-user-profile"
                    data-address="${escapeHtml(row.address)}"
                    title="${escapeHtml(fullName)}"
                  >${escapeHtml(name)}</button>
                  ${LEADERBOARD_COLUMNS.map((col) => leaderboardStatHtml(row, col, sortKey)).join('')}
                </div>
              </div>
            `;
          })
          .join('');

  const userCountLabel =
    rows.length === 1 ? '1 active user' : `${rows.length} active users`;

  return `
    <button class="btn btn--ghost back" type="button" data-action="go-back">← Back</button>
    <section class="card leaderboard-card">
      <h2 class="leaderboard-title"><span class="leaderboard-title-icon" aria-hidden="true">🏆</span><span class="leaderboard-title-icon" aria-hidden="true">${pageTitle.icon}</span>${titleLabelHtml}</h2>
      ${rows.length ? `<p class="leaderboard-meta">${escapeHtml(userCountLabel)}</p>` : ''}
      ${
        rows.length
          ? `<div class="leaderboard-table-wrap"><div class="leaderboard-table-inner">${header}<div class="leaderboard-list">${list}</div></div></div>`
          : `<div class="leaderboard-list">${list}</div>`
      }
    </section>
  `;
}

function profileView() {
  const address = activeProfileAddress();
  if (!address) {
    return `
      <button class="btn btn--ghost back" type="button" data-action="go-back">← Back</button>
      <section class="card">
        <h2>My profile</h2>
        <p class="muted">Open this app inside the Circles host and connect your wallet to see your published shorts, upvotes, comments, and saves.</p>
      </section>
    `;
  }

  const isOwn = isOwnProfileAddress(address);
  const me = profileFor(address);
  const name = me?.name || shortAddress(address);
  const initial = ((me?.name || address).trim().charAt(0) || '?').toUpperCase();
  const avatar = me?.imageUrl
    ? `<img class="avatar avatar--lg" src="${escapeHtml(me.imageUrl)}" alt="" />`
    : `<span class="avatar avatar--lg avatar--placeholder" aria-hidden="true">${escapeHtml(initial)}</span>`;
  const profileUrl = circlesProfileUrl(address);
  const copyBtn = profileUrl
    ? `<button type="button" class="btn btn--ghost btn--icon profile-copy-btn" data-action="copy-profile-link" data-url="${escapeHtml(profileUrl)}" title="Copy profile link" aria-label="Copy profile link">🔗</button>`
    : '';
  const addressLabel = `<span class="profile-address" title="${escapeHtml(address)}">${escapeHtml(shortAddress(address))}</span>`;
  const all = state.shorts;
  const meLower = address.toLowerCase();
  const counts = {
    published: all.filter((s) => s.creator?.toLowerCase() === meLower).length,
    upvoted: all.filter(
      (s) =>
        s.creator?.toLowerCase() !== meLower &&
        (s.voters || []).some((v) => v?.toLowerCase() === meLower),
    ).length,
    commented: all.filter((s) =>
      (s.comments || []).some((c) => c.by?.toLowerCase() === meLower),
    ).length,
    saved: all.filter((s) =>
      (s.savers || []).some((v) => v?.toLowerCase() === meLower),
    ).length,
  };

  const flagWins = countFlaggerWins(address, all);
  const strikes = countCreatorViolations(address, all);
  const flagged = countProfileFlagged(address, all);
  const karmaHtml = `
    <div class="profile-karma-row">
      <button
        type="button"
        class="profile-karma profile-karma--flagged${state.profileTab === 'flagged' ? ' profile-karma--on' : ''}"
        data-action="profile-karma"
        data-karma="flagged"
        title="${escapeHtml(FLAGGED_PROFILE_TIP)}"
        aria-label="${escapeHtml(FLAGGED_PROFILE_TIP)}"
        aria-pressed="${state.profileTab === 'flagged'}"
      >🚩 ${flagged}</button>
      <button
        type="button"
        class="profile-karma profile-karma--strike${state.profileTab === 'strikes' ? ' profile-karma--on' : ''}"
        data-action="profile-karma"
        data-karma="strike"
        title="${escapeHtml(STRIKE_KARMA_TIP)}"
        aria-label="${escapeHtml(STRIKE_KARMA_TIP)}"
        aria-pressed="${state.profileTab === 'strikes'}"
      >❌ ${strikes}</button>
      <button
        type="button"
        class="profile-karma profile-karma--praise${state.profileTab === 'praise' ? ' profile-karma--on' : ''}"
        data-action="profile-karma"
        data-karma="praise"
        title="${escapeHtml(PRAISE_KARMA_TIP)}"
        aria-label="${escapeHtml(PRAISE_KARMA_TIP)}"
        aria-pressed="${state.profileTab === 'praise'}"
      >👮 ${flagWins}</button>
    </div>
  `;

  const tabs = [
    { key: 'published', label: 'Published', icon: UPLOADED_ICON },
    { key: 'upvoted', label: 'Upvoted', icon: '👍' },
    { key: 'commented', label: 'Commented', icon: '💬' },
    { key: 'saved', label: 'Saved', icon: '💾' },
  ];

  const karmaTabs = {
    flagged: { label: 'Flagged', icon: '🚩' },
    strikes: { label: 'my Strikes', icon: '❌' },
    praise: { label: 'I removed', icon: '👮' },
  };

  const activeTab =
    karmaTabs[state.profileTab] || tabs.find((t) => t.key === state.profileTab) || tabs[0];

  const tabBar = `
    <div class="profile-tabs">
      <nav class="tabs" role="tablist">
        ${tabs
          .map(
            (t) => `
              <button
                role="tab"
                class="tab ${state.profileTab === t.key ? 'tab--on' : ''}"
                type="button"
                data-action="profile-tab"
                data-tab="${t.key}"
                aria-selected="${state.profileTab === t.key}"
                title="${escapeHtml(t.label)}"
                aria-label="${escapeHtml(t.label)} (${counts[t.key]})"
              >
                <span class="tab-icon" aria-hidden="true">${t.icon}</span>
                <span class="tab-count">${counts[t.key]}</span>
              </button>
            `,
          )
          .join('')}
      </nav>
      <p class="profile-tab-title" role="tabpanel" aria-live="polite"><span class="profile-tab-title-icon" aria-hidden="true">${activeTab.icon}</span> ${escapeHtml(activeTab.label)}</p>
    </div>
  `;

  const baseItems = profileShortsBase();
  const items = profileShorts();
  const filterCount = state.filterCategories.length;
  const durationFilterActive = isDurationFilterActive(durationFilterBounds());
  const hasActiveFilters = filterCount > 0 || durationFilterActive;
  const tabEmptyLabel = isOwn
    ? {
        published: 'You haven\'t published any shorts yet. Tap + to publish your first one.',
        upvoted: 'You haven\'t upvoted any shorts yet.',
        commented: 'You haven\'t commented on any shorts yet.',
        saved: 'You haven\'t saved any shorts yet.',
        flagged: 'No flag activity yet — nothing you flagged and no flags on your uploads.',
        strikes: 'No removed shorts on your record.',
        praise: 'No upheld flags yet.',
      }[state.profileTab]
    : {
        published: 'No published shorts yet.',
        upvoted: 'No upvoted shorts yet.',
        commented: 'No commented shorts yet.',
        saved: 'No saved shorts yet.',
        flagged: 'No flag activity on this profile.',
        strikes: 'No removed shorts.',
        praise: 'No upheld flags.',
      }[state.profileTab];
  const emptyLabel =
    items.length === 0 && hasActiveFilters && baseItems.length > 0
      ? 'No shorts match. Try clearing filters.'
      : tabEmptyLabel;
  const empty = items.length === 0 ? `<p class="empty">${escapeHtml(emptyLabel)}</p>` : '';
  const browseControls = renderBrowseControls({
    genreShorts: baseItems,
    durationShorts: baseItems,
    showSearch: false,
  });

  return `
    <button class="btn btn--ghost back" type="button" data-action="go-back">← Back</button>
    <section class="card profile-header">
      ${copyBtn}
      ${avatar}
      <div class="profile-meta">
        <h2 class="profile-name">${escapeHtml(name)}</h2>
        ${addressLabel}
        ${karmaHtml}
      </div>
    </section>
    ${tabBar}
    ${browseControls}
    <section class="list">
      ${renderShortList(items, { emptyHtml: empty })}
    </section>
  `;
}

function detailView() {
  const s = getShort(state.selectedShortId);
  if (!s) {
    return `
      <button class="btn btn--ghost back" type="button" data-action="go-back">← Back</button>
      <p class="empty">Short not found.</p>
    `;
  }
  const embed = videoEmbedUrl(s.url);
  const isOwn =
    state.connectedAddress && s.creator.toLowerCase() === state.connectedAddress.toLowerCase();
  const violated = isShortViolated(s);
  const underReview = isShortUnderReview(s);
  const flagBtn = renderCardFlagBtn(s, {
    underReview,
    isOwn,
    violated,
    onDetail: true,
    inPlayer: Boolean(embed),
  });
  const player = embed
    ? videoPlayerHtml({
        embed,
        variant: 'bleed',
        lazy: false,
        shortId: s.id,
        videoUrl: s.url,
        controlsExtra: flagBtn,
      })
    : `<p class="player-link-row">${videoLinkHtml(s.url, { className: 'video-link player-link' })}${flagBtn}</p>`;
  const cats = (s.categories || [])
    .map((c) => `<span class="chip chip--sm">${escapeHtml(c)}</span>`)
    .join('');
  const creatorName = profileNameFor(s.creator) || shortAddress(s.creator);
  const creatorHtml = userProfileLinkHtml(s.creator, creatorName);
  const editBtn = isOwn
    ? `<button type="button" class="btn btn--ghost btn--sm" data-action="go-edit" data-id="${escapeHtml(s.id)}">Edit</button>`
    : '';
  const comments = (s.comments || [])
    .slice()
    .reverse()
    .map(
      (c) => {
        const cname = profileNameFor(c.by) || shortAddress(c.by);
        const chtml = userProfileLinkHtml(c.by, cname);
        const canDelete = isOwnProfileAddress(c.by);
        const deleteBtn = canDelete
          ? `<button type="button" class="btn btn--ghost comment-delete" data-action="delete-comment" data-comment-id="${escapeHtml(c.id)}" title="Delete comment (CRC not refunded)">Delete</button>`
          : '';
        return `
        <li class="comment">
          <div class="comment-head">
            <div class="comment-meta muted">${chtml} · ${escapeHtml(timeAgo(c.createdAt))}</div>
            ${deleteBtn}
          </div>
          <div>${escapeHtml(c.text)}</div>
        </li>
      `;
      },
    )
    .join('');
  return `
    <button class="btn btn--ghost back" type="button" data-action="go-list">← Back</button>
    <article class="card detail${violated ? ' detail--violated' : ''}${isOwn ? ' detail--own' : ''}">
      <div class="detail-head">
        <h2>${shortTitleWithDurationHtml(s)}</h2>
        ${editBtn}
      </div>
      <div class="short-sub muted">by ${creatorHtml} · ${escapeHtml(timeAgo(s.createdAt))}</div>
      <div class="chips chips--sm">${cats}</div>
      ${violated ? '<p class="moderation-removed-banner">This short was removed after community moderation.</p>' : `
        <div class="short-card-media detail-media">
          ${player}
        </div>
        ${shortCardActionsHtml(s)}
      `}
    </article>

    ${renderModerationPanel(s)}

    <section class="card" data-comment-section>
      <h3>Comments (${s.comments?.length || 0})</h3>
      ${
        violated
          ? '<p class="muted">Comments are closed on removed shorts.</p>'
          : isOwn
            ? '<p class="muted">You cannot comment on your own short.</p>'
            : `
            <form class="comment-form" data-action="submit-comment">
              <textarea
                class="input"
                name="text"
                rows="3"
                maxlength="${limits.MAX_COMMENT}"
                placeholder="Share thoughts… (costs ${PRICE_INTERACT_CRC} CRC, counts as +1 upvote)"
                data-focus-key="comment-text"
                required
              ></textarea>
              <button class="btn btn--primary" type="submit">Post (${PRICE_INTERACT_CRC} CRC)</button>
            </form>
          `
      }
      <ul class="comments">${comments || '<li class="muted">No comments yet.</li>'}</ul>
    </section>
  `;
}

function renderApp() {
  let view = '';
  if (state.view === 'create') view = createView();
  else if (state.view === 'detail') view = detailView();
  else if (state.view === 'profile') view = profileView();
  else if (state.view === 'leaderboard') view = leaderboardView();
  else view = listView();
  return `
    ${header()}
    <main class="container">${view}</main>
  `;
}

function bindEvents() {
  const app = root();
  if (!app) return;

  // Navigation
  app.querySelectorAll('[data-action="go-list"]').forEach((el) =>
    el.addEventListener('click', () => setView('list')),
  );
  app.querySelectorAll('[data-action="go-back"]').forEach((el) =>
    el.addEventListener('click', () => goBack()),
  );
  app.querySelectorAll('[data-action="go-create"]').forEach((el) =>
    el.addEventListener('click', () => setView('create')),
  );
  app.querySelectorAll('[data-action="go-leaderboard"]').forEach((el) =>
    el.addEventListener('click', () => setView('leaderboard')),
  );
  app.querySelectorAll('[data-action="leaderboard-sort"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const sort = e.currentTarget.dataset.sort;
      if (sort) setLeaderboardSort(sort);
    }),
  );
  app.querySelectorAll('[data-action="go-profile"]').forEach((el) =>
    el.addEventListener('click', () => {
      setNotificationsOpen(false);
      if (state.connectedAddress) {
        setView('profile', null, { profileAddress: state.connectedAddress });
      } else {
        setView('profile');
      }
    }),
  );
  app.querySelectorAll('[data-action="toggle-notifications"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      setNotificationsOpen(!state.notificationsOpen);
    }),
  );
  app.querySelectorAll('[data-action="close-notifications"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      setNotificationsOpen(false);
    }),
  );
  app.querySelectorAll('[data-action="mark-all-notifications-read"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.connectedAddress) {
        markAllNotificationsRead(state.connectedAddress);
        rerender();
      }
    }),
  );
  app.querySelectorAll('[data-action="open-notification"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      const shortId = e.currentTarget.dataset.shortId;
      if (state.connectedAddress && id) {
        markNotificationRead(state.connectedAddress, id);
      }
      setNotificationsOpen(false);
      if (shortId) setView('detail', shortId);
    }),
  );
  app.querySelectorAll('[data-action="go-user-profile"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const address = e.currentTarget.dataset.address;
      if (address) setView('profile', null, { profileAddress: address });
    }),
  );
  app.querySelectorAll('[data-action="copy-profile-link"]').forEach((el) =>
    el.addEventListener('click', () => {
      const url = el.dataset.url;
      if (!url) return;
      copyToClipboard(url).then((ok) => {
        if (ok) {
          setStatus('success', 'Profile link copied.');
        } else {
          setStatus('error', 'Could not copy link.');
        }
      });
    }),
  );
  app.querySelectorAll('[data-action="profile-tab"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.tab;
      if (tab) setProfileTab(tab);
    }),
  );
  app.querySelectorAll('[data-action="profile-karma"]').forEach((el) =>
    el.addEventListener('click', () => {
      const karma = el.dataset.karma;
      if (karma === 'flagged') setProfileTab('flagged');
      else if (karma === 'strike') setProfileTab('strikes');
      else if (karma === 'praise') setProfileTab('praise');
    }),
  );
  app.querySelectorAll('[data-action="copy-feedback"]').forEach((el) =>
    el.addEventListener('click', () => {
      copyToClipboard(FEEDBACK_URL).then((ok) => {
        if (ok) {
          setStatus('success', 'Feedback link copied.');
        } else {
          setStatus('error', 'Could not copy link.');
        }
      });
    }),
  );
  app.querySelectorAll('[data-action="go-detail"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (id) setView('detail', id);
    }),
  );
  app.querySelectorAll('[data-action="go-edit"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      if (id) setView('edit', id);
    }),
  );
  app.querySelectorAll('[data-action="open-vote"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      if (id) {
        setView('detail', id);
        scrollToFlagVote();
      }
    }),
  );
  app.querySelectorAll('[data-action="scroll-to-vote"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToFlagVote();
    }),
  );
  app.querySelectorAll('[data-action="open-flag"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      if (id) {
        setView('detail', id, { openFlagForm: true });
        scrollToFlagReport();
      }
    }),
  );
  app.querySelectorAll('[data-action="show-flag-form"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFlagFormOpen(true);
      scrollToFlagReport();
    }),
  );
  app.querySelectorAll('[data-action="hide-flag-form"]').forEach((el) =>
    el.addEventListener('click', () => setFlagFormOpen(false)),
  );

  // List view: search + sort
  const search = app.querySelector('[data-action="search"]');
  if (search) {
    search.addEventListener('input', (e) => setSearch(e.currentTarget.value));
  }
  app.querySelectorAll('[data-action="toggle-search"]').forEach((el) =>
    el.addEventListener('click', () => {
      setSearchOpen(!state.searchOpen);
      if (state.searchOpen) {
        requestAnimationFrame(() => {
          const input = document.querySelector('[data-focus-key="title-search"]');
          if (input && typeof input.focus === 'function') input.focus();
        });
      }
    }),
  );
  app.querySelectorAll('[data-action="clear-search"]').forEach((el) =>
    el.addEventListener('click', () => setSearch('')),
  );
  app.querySelectorAll('[data-action="toggle-sort-open"]').forEach((el) =>
    el.addEventListener('click', () => setSortOpen(!state.sortOpen)),
  );
  app.querySelectorAll('[data-action="set-sort"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const sort = e.currentTarget.dataset.sort;
      if (sort) setSort(sort);
    }),
  );

  // Filter dropdown (list)
  app.querySelectorAll('[data-action="toggle-filter-open"]').forEach((el) =>
    el.addEventListener('click', () => setFilterOpen(!state.filterOpen)),
  );
  app.querySelectorAll('[data-action="toggle-duration-filter-open"]').forEach((el) =>
    el.addEventListener('click', () => setDurationFilterOpen(!state.durationFilterOpen)),
  );
  app.querySelectorAll('[data-action="clear-duration-filter"]').forEach((el) =>
    el.addEventListener('click', () => clearDurationFilter()),
  );
  const durationMin = app.querySelector('[data-action="duration-filter-min"]');
  const durationMax = app.querySelector('[data-action="duration-filter-max"]');
  if (durationMin && durationMax) {
    const bounds = durationFilterBounds();
    const trackEl = durationMin.closest('.duration-range-track');
    const valuesEl = durationMin.closest('.duration-filter-dd')?.querySelector('.duration-filter-values');
    const fillEl = trackEl?.querySelector('[data-duration-range-fill]');

    const syncDurationSliders = () => {
      if (!bounds) return { min: 0, max: 0 };
      let min = Number(durationMin.value);
      let max = Number(durationMax.value);
      if (min > max) {
        if (document.activeElement === durationMin) {
          max = min;
          durationMax.value = String(max);
        } else {
          min = max;
          durationMin.value = String(min);
        }
      }
      const minLabel = formatDuration(min) || '0:00';
      const maxLabel = formatDuration(max) || '0:00';
      if (valuesEl) {
        valuesEl.textContent = `${minLabel} – ${maxLabel}`;
      }
      if (fillEl) {
        const span = bounds.max - bounds.min || 1;
        fillEl.style.left = `${((min - bounds.min) / span) * 100}%`;
        fillEl.style.width = `${((max - min) / span) * 100}%`;
      }
      return { min, max };
    };

    const onDurationInput = () => {
      syncDurationSliders();
    };

    const onDurationCommit = () => {
      if (!bounds) return;
      const { min, max } = syncDurationSliders();
      applyDurationFilterValues(min, max, bounds);
    };

    durationMin.addEventListener('mousedown', () => {
      durationMin.style.zIndex = '4';
      durationMax.style.zIndex = '3';
    });
    durationMax.addEventListener('mousedown', () => {
      durationMax.style.zIndex = '4';
      durationMin.style.zIndex = '3';
    });
    durationMin.addEventListener('touchstart', () => {
      durationMin.style.zIndex = '4';
      durationMax.style.zIndex = '3';
    }, { passive: true });
    durationMax.addEventListener('touchstart', () => {
      durationMax.style.zIndex = '4';
      durationMin.style.zIndex = '3';
    }, { passive: true });

    durationMin.addEventListener('input', onDurationInput);
    durationMax.addEventListener('input', onDurationInput);
    durationMin.addEventListener('change', onDurationCommit);
    durationMax.addEventListener('change', onDurationCommit);
  }
  app.querySelectorAll('[data-action="clear-filter"]').forEach((el) =>
    el.addEventListener('click', () => clearFilterCategories()),
  );
  app.querySelectorAll('[data-action="toggle-filter-cat"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const cat = e.currentTarget.dataset.cat;
      if (cat) toggleFilterCategory(cat);
    }),
  );
  const filterQ = app.querySelector('[data-action="filter-query"]');
  if (filterQ) {
    filterQ.addEventListener('input', (e) => setFilterQuery(e.currentTarget.value));
  }

  // Create form draft inputs
  const titleInput = app.querySelector('[data-action="create-title"]');
  if (titleInput) {
    titleInput.addEventListener('input', (e) =>
      setCreateDraft({ title: e.currentTarget.value }),
    );
  }
  const urlInput = app.querySelector('[data-action="create-url"]');
  if (urlInput) {
    urlInput.addEventListener('input', (e) =>
      setCreateDraft({ url: e.currentTarget.value }),
    );
  }

  // Create form category dropdown
  app.querySelectorAll('[data-action="toggle-create-open"]').forEach((el) =>
    el.addEventListener('click', () => setCreateCategoryOpen(!state.createCategoryOpen)),
  );
  app.querySelectorAll('[data-action="toggle-create-cat"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const cat = e.currentTarget.dataset.cat;
      if (cat) {
        toggleCreateCategory(cat);
        updateGenreDesc(cat);
        if (e.currentTarget.closest('#create-dd')) {
          setCreateCategoryOpen(false);
        }
      }
    }),
  );
  document.querySelectorAll('#create-dd [data-genre]').forEach((el) => {
    el.addEventListener('mouseenter', () => updateGenreDesc(el.dataset.genre));
    el.addEventListener('focus', () => updateGenreDesc(el.dataset.genre));
  });
  const createQ = app.querySelector('[data-action="create-cat-query"]');
  if (createQ) {
    createQ.addEventListener('input', (e) => setCreateCategoryQuery(e.currentTarget.value));
  }

  // Create submit
  const createForm = app.querySelector('form[data-action="submit-create"]');
  if (createForm) {
    createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const submitBtn = createForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      const d = state.createDraft;
      const editingId = state.editingShortId;
      const action = editingId
        ? updateUpload(editingId, {
            title: d.title,
            url: d.url,
            categories: d.categories,
          })
        : publishShort({
            title: d.title,
            url: d.url,
            categories: d.categories,
          });
      action
        .catch(() => {})
        .finally(() => {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  app.querySelectorAll('[data-action="delete-short"]').forEach((el) =>
    el.addEventListener('click', () => {
      const id = el.dataset.id || state.editingShortId;
      if (!id) return;
      setPendingDeleteShort(id);
    }),
  );

  app.querySelectorAll('[data-action="cancel-delete-short"]').forEach((el) =>
    el.addEventListener('click', () => {
      clearPendingDeleteShort();
    }),
  );

  app.querySelectorAll('[data-action="confirm-delete-short"]').forEach((el) =>
    el.addEventListener('click', () => {
      const id = el.dataset.id || state.editingShortId;
      if (!id) return;
      el.disabled = true;
      deleteUpload(id)
        .catch(() => {})
        .finally(() => {
          el.disabled = false;
        });
    }),
  );

  // Card actions (list)
  app.querySelectorAll('[data-action="card-upvote"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      const short = getShort(id);
      const action =
        short && hasUpvoted(short, state.connectedAddress) ? unupvoteAction(id) : upvoteAction(id);
      action
        .catch(() => {})
        .finally(() => {
          btn.disabled = false;
        });
    }),
  );
  app.querySelectorAll('[data-action="card-save"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      const short = getShort(id);
      const action = short && isSavedBy(short, state.connectedAddress) ? unsaveAction(id) : saveAction(id);
      action
        .catch(() => {})
        .finally(() => {
          btn.disabled = false;
        });
    }),
  );
  app.querySelectorAll('[data-action="card-comment"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (id) {
        setView('detail', id);
        scrollToComments();
      }
    }),
  );

  app.querySelectorAll('[data-action="delete-comment"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const commentId = e.currentTarget.dataset.commentId;
      if (!commentId || !state.selectedShortId) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      deleteCommentAction(state.selectedShortId, commentId)
        .catch(() => {})
        .finally(() => {
          btn.disabled = false;
        });
    }),
  );
  const commentForm = app.querySelector('form[data-action="submit-comment"]');
  if (commentForm) {
    commentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!state.selectedShortId) return;
      const fd = new FormData(commentForm);
      const submitBtn = commentForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      commentAction(state.selectedShortId, fd.get('text'))
        .then(() => commentForm.reset())
        .catch(() => {})
        .finally(() => {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  app.querySelectorAll('form[data-action="submit-flag"]').forEach((form) => {
    updateFlagCharCount(form);
    updateFlagCategoryDesc(form);
    const explanation = form.querySelector('[name="explanation"]');
    if (explanation) {
      explanation.addEventListener('input', () => updateFlagCharCount(form));
    }
    const category = form.querySelector('[name="category"]');
    if (category) {
      category.addEventListener('change', () => updateFlagCategoryDesc(form));
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = form.dataset.id;
      if (!id) return;
      const fd = new FormData(form);
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      flagShort(id, {
        category: fd.get('category'),
        explanation: fd.get('explanation'),
      })
        .then(() => {
          form.reset();
          setFlagFormOpen(false);
        })
        .catch(() => {})
        .finally(() => {
          if (submitBtn) submitBtn.disabled = false;
          updateFlagCharCount(form);
          updateFlagCategoryDesc(form);
        });
    });
  });

  app.querySelectorAll('[data-action="withdraw-flag"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      setPendingWithdrawFlag(id);
    }),
  );

  app.querySelectorAll('[data-action="cancel-withdraw-flag"]').forEach((el) =>
    el.addEventListener('click', () => {
      clearPendingWithdrawFlag();
    }),
  );

  app.querySelectorAll('[data-action="confirm-withdraw-flag"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      e.currentTarget.disabled = true;
      withdrawFlag(id)
        .catch(() => {})
        .finally(() => {
          clearPendingWithdrawFlag();
          e.currentTarget.disabled = false;
        });
    }),
  );

  app.querySelectorAll('[data-action="vote-violation"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      e.currentTarget.disabled = true;
      voteModeration(id, 'violation').catch(() => {}).finally(() => {
        e.currentTarget.disabled = false;
      });
    }),
  );
  app.querySelectorAll('[data-action="vote-clear"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      e.currentTarget.disabled = true;
      voteModeration(id, 'clear').catch(() => {}).finally(() => {
        e.currentTarget.disabled = false;
      });
    }),
  );

  app.querySelectorAll('[data-action="player-fullscreen"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const player = e.currentTarget.closest('.player');
      if (player) void togglePlayerFullscreen(player);
    }),
  );
}

function handleOutsideClick(e) {
  const target = e.target;
  if (!target || !target.closest) return;
  const closestDd = target.closest('.dropdown');
  const closestTrigger = target.closest(
    '[data-action="toggle-filter-open"], [data-action="toggle-duration-filter-open"], [data-action="toggle-sort-open"], [data-action="toggle-create-open"], [data-action="toggle-notifications"]',
  );

  if (state.notificationsOpen) {
    const inNotifyUi =
      target.closest('.notify-wrap') || target.closest('#notify-dd');
    const isNotifyTrigger = closestTrigger?.dataset.action === 'toggle-notifications';
    if (!inNotifyUi && !isNotifyTrigger) {
      setNotificationsOpen(false);
    }
  }

  if (state.filterOpen) {
    const inFilterDd = closestDd?.id === 'filter-dd';
    const isFilterTrigger = closestTrigger?.dataset.action === 'toggle-filter-open';
    if (!inFilterDd && !isFilterTrigger) {
      setFilterOpen(false);
    }
  }
  if (state.durationFilterOpen) {
    const inDurationDd = closestDd?.id === 'duration-filter-dd';
    const isDurationTrigger = closestTrigger?.dataset.action === 'toggle-duration-filter-open';
    if (!inDurationDd && !isDurationTrigger) {
      setDurationFilterOpen(false);
    }
  }
  if (state.sortOpen) {
    const inSortDd = closestDd?.id === 'sort-dd';
    const isSortTrigger = closestTrigger?.dataset.action === 'toggle-sort-open';
    if (!inSortDd && !isSortTrigger) {
      setSortOpen(false);
    }
  }
  if (state.createCategoryOpen) {
    const inCreateDd = closestDd?.id === 'create-dd';
    const isCreateTrigger = closestTrigger?.dataset.action === 'toggle-create-open';
    if (!inCreateDd && !isCreateTrigger) {
      setCreateCategoryOpen(false);
    }
  }
}

function handleCopyLinkClick(e) {
  const link = e.target.closest && e.target.closest('a.video-link');
  if (!link) return;
  e.preventDefault();
  const url = link.getAttribute('href');
  if (!url) return;
  copyToClipboard(url).then((ok) => {
    if (ok) {
      setStatus('success', 'Video link copied.');
    } else {
      setStatus('error', 'Could not copy link.');
    }
  });
}

let outsideInstalled = false;
let scrollTopInstalled = false;

function setupScrollTopButton() {
  if (scrollTopInstalled) return;
  scrollTopInstalled = true;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'scroll-top';
  btn.setAttribute('aria-label', 'Scroll to top');
  btn.title = 'Back to top';
  btn.textContent = '↑';
  btn.setAttribute('aria-hidden', 'true');
  document.body.appendChild(btn);

  const threshold = 280;
  let ticking = false;

  function updateVisibility() {
    const show = window.scrollY > threshold;
    btn.setAttribute('aria-hidden', show ? 'false' : 'true');
    btn.classList.toggle('scroll-top--visible', show);
    ticking = false;
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateVisibility);
      }
    },
    { passive: true },
  );

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  updateVisibility();
}

export function initUi() {
  subscribe(rerender);
  subscribeStatus(updateStatusBanner);
  rerender();
  setupScrollTopButton();
  setupPlayerFullscreen();
  if (!outsideInstalled) {
    document.addEventListener('pointerdown', handleOutsideClick, true);
    document.addEventListener('click', handleCopyLinkClick);
    outsideInstalled = true;
  }
}
