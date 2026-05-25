import { getAddress, isAddress } from 'viem';
import { canonicalGenre } from '../data/categories.js';
import { FLAG_CATEGORIES, MIN_FLAG_CHARS, flagCategoryLabel } from '../data/flagReasons.js';

const MAX_TITLE = 120;
const MAX_COMMENT = 1000;
const MAX_CATEGORIES = 8;
const MAX_CATEGORY_LEN = 32;
const HTTPS = /^https:\/\//i;
const ALLOWED_VIDEO_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'player.vimeo.com',
  'tiktok.com',
  'www.tiktok.com',
  'twitch.tv',
  'www.twitch.tv',
  'streamable.com',
  'dailymotion.com',
  'www.dailymotion.com',
];

export function normalizeAddress(value) {
  if (!value || typeof value !== 'string') throw new Error('Address is required');
  if (!isAddress(value)) throw new Error('Invalid address');
  return getAddress(value);
}

export function validateTitle(value) {
  if (typeof value !== 'string') throw new Error('Title is required');
  const t = value.trim();
  if (!t) throw new Error('Title is required');
  if (t.length > MAX_TITLE) throw new Error(`Title must be at most ${MAX_TITLE} characters`);
  return t;
}

export function validateVideoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Video link is required');
  const trimmed = value.trim();
  if (!HTTPS.test(trimmed)) throw new Error('Video link must use https://');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Video link is not a valid URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_VIDEO_HOSTS.includes(host)) {
    throw new Error('Use a supported video host (YouTube, Vimeo, TikTok, Twitch, Streamable, Dailymotion)');
  }
  return trimmed;
}

export function normalizeCategoriesInput(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.split(/[,\n]/);
}

export function validateCategories(input) {
  const raw = normalizeCategoriesInput(input);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const trimmed = String(item || '').trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_CATEGORY_LEN) {
      throw new Error(`Genre "${trimmed}" is too long (max ${MAX_CATEGORY_LEN} chars)`);
    }
    const canonical = canonicalGenre(trimmed);
    if (!canonical) {
      throw new Error(`Unknown genre: "${trimmed}"`);
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  if (out.length < 1) {
    throw new Error('Add at least 1 genre');
  }
  if (out.length > MAX_CATEGORIES) {
    throw new Error(`Use at most ${MAX_CATEGORIES} genres`);
  }
  return out;
}

export function validateCommentText(value) {
  if (typeof value !== 'string') throw new Error('Comment is required');
  const t = value.trim();
  if (!t) throw new Error('Comment is required');
  if (t.length > MAX_COMMENT) {
    throw new Error(`Comment must be at most ${MAX_COMMENT} characters`);
  }
  return t;
}

const MAX_FLAG = 500;

export function validateFlagCategory(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('Select a reason from the list');
  }
  if (!FLAG_CATEGORIES.some((c) => c.value === value)) {
    throw new Error('Select a valid reason from the list');
  }
  return value;
}

export function validateFlagExplanation(value) {
  if (typeof value !== 'string') throw new Error('Add your reasoning');
  const t = value.trim();
  if (!t) throw new Error('Add your reasoning');
  if (t.length < MIN_FLAG_CHARS) {
    throw new Error(`Reasoning must be at least ${MIN_FLAG_CHARS} characters (${t.length}/${MIN_FLAG_CHARS})`);
  }
  if (t.length > MAX_FLAG) throw new Error(`Reasoning must be at most ${MAX_FLAG} characters`);
  return t;
}

/** @deprecated use validateFlagSubmission */
export function validateFlagReason(value) {
  return validateFlagExplanation(value);
}

export function validateFlagSubmission({ category, explanation }) {
  const cat = validateFlagCategory(category);
  const exp = validateFlagExplanation(explanation);
  const label = flagCategoryLabel(cat);
  return { category: cat, explanation: exp, reason: `${label}: ${exp}` };
}

export const limits = {
  MAX_TITLE,
  MAX_COMMENT,
  MAX_CATEGORIES,
  MAX_CATEGORY_LEN,
  MAX_FLAG,
  MIN_FLAG_CHARS,
};
