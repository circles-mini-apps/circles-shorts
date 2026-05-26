import {
  PRICE_FLAG_CRC,
  PRICE_INTERACT_CRC,
  PRICE_PUBLISH_CRC,
  getPublishPriceFor,
  comment as commentAction,
  flagShort,
  publishShort,
  upvote as upvoteAction,
  voteModeration,
} from './actions.js';
import { formatPublishPriceLabel, PRAISE_KARMA_TIP, STRIKE_KARMA_TIP, publishPriceHint } from '../data/reputation.js';
import { isDemoMode } from '../chain/circlesTransfer.js';
import { allKnownCategories, genreDescription, submittedGenresWithCounts } from '../data/categories.js';
import { FLAG_CATEGORIES, flagCategoryLabel } from '../data/flagReasons.js';
import {
  MIN_MODERATION_VOTES,
  MODERATION_DAYS,
  countCreatorViolations,
  countFlaggerWins,
  isShortViolated,
  isShortUnderReview,
  moderationSnapshot,
} from '../data/moderation.js';
import { ensureProfilesLoaded, profileFor, profileNameFor } from '../data/profiles.js';
import { getShort } from '../data/storage.js';
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
  setProfileTab,
  setSearch,
  setSearchOpen,
  setStatus,
  setView,
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
} from '../utils/format.js';
import { formatDuration } from '../utils/duration.js';
import { limits } from '../utils/validation.js';

const FEEDBACK_URL = 'https://tally.so/r/xXlMNG';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Most recent', icon: '🕒' },
  { value: 'top', label: 'Most upvotes', icon: '👍' },
  { value: 'comments', label: 'Most comments', icon: '💬' },
];

function sortOptionLabel(value) {
  return SORT_OPTIONS.find((o) => o.value === value)?.label || 'Sort';
}

function sortOptionIcon(value) {
  return SORT_OPTIONS.find((o) => o.value === value)?.icon || '⇅';
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
    const userVote = (s.moderation?.votes || []).find(
      (v) => v.flagCid === flag.cid && v.voter?.toLowerCase() === me,
    );
    const canVote = me && !isOwn && !userVote;
    return `
      <section class="card moderation moderation--open" data-flag-vote>
        <div class="moderation-head">
          <h3>🚩 Under review</h3>
          <span class="chip chip--warn">Active flag</span>
        </div>
        <p class="moderation-reason-label">${display.label ? `<span class="chip chip--warn">${escapeHtml(display.label)}</span>` : ''}</p>
        <p class="moderation-reason">${escapeHtml(display.text)}</p>
        <p class="small muted">Flagged by ${escapeHtml(flaggerName)} · ${escapeHtml(timeAgo(flag.createdAt))}</p>
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
              : isOwn
                ? '<p class="muted">You cannot vote on a flag for your own short.</p>'
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
    if (state.connectedAddress) out.add(state.connectedAddress);
    for (const s of profileShorts()) out.add(s.creator);
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
  const addrs = visibleAddresses();
  if (addrs.length) {
    ensureProfilesLoaded(addrs);
  }

  if (navigatedToDetail) {
    window.scrollTo(0, 0);
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

function statusBanner() {
  const { status } = state;
  if (status.kind === 'idle' || !status.message) return '';
  return `<div class="snackbar snackbar--${status.kind}" role="status" aria-live="polite">${escapeHtml(status.message)}</div>`;
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
    walletBtn = `
      <button
        class="wallet-btn ${state.view === 'profile' ? 'wallet-btn--active' : ''}"
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
        <button class="brand-btn" data-action="go-list" type="button">🎬 Circles Shorts</button>
        <span class="brand-meta muted">${escapeHtml(countLabel)}</span>
        ${demo}
      </div>
      <div class="topbar-right">${walletBtn}</div>
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
        <span class="dd-item-label">${opt.icon} ${escapeHtml(opt.label)}</span>
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

function videoPlayerHtml({ embed, variant = 'sm', lazy = false, shortId = null, videoUrl = null }) {
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
        ${copyBtn}
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

function filterShorts() {
  const q = state.search.trim().toLowerCase();
  const cats = state.filterCategories.map((c) => c.toLowerCase());
  let list = [...state.shorts];
  if (state.view === 'list') {
    list = list.filter((s) => s.moderation?.status !== 'violated');
  }
  if (q) list = list.filter((s) => s.title.toLowerCase().includes(q));
  if (cats.length) {
    list = list.filter((s) => {
      const shortCats = (s.categories || []).map((x) => x.toLowerCase());
      return cats.every((c) => shortCats.includes(c));
    });
  }
  const durationRange = state.durationFilterRange;
  if (durationRange) {
    list = list.filter((s) => {
      const d = getShortDurationSeconds(s, state.videoDurations);
      if (d == null) return false;
      return d >= durationRange.min && d <= durationRange.max;
    });
  }
  if (state.sort === 'top') {
    list.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0) || b.createdAt - a.createdAt);
  } else if (state.sort === 'comments') {
    list.sort(
      (a, b) =>
        (b.comments?.length || 0) - (a.comments?.length || 0) || b.createdAt - a.createdAt,
    );
  } else {
    list.sort((a, b) => b.createdAt - a.createdAt);
  }
  return list;
}

