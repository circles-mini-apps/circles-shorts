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
