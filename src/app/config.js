/** User-facing app name (header, document title). */
export const APP_NAME = '🩳 Shorts';

/** Plain name for org registration and prose (no emoji). */
export const APP_NAME_PLAIN = 'Shorts';

/** URL / repo / Cloudflare project slug. */
export const APP_SLUG = 'shorts';

/** Pinata keyvalues `app` tag for new pins. */
export const APP_NAMESPACE = 'shorts';

/** Previous namespace — still queried when syncing the feed. */
export const LEGACY_APP_NAMESPACE = 'circles-shorts';

/** JSON payload `kind` prefix for new pins. */
export const CONTENT_KIND_PREFIX = 'shorts';

/** Previous kind prefix — still accepted when reading pinned JSON. */
export const LEGACY_CONTENT_KIND_PREFIX = 'circles-shorts';

/** @param {string} suffix */
export function contentKind(suffix) {
  return `${CONTENT_KIND_PREFIX}:${suffix}`;
}

/** @param {{ kind?: string } | null | undefined} obj @param {string} suffix */
export function isContentKind(obj, suffix) {
  if (!obj?.kind) return false;
  const k = obj.kind;
  return k === `${CONTENT_KIND_PREFIX}:${suffix}` || k === `${LEGACY_CONTENT_KIND_PREFIX}:${suffix}`;
}
