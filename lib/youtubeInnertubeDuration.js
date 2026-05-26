/** @param {string} videoId */
export async function fetchYoutubeDurationInnertube(videoId) {
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return null;

  const res = await fetch(
    'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20250401.00.00',
          },
        },
      }),
    },
  );

  if (!res.ok) return null;

  const data = await res.json();
  const raw = data?.videoDetails?.lengthSeconds;
  const seconds = raw != null ? parseInt(String(raw), 10) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
