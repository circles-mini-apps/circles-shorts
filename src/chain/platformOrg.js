import { getAddress, isAddress } from 'viem';
import { APP_SLUG } from '../app/config.js';

/**
 * Circles organisation avatar that receives platform fees (publish + flag).
 * Override at build time with VITE_PLATFORM_ORG_ADDRESS.
 */
const DEFAULT_PLATFORM_ORG = '0x507F542f14F55315F96aD1D454859EaA5c9E1923';

function resolvePlatformOrgAddress() {
  const fromEnv = import.meta.env.VITE_PLATFORM_ORG_ADDRESS?.trim();
  const raw = fromEnv || DEFAULT_PLATFORM_ORG;
  if (!isAddress(raw)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${APP_SLUG}] Invalid VITE_PLATFORM_ORG_ADDRESS "${raw}" — using default ${DEFAULT_PLATFORM_ORG}`,
    );
    return getAddress(DEFAULT_PLATFORM_ORG);
  }
  return getAddress(raw);
}

/** Organisation avatar address for publish and flag CRC payments. */
export const PLATFORM_ORG = resolvePlatformOrgAddress();

/** @deprecated Alias for PLATFORM_ORG */
export const PLATFORM_CREATOR = PLATFORM_ORG;
