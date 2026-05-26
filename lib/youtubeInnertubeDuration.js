const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

/** @type {Array<{ context: Record<string, unknown>; headers?: Record<string, string> }>} */
const INNERTUBE_CLIENTS = [
  {
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 30,
        hl: 'en',
        gl: 'US',
      },
    },
    headers: {
      'User-Agent':
        'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
    },
  },
  {
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '20.10.4',
        deviceModel: 'iPhone14,3',
        osName: 'iOS',
        osVersion: '17.0',
        hl: 'en',
        gl: 'US',
      },
    },
    headers: {
      'User-Agent':
        'com.google.ios.youtube/20.10.4 (iPhone14,3; U; CPU iOS 17_0 like Mac OS X)',
    },
  },
  {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20250401.00.00',
      },
    },
  },
];

/** @param {string | null | undefined} iso */
function parseIso8601Duration(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const total =
    parseInt(m[1] || '0', 10) * 3600 +
    parseInt(m[2] || '0', 10) * 60 +
    parseInt(m[3] || '0', 10);
  return total > 0 ? total : null;
}

/**
 * @param {unknown} data
 * @returns {number | null}
 */
function parseDurationSeconds(data) {
  const raw = /** @type {{ videoDetails?: { lengthSeconds?: unknown } }} */ (data)
    ?.videoDetails?.lengthSeconds;
  const seconds = raw != null ? parseInt(String(raw), 10) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** @param {string} videoId @param {string} apiKey */
async function fetchDurationFromDataApi(videoId, apiKey) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const iso = data?.items?.[0]?.contentDetails?.duration;
  return parseIso8601Duration(iso);
}

/**
 * @param {string} videoId
 * @param {{ apiKey?: string; debug?: boolean }} [options]
 * @returns {Promise<number | null | { durationSeconds: number | null; attempts: Array<Record<string, unknown>> }>}
 */
export async function fetchYoutubeDurationInnertube(videoId, options = {}) {
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return options.debug ? { durationSeconds: null, attempts: [] } : null;
  }

  /** @type {Array<Record<string, unknown>>} */
  const attempts = [];

  for (const clientConfig of INNERTUBE_CLIENTS) {
    const clientName = String(clientConfig.context?.client?.clientName ?? 'unknown');
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...clientConfig.headers,
        },
        body: JSON.stringify({
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
          context: clientConfig.context,
        }),
      },
    );

    let seconds = null;
    if (res.ok) {
      const data = await res.json();
      seconds = parseDurationSeconds(data);
    }

    attempts.push({ client: clientName, seconds, status: res.status });
    if (seconds != null) {
      return options.debug ? { durationSeconds: seconds, attempts } : seconds;
    }
  }

  const apiKey = options.apiKey?.trim();
  if (apiKey) {
    const fromApi = await fetchDurationFromDataApi(videoId, apiKey);
    attempts.push({ client: 'DATA_API', seconds: fromApi, status: fromApi != null ? 200 : 0 });
    if (fromApi != null) {
      return options.debug ? { durationSeconds: fromApi, attempts } : fromApi;
    }
  }

  return options.debug ? { durationSeconds: null, attempts } : null;
}
