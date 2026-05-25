import { countCreatorViolations, countFlaggerWins } from './moderation.js';

/** Base publish fee before strikes / karma adjustments. */
export const PUBLISH_BASE_CRC = 1;

/** Extra CRC per removed short (🚩) on the creator's profile. */
export const STRIKE_PUBLISH_SURCHARGE_CRC = 0.5;

/** CRC discount per successful flag (🙏) when publishing. */
export const KARMA_PUBLISH_DISCOUNT_CRC = 0.1;

/**
 * @param {string | null | undefined} address
 * @param {import('./storage.js').ShortRecord[]} shorts
 */
export function computePublishPrice(address, shorts) {
  const strikes = countCreatorViolations(address, shorts);
  const karma = countFlaggerWins(address, shorts);
  const raw =
    PUBLISH_BASE_CRC + strikes * STRIKE_PUBLISH_SURCHARGE_CRC - karma * KARMA_PUBLISH_DISCOUNT_CRC;
  const priceNum = Math.max(0, Math.round(raw * 10) / 10);
  const priceCrc = Number.isInteger(priceNum) ? String(priceNum) : priceNum.toFixed(1);

  return {
    priceCrc,
    priceNum,
    strikes,
    karma,
    isFree: priceNum === 0,
  };
}

export function formatPublishPriceLabel(info) {
  return info.isFree ? 'Free' : `${info.priceCrc} CRC`;
}

export function publishPriceHint(info) {
  if (!info.strikes && !info.karma) return '';
  const parts = [`Base ${PUBLISH_BASE_CRC} CRC`];
  if (info.strikes) parts.push(`+ ${info.strikes}×${STRIKE_PUBLISH_SURCHARGE_CRC} 🚩`);
  if (info.karma) parts.push(`− ${info.karma}×${KARMA_PUBLISH_DISCOUNT_CRC} 🙏`);
  parts.push(`= ${formatPublishPriceLabel(info)}`);
  return parts.join(' ');
}

export const STRIKE_KARMA_TIP =
  `Strikes (🚩): shorts of yours removed after community moderation. Each strike adds +${STRIKE_PUBLISH_SURCHARGE_CRC} CRC to your publish price.`;

export const PRAISE_KARMA_TIP =
  `Karma (🙏): flags you submitted that were upheld. Each gives −${KARMA_PUBLISH_DISCOUNT_CRC} CRC off publish until it is free.`;
