/** Parse YouTube Data API duration (e.g. PT4M13S). */
export function parseIso8601Duration(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const total =
    parseInt(m[1] || '0', 10) * 3600 +
    parseInt(m[2] || '0', 10) * 60 +
    parseInt(m[3] || '0', 10);
  return total > 0 ? total : null;
}

/** @param {number | null | undefined} totalSeconds */
export function formatDuration(totalSeconds) {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}
