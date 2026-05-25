/** Canonical genre list. Used in both create and filter dropdowns. */
export const DEFAULT_GENRES = [
  'Action',
  'Adult',
  'Adventure',
  'Animation',
  'Biography',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'Film-Noir',
  'Game-Show',
  'History',
  'Horror',
  'Musical',
  'Music',
  'Mystery',
  'News',
  'Reality-TV',
  'Romance',
  'Sci-Fi',
  'Short',
  'Sport',
  'Talk-Show',
  'Thriller',
  'War',
  'Western',
];

/** Backwards-compatible alias kept in case other modules import it. */
export const DEFAULT_CATEGORIES = DEFAULT_GENRES;

/** Case-insensitive lookup → canonical genre, or null if unknown. */
export function canonicalGenre(value) {
  if (!value || typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  return DEFAULT_GENRES.find((g) => g.toLowerCase() === lower) || null;
}

export function allKnownCategories() {
  return [...DEFAULT_GENRES].sort((a, b) => a.localeCompare(b));
}

/** Same canonical list — used by the filter dropdown for predictability. */
export function existingCategories() {
  return allKnownCategories();
}
