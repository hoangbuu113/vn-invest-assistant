import { yahooProvider } from './yahoo.js';

export const MARKET_PROVIDERS = Object.freeze({
  yahoo: yahooProvider
});

/**
 * Resolves a market provider adapter by its normalized provider identifier.
 * @param {string} providerName - Provider key (e.g. 'yahoo')
 * @returns {Object|null} - Provider adapter implementing getSnapshot and getHistory, or null if unsupported
 */
export function getProviderAdapter(providerName) {
  if (!providerName || typeof providerName !== 'string') {
    return null;
  }
  return MARKET_PROVIDERS[providerName.trim().toLowerCase()] || null;
}
