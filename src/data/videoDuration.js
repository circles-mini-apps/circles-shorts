import { parseIso8601Duration } from '../utils/duration.js';

const CACHE_KEY = 'circles-shorts:video-duration:v2';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT = 2;

/** @type {Map<string, number | null>} */
const memoryCache = new Map();
/** @type {Map<string, Promise<number | null>>} */
const inflight = new Map();
/** @type {Promise<void> | null} */
let ytApiPromise = null;

function readDiskCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDiskCache(url, seconds) {
  try {
    const cache = readDiskCache();
    cache[url] = seconds;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota / private mode */
  }
}

/** @param {string | null | undefined} rawUrl */
export function parseVideoSource(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const u = new URL(rawUrl.trim());
    const h = u.hostname.toLowerCase();

    if (h === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id ? { provider: 'youtube', id, url: rawUrl } : null;
    }
    if (h.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return { provider: 'youtube', id: v, url: rawUrl };
      if (u.pathname.startsWith('/embed/')) {
        const id = u.pathname.replace('/embed/', '').split('/')[0];
        return id ? { provider: 'youtube', id, url: rawUrl } : null;
      }
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.replace('/shorts/', '').split('/')[0];
        return id ? { provider: 'youtube', id, url: rawUrl } : null;
      }
    }
    if (h.endsWith('vimeo.com') || h === 'player.vimeo.com') {
      const m = u.pathname.match(/\/(\d+)/);
      return m ? { provider: 'vimeo', id: m[1], url: rawUrl } : null;
    }
    if (h.endsWith('dailymotion.com')) {
      const m = u.pathname.match(/\/video\/([^_/?#]+)/);
      return m ? { provider: 'dailymotion', id: m[1], url: rawUrl } : null;
    }
    if (h.endsWith('streamable.com')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id ? { provider: 'streamable', id, url: rawUrl } : null;
    }
    return { provider: 'oembed', id: null, url: rawUrl };
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @returns {number | null | undefined} undefined = not cached yet
 */
export function getCachedVideoDuration(url) {
  if (!url) return undefined;
  if (memoryCache.has(url)) return memoryCache.get(url) ?? null;
  const disk = readDiskCache()[url];
  if (typeof disk === 'number' && disk > 0) {
    memoryCache.set(url, disk);
    return disk;
  }
  if (disk === null) {
    memoryCache.set(url, null);
    return null;
  }
  return undefined;
}

function rememberDuration(url, seconds) {
  const value = typeof seconds === 'number' && seconds > 0 ? Math.round(seconds) : null;
  memoryCache.set(url, value);
  writeDiskCache(url, value);
  return value;
}

function loadYouTubeIframeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      resolve();
    };

    if (existing && window.YT?.Player) {
      resolve();
      return;
    }
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => reject(new Error('YouTube iframe API failed to load'));
      document.head.appendChild(tag);
    }

    setTimeout(() => {
      if (window.YT?.Player) resolve();
    }, 5000);
  });

  return ytApiPromise;
}

