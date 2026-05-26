/** One-line description shown when picking genres on the publish form. */
export const GENRE_DESCRIPTIONS = {
  Action: 'Fast-paced scenes with fights, chases, stunts, and high-stakes conflict.',
  Adult: 'Mature themes intended strictly for adult audiences.',
  Adventure: 'Journeys, exploration, quests, and characters facing the unknown.',
  Animation: 'Animated or illustrated storytelling in any style or technique.',
  Biography: 'Real people and life stories, dramatized or documentary-style.',
  Comedy: 'Humor, satire, and light-hearted situations meant to entertain.',
  Crime: 'Law-breaking, investigations, criminals, and the justice system.',
  Documentary: 'Non-fiction that informs or explores real events, people, or topics.',
  Drama: 'Character-driven stories focused on emotion, relationships, and tension.',
  Family: 'Content suitable for viewers of all ages, especially children and parents.',
  Fantasy: 'Magic, mythical worlds, and rules beyond everyday reality.',
  'Film-Noir': 'Dark, stylized crime stories with moral ambiguity and shadowy mood.',
  'Game-Show': 'Quiz, competition, or prize formats typical of TV game shows.',
  History: 'Past eras, historical figures, wars, and real-world events.',
  Horror: 'Fear, suspense, and the supernatural designed to unsettle or scare.',
  Musical: 'Stories where songs and dance numbers are central to the plot.',
  Music: 'Performances, concerts, music videos, or artist-focused pieces.',
  Mystery: 'Puzzles, secrets, and plots built around discovering the truth.',
  News: 'Current events, reporting, and journalistic short-form coverage.',
  'Reality-TV': 'Unscripted or semi-scripted real-life situations and competitions.',
  Romance: 'Love, relationships, and emotional connection between characters.',
  'Sci-Fi': 'Future technology, space, science, and speculative what-if worlds.',
  Short: 'Brief experimental or art-house pieces outside standard genres.',
  Sport: 'Athletics, competitions, training, and sporting culture.',
  'Talk-Show': 'Interviews, panels, and conversational host-led formats.',
  Thriller: 'Suspense and tension where danger feels immediate and personal.',
  War: 'Armed conflict, soldiers, and the impact of war on people.',
  Western: 'Frontier settings, cowboys, outlaws, and the American West.',
};

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

/** @param {string | null | undefined} genre */
export function genreDescription(genre) {
  const canonical = canonicalGenre(genre || '');
  return canonical ? GENRE_DESCRIPTIONS[canonical] || null : null;
}

/** Genres used on published shorts, with how many shorts each genre appears on. */
export function submittedGenresWithCounts(shorts, { excludeViolated = true } = {}) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const s of shorts || []) {
    if (excludeViolated && s.moderation?.status === 'violated') continue;
    for (const raw of s.categories || []) {
      const genre = canonicalGenre(raw) || String(raw || '').trim();
      if (!genre) continue;
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

export function allKnownCategories() {
  return [...DEFAULT_GENRES].sort((a, b) => a.localeCompare(b));
}