function renderCardFlagBtn(s, { underReview, isOwn, violated, onDetail = false }) {
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
  const flagClass = underReview ? ' card-flag-btn--active' : ' card-flag-btn--idle';

  return `
    <button
      type="button"
      class="card-flag-btn${flagClass}"
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
  return durationBoundsForShorts(shortsForDurationBounds(), state.videoDurations);
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

function shortCard(s) {
  const cats = (s.categories || [])
    .map((c) => `<span class="chip chip--sm">${escapeHtml(c)}</span>`)
    .join('');
  const embed = videoEmbedUrl(s.url);
  const player = embed
    ? videoPlayerHtml({ embed, variant: 'sm', lazy: true, shortId: s.id, videoUrl: s.url })
    : videoLinkHtml(s.url, { className: 'video-link player-link' });

  const name = profileNameFor(s.creator);
  const byLabel = name || shortAddress(s.creator);
  const profileUrl = circlesProfileUrl(s.creator);
  const byHtml = profileUrl
    ? `<a class="profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.creator)}">${escapeHtml(byLabel)}</a>`
    : escapeHtml(byLabel);
  const isOwn =
    state.connectedAddress && s.creator.toLowerCase() === state.connectedAddress.toLowerCase();
  const upvoteTitle = isOwn ? 'You cannot upvote your own short' : `Pay ${PRICE_INTERACT_CRC} CRC to upvote`;
  const violated = isShortViolated(s);
  const underReview = isShortUnderReview(s);
  const removedBadge =
    violated && state.view === 'profile'
      ? `<span class="chip chip--warn">Removed</span>`
      : '';
  const flagBtn = renderCardFlagBtn(s, { underReview, isOwn, violated });

  return `
    <article class="card short-card${violated ? ' short-card--violated' : ''}">
      <div class="short-card-media">
        ${player}
        ${flagBtn}
      </div>
      <div class="short-body">
        <div class="short-title-row">
          <h3 class="short-title clickable" data-action="go-detail" data-id="${escapeHtml(s.id)}">${shortTitleWithDurationHtml(s)}</h3>
          ${removedBadge}
        </div>
        <div class="short-sub muted">by ${byHtml} · ${escapeHtml(timeAgo(s.createdAt))}</div>
        <div class="chips chips--sm">${cats}</div>
        <div class="card-actions">
          <button
            type="button"
            class="btn btn--icon"
            data-action="card-upvote"
            data-id="${escapeHtml(s.id)}"
            ${isOwn || violated ? 'disabled' : ''}
            title="${escapeHtml(upvoteTitle)}"
          >👍 <span class="count">${s.upvotes || 0}</span></button>
          <button
            type="button"
            class="btn btn--icon"
            data-action="card-comment"
            data-id="${escapeHtml(s.id)}"
            title="Open comments"
          >💬 <span class="count">${s.comments?.length || 0}</span></button>
        </div>
      </div>
    </article>
  `;
}

function listView() {
  const shorts = filterShorts();
  const filterCount = state.filterCategories.length;
  const searchActive = Boolean(state.search.trim());
  const sortLabel = sortOptionLabel(state.sort);
  const sortIcon = sortOptionIcon(state.sort);
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

  const genreRows = submittedGenresWithCounts(state.shorts);
  const filterGenres = genreRows.map((r) => r.genre);
  const genreCounts = Object.fromEntries(genreRows.map((r) => [r.genre, r.count]));
  const durationBounds = durationFilterBounds();
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

  const searchBar = state.searchOpen
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
      <button
        class="btn btn--icon ${state.searchOpen || searchActive ? 'btn--active' : ''}"
        type="button"
        data-action="toggle-search"
        title="Search by title"
        aria-label="Search"
      >🔍</button>
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
      ><span class="sort-mode-icon" aria-hidden="true">${sortIcon}</span><span class="sort-label toolbar-text">${escapeHtml(sortLabel)}</span></button>
      <div class="toolbar-spacer"></div>
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
        title="${escapeHtml(publishTitle)}"
        aria-label="New short"
      >+</button>
    </section>

    ${searchBar}

    <section class="filters">
      ${categoryBadges(state.filterCategories, 'toggle-filter-cat')}
      ${filterDropdown}
      ${durationDropdown}
      ${sortDropdown}
    </section>

    ${feedBanner}

    <section class="list">
      ${renderShortList(shorts, { emptyHtml: empty })}
    </section>
  `;
}

