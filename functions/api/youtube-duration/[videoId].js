import { fetchYoutubeDurationInnertube } from '../../../lib/youtubeInnertubeDuration.js';

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

  try {
    const apiKey =
      context.env.YOUTUBE_API_KEY?.trim() || context.env.VITE_YOUTUBE_API_KEY?.trim() || '';
    const durationSeconds = await fetchYoutubeDurationInnertube(videoId, { apiKey });
    return new Response(JSON.stringify({ durationSeconds }), {
      headers: cacheHeaders(durationSeconds),
    });
  } catch {
    return new Response(JSON.stringify({ durationSeconds: null }), {
      status: 502,
      headers: cacheHeaders(null),
    });
  }
}
