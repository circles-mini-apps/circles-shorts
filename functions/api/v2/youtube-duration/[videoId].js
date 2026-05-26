import { fetchYoutubeDurationInnertube } from '../../../../lib/youtubeInnertubeDuration.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/** @param {number | null} durationSeconds */
function cacheHeaders(durationSeconds) {
  if (durationSeconds != null) {
    return { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=86400' };
  }
  return { ...JSON_HEADERS, 'Cache-Control': 'no-store' };
}

export async function onRequestGet(context) {
  const videoId = context.params.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return new Response(JSON.stringify({ durationSeconds: null, error: 'invalid id' }), {
      status: 400,
      headers: cacheHeaders(null),
    });
  }

  const debug = new URL(context.request.url).searchParams.get('debug') === '1';
  const apiKey =
    context.env.YOUTUBE_API_KEY?.trim() || context.env.VITE_YOUTUBE_API_KEY?.trim() || '';

  try {
    const result = await fetchYoutubeDurationInnertube(videoId, { apiKey, debug });
    const body =
      debug && typeof result === 'object' && result !== null && 'attempts' in result
        ? result
        : { durationSeconds: result };
    const resolved =
      debug && typeof result === 'object' && result !== null && 'durationSeconds' in result
        ? result.durationSeconds
        : result;

    return new Response(JSON.stringify(body), {
      headers: cacheHeaders(typeof resolved === 'number' ? resolved : null),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    return new Response(JSON.stringify({ durationSeconds: null, error: message }), {
      status: 502,
      headers: cacheHeaders(null),
    });
  }
}