function createView() {
  const d = state.createDraft;
  const priceInfo = myPublishPrice();
  const priceHint = priceInfo && publishPriceHint(priceInfo)
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

  return `
    <button class="btn btn--ghost back" type="button" data-action="go-list">← Back</button>
    <form class="card form" data-action="submit-create" novalidate>
      <h2>Publish a new short</h2>
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
        <button class="btn btn--primary" type="submit">${escapeHtml(publishButtonLabel())}</button>
        <button class="btn btn--ghost" type="button" data-action="go-list">Cancel</button>
      </div>
    </form>
  `;
}

function profileShorts() {
  const me = (state.connectedAddress || '').toLowerCase();
  if (!me) return [];
  const all = state.shorts;
  if (state.profileTab === 'published') {
    return all
      .filter((s) => s.creator?.toLowerCase() === me)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  if (state.profileTab === 'upvoted') {
    return all
      .filter((s) =>
        s.creator?.toLowerCase() !== me &&
        (s.voters || []).some((v) => v?.toLowerCase() === me),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  // commented
  return all
    .filter((s) =>
      (s.comments || []).some((c) => c.by?.toLowerCase() === me),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

function profileView() {
  if (!state.connectedAddress) {
    return `
      <button class="btn btn--ghost back" type="button" data-action="go-list">← Back</button>
      <section class="card">
        <h2>My profile</h2>
        <p class="muted">Open this app inside the Circles host and connect your wallet to see your published shorts, upvotes, and comments.</p>
      </section>
    `;
  }

  const me = profileFor(state.connectedAddress);
  const name = me?.name || shortAddress(state.connectedAddress);
  const initial = ((me?.name || state.connectedAddress).trim().charAt(0) || '?').toUpperCase();
  const avatar = me?.imageUrl
    ? `<img class="avatar avatar--lg" src="${escapeHtml(me.imageUrl)}" alt="" />`
    : `<span class="avatar avatar--lg avatar--placeholder" aria-hidden="true">${escapeHtml(initial)}</span>`;
  const profileUrl = circlesProfileUrl(state.connectedAddress);
  const addressBtn = profileUrl
    ? `<a class="profile-link profile-address" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(state.connectedAddress)}">${escapeHtml(shortAddress(state.connectedAddress))}</a>`
    : `<span class="profile-address" title="${escapeHtml(state.connectedAddress)}">${escapeHtml(shortAddress(state.connectedAddress))}</span>`;

  const all = state.shorts;
  const meLower = state.connectedAddress.toLowerCase();
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
  };

  const flagWins = countFlaggerWins(state.connectedAddress, all);
  const strikes = countCreatorViolations(state.connectedAddress, all);
  const karmaHtml = `
    <div class="profile-karma-row">
      <button
        type="button"
        class="profile-karma profile-karma--strike"
        data-action="karma-tip"
        data-karma="strike"
        title="${escapeHtml(STRIKE_KARMA_TIP)}"
        aria-label="${escapeHtml(STRIKE_KARMA_TIP)}"
      >🚩 ${strikes}</button>
      <button
        type="button"
        class="profile-karma profile-karma--praise"
        data-action="karma-tip"
        data-karma="praise"
        title="${escapeHtml(PRAISE_KARMA_TIP)}"
        aria-label="${escapeHtml(PRAISE_KARMA_TIP)}"
      >🙏 ${flagWins}</button>
    </div>
  `;

  const tabs = [
    { key: 'published', label: 'Published' },
    { key: 'upvoted', label: 'Upvoted' },
    { key: 'commented', label: 'Commented' },
  ];

  const tabBar = `
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
            >
              ${escapeHtml(t.label)}
              <span class="tab-count">${counts[t.key]}</span>
            </button>
          `,
        )
        .join('')}
    </nav>
  `;

  const items = profileShorts();
  const emptyLabel = {
    published: 'You haven\'t published any shorts yet. Tap + to publish your first one.',
    upvoted: 'You haven\'t upvoted any shorts yet.',
    commented: 'You haven\'t commented on any shorts yet.',
  }[state.profileTab];
  const empty = items.length === 0 ? `<p class="empty">${escapeHtml(emptyLabel)}</p>` : '';

  return `
    <button class="btn btn--ghost back" type="button" data-action="go-list">← Back</button>
    <section class="card profile-header">
      ${avatar}
      <div class="profile-meta">
        <h2 class="profile-name">${escapeHtml(name)}</h2>
        ${addressBtn}
        ${karmaHtml}
      </div>
    </section>
    ${tabBar}
    <section class="list">
      ${renderShortList(items, { emptyHtml: empty })}
    </section>
  `;
}

function detailView() {
  const s = getShort(state.selectedShortId);
  if (!s) {
    return `
      <button class="btn btn--ghost back" type="button" data-action="go-list">← Back</button>
      <p class="empty">Short not found.</p>
    `;
  }
  const embed = videoEmbedUrl(s.url);
  const player = embed
    ? videoPlayerHtml({ embed, variant: 'bleed', lazy: false, shortId: s.id, videoUrl: s.url })
    : `<p>${videoLinkHtml(s.url, { className: 'video-link player-link' })}</p>`;
  const cats = (s.categories || [])
    .map((c) => `<span class="chip chip--sm">${escapeHtml(c)}</span>`)
    .join('');
  const isOwn =
    state.connectedAddress && s.creator.toLowerCase() === state.connectedAddress.toLowerCase();
  const violated = isShortViolated(s);
  const underReview = isShortUnderReview(s);
  const creatorName = profileNameFor(s.creator) || shortAddress(s.creator);
  const creatorUrl = circlesProfileUrl(s.creator);
  const creatorHtml = creatorUrl
    ? `<a class="profile-link" href="${escapeHtml(creatorUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.creator)}">${escapeHtml(creatorName)}</a>`
    : escapeHtml(creatorName);
  const comments = (s.comments || [])
    .slice()
    .reverse()
    .map(
      (c) => {
        const cname = profileNameFor(c.by) || shortAddress(c.by);
        const curl = circlesProfileUrl(c.by);
        const chtml = curl
          ? `<a class="profile-link" href="${escapeHtml(curl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(c.by)}">${escapeHtml(cname)}</a>`
          : escapeHtml(cname);
        return `
        <li class="comment">
          <div class="comment-meta muted">${chtml} · ${escapeHtml(timeAgo(c.createdAt))}</div>
          <div>${escapeHtml(c.text)}</div>
        </li>
      `;
      },
    )
    .join('');
  return `
    <button class="btn btn--ghost back" type="button" data-action="go-list">← Back</button>
    <article class="card detail${violated ? ' detail--violated' : ''}">
      <h2>${shortTitleWithDurationHtml(s)}</h2>
      <div class="short-sub muted">by ${creatorHtml} · ${escapeHtml(timeAgo(s.createdAt))}</div>
      <div class="chips chips--sm">${cats}</div>
      ${violated ? '<p class="moderation-removed-banner">This short was removed after community moderation.</p>' : `
        <div class="short-card-media detail-media">
          ${player}
          ${renderCardFlagBtn(s, { underReview, isOwn, violated, onDetail: true })}
        </div>
      `}
      ${
        violated
          ? ''
          : `<div class="actions-row">
        <button
          class="btn btn--primary"
          type="button"
          data-action="upvote"
          ${isOwn ? 'disabled title="You cannot upvote your own short"' : ''}
        >👍 Upvote ${s.upvotes || 0} · ${PRICE_INTERACT_CRC} CRC</button>
      </div>`
      }
    </article>

    ${renderModerationPanel(s)}

    <section class="card">
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
  app.querySelectorAll('[data-action="go-create"]').forEach((el) =>
    el.addEventListener('click', () => setView('create')),
  );
  app.querySelectorAll('[data-action="go-profile"]').forEach((el) =>
    el.addEventListener('click', () => setView('profile')),
  );
  app.querySelectorAll('[data-action="profile-tab"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.tab;
      if (tab) setProfileTab(tab);
    }),
  );
  app.querySelectorAll('[data-action="karma-tip"]').forEach((el) =>
    el.addEventListener('click', () => {
      const tip =
        el.dataset.karma === 'strike' ? STRIKE_KARMA_TIP : PRAISE_KARMA_TIP;
      setStatus('success', tip);
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
      publishShort({
        title: d.title,
        url: d.url,
        categories: d.categories,
      })
        .catch(() => {})
        .finally(() => {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  // Card actions (list)
  app.querySelectorAll('[data-action="card-upvote"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      e.currentTarget.disabled = true;
      upvoteAction(id).catch(() => {});
    }),
  );
  app.querySelectorAll('[data-action="card-comment"]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (id) setView('detail', id);
    }),
  );

  // Detail actions
  const upvoteBtn = app.querySelector('[data-action="upvote"]');
  if (upvoteBtn) {
    upvoteBtn.addEventListener('click', () => {
      if (!state.selectedShortId) return;
      upvoteBtn.disabled = true;
      upvoteAction(state.selectedShortId)
        .catch(() => {})
        .finally(() => {
          upvoteBtn.disabled = false;
        });
    });
  }
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
    '[data-action="toggle-filter-open"], [data-action="toggle-duration-filter-open"], [data-action="toggle-sort-open"], [data-action="toggle-create-open"]',
  );

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
  const link = e.target.closest && e.target.closest('a.profile-link, a.video-link');
  if (!link) return;
  e.preventDefault();
  const url = link.getAttribute('href');
  if (!url) return;
  const isVideo = link.classList.contains('video-link');
  copyToClipboard(url).then((ok) => {
    if (ok) {
      setStatus('success', isVideo ? 'Video link copied.' : 'Profile link copied.');
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
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('click', handleCopyLinkClick);
    outsideInstalled = true;
  }
}
