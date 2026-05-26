import { fetchYoutubeDurationInnertube } from '../../../lib/youtubeInnertubeDuration.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=86400',
};

export async function onRequestGet(context) {
  const videoId = context.params.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return new Response(JSON.stringify({ durationSeconds: null, error: 'invalid id' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const durationSeconds = await fetchYoutubeDurationInnertube(videoId);
    return new Response(JSON.stringify({ durationSeconds }), { headers: JSON_HEADERS });
  } catch {
    return new Response(JSON.stringify({ durationSeconds: null }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
}