/** @param {string} videoId */
async function fetchYouTubeDurationViaProxy(videoId) {
  try {
    const res = await fetch(`/api/youtube-duration/${encodeURIComponent(videoId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const seconds = data?.durationSeconds;
    return typeof seconds === 'number' && seconds > 0 ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}

/** @param {string} videoId */
async function fetchYouTubeDurationViaDataApi(videoId) {
  const key = import.meta.env.VITE_YOUTUBE_API_KEY?.trim();
  if (!key) return null;
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('id', videoId);
    url.searchParams.set('key', key);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const iso = data?.items?.[0]?.contentDetails?.duration;
    return parseIso8601Duration(iso);
  } catch {
    return null;
  }
}

/** @param {string} videoId */
async function fetchYouTubeDurationIframe(videoId) {
  await loadYouTubeIframeApi();
  if (!window.YT?.Player) return null;

  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.hidden = true;
    document.body.appendChild(host);

    let settled = false;
    /** @type {{ destroy?: () => void } | undefined} */
    let player;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        player?.destroy?.();
      } catch {
        /* ignore */
      }
      host.remove();
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), FETCH_TIMEOUT_MS);

    try {
      player = new window.YT.Player(host, {
        videoId,
        width: 1,
        height: 1,
        playerVars: { controls: 0, playsinline: 1 },
        events: {
          onReady: (event) => {
            clearTimeout(timer);
            const d = event.target.getDuration();
            finish(typeof d === 'number' && d > 0 ? Math.round(d) : null);
          },
          onError: () => {
            clearTimeout(timer);
            finish(null);
          },
        },
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/** @param {string} videoId */
async function fetchYouTubeDuration(videoId) {
  const fromDataApi = await fetchYouTubeDurationViaDataApi(videoId);
  if (fromDataApi) return fromDataApi;

  const fromProxy = await fetchYouTubeDurationViaProxy(videoId);
  if (fromProxy) return fromProxy;

  return fetchYouTubeDurationIframe(videoId);
}

async function fetchOembedDuration(oembedUrl) {
  const res = await fetch(oembedUrl);
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data.duration === 'number' && data.duration > 0
    ? Math.round(data.duration)
    : null;
}

/** @param {{ provider: string; id: string | null; url: string }} source */
async function fetchDurationForSource(source) {
  const { provider, id, url } = source;

  if (provider === 'youtube' && id) {
    return fetchYouTubeDuration(id);
  }
  if (provider === 'vimeo') {
    return fetchOembedDuration(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
    );
  }
  if (provider === 'dailymotion') {
    return fetchOembedDuration(
      `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(url)}`,
    );
  }
  if (provider === 'streamable') {
    return fetchOembedDuration(
      `https://api.streamable.com/oembed.json?url=${encodeURIComponent(url)}`,
    );
  }
  if (provider === 'oembed') {
    return fetchOembedDuration(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
  }
  return null;
}

/**
 * @param {string} url
 * @returns {Promise<number | null>}
 */
export async function resolveVideoDuration(url) {
  if (!url) return null;

  const cached = getCachedVideoDuration(url);
  if (cached !== undefined) return cached;

  if (inflight.has(url)) return inflight.get(url);

  const task = (async () => {
    const source = parseVideoSource(url);
    if (!source) {
      rememberDuration(url, null);
      return null;
    }
    try {
      const seconds = await fetchDurationForSource(source);
      return rememberDuration(url, seconds);
    } catch {
      return rememberDuration(url, null);
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, task);
  return task;
}

/**
 * @param {Array<{ url?: string; durationSeconds?: number | null }>} shorts
 * @param {() => void} [onUpdate]
 */
export async function ensureVideoDurations(shorts, onUpdate) {
  const urls = [
    ...new Set(
      shorts
        .filter((s) => typeof s.durationSeconds !== 'number' || s.durationSeconds <= 0)
        .map((s) => s.url)
        .filter(Boolean),
    ),
  ].filter((url) => getCachedVideoDuration(url) === undefined);

  if (!urls.length) return;

  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      const seconds = await resolveVideoDuration(url);
      onUpdate?.(url, seconds);
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, urls.length) }, worker);
  await Promise.all(workers);
}

/** Hydrate in-memory cache from localStorage (call once on startup). */
export function hydrateVideoDurationCache() {
  const disk = readDiskCache();
  for (const [url, sec] of Object.entries(disk)) {
    if (typeof sec === 'number' && sec > 0) memoryCache.set(url, sec);
    else if (sec === null) memoryCache.set(url, null);
  }
}

/**
 * @param {{ url?: string; durationSeconds?: number | null }} short
 * @param {Record<string, number | null>} [videoDurations]
 * @returns {number | null}
 */
export function getShortDurationSeconds(short, videoDurations = {}) {
  if (typeof short.durationSeconds === 'number' && short.durationSeconds > 0) {
    return short.durationSeconds;
  }
  const fromState = videoDurations[short.url];
  if (typeof fromState === 'number' && fromState > 0) return fromState;
  const cached = getCachedVideoDuration(short.url);
  return typeof cached === 'number' && cached > 0 ? cached : null;
}

/**
 * @param {Array<{ url?: string; durationSeconds?: number | null }>} shorts
 * @param {Record<string, number | null>} [videoDurations]
 * @returns {{ min: number; max: number } | null}
 */
export function durationBoundsForShorts(shorts, videoDurations = {}) {
  const secs = shorts
    .map((s) => getShortDurationSeconds(s, videoDurations))
    .filter((d) => d != null);
  if (!secs.length) return null;
  return { min: Math.min(...secs), max: Math.max(...secs) };
}
