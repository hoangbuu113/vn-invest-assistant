export const VALID_NAV_TABS = Object.freeze([
  'dashboard',
  'portfolio',
  'watchlist',
  'opportunities',
  'news',
  'assets',
  'profile'
]);

export const DEFAULT_TAB = 'dashboard';

export function isValidTab(tab) {
  return typeof tab === 'string' && VALID_NAV_TABS.includes(tab);
}

export function parseRouteFromHash(rawHash = '') {
  if (typeof rawHash !== 'string' || !rawHash || rawHash === '#') {
    return {
      tab: DEFAULT_TAB,
      symbol: null,
      isFallback: false
    };
  }

  const cleanHash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const trimmed = cleanHash.trim();

  if (!trimmed) {
    return {
      tab: DEFAULT_TAB,
      symbol: null,
      isFallback: false
    };
  }

  // Check asset detail pattern: assets/<encoded-symbol>
  if (trimmed.startsWith('assets/')) {
    const rawSymbol = trimmed.slice('assets/'.length);
    if (rawSymbol) {
      try {
        const decodedSymbol = decodeURIComponent(rawSymbol).trim();
        if (decodedSymbol) {
          return {
            tab: 'assets',
            symbol: decodedSymbol,
            isFallback: false
          };
        }
      } catch {
        // Malformed URI component fallback
        return {
          tab: 'assets',
          symbol: null,
          isFallback: true
        };
      }
    }
    return {
      tab: 'assets',
      symbol: null,
      isFallback: false
    };
  }

  // Check valid tab
  if (VALID_NAV_TABS.includes(trimmed)) {
    return {
      tab: trimmed,
      symbol: null,
      isFallback: false
    };
  }

  // Unknown/unsupported route fallback
  return {
    tab: DEFAULT_TAB,
    symbol: null,
    isFallback: true
  };
}

export function serializeRoute({ tab = DEFAULT_TAB, symbol = null } = {}) {
  const safeTab = isValidTab(tab) ? tab : DEFAULT_TAB;

  if (symbol && typeof symbol === 'string' && symbol.trim()) {
    const encoded = encodeURIComponent(symbol.trim());
    return `#assets/${encoded}`;
  }

  return `#${safeTab}`;
}

export function isSameRoute(routeA, routeB) {
  if (!routeA || !routeB) return false;
  const tabA = routeA.tab || DEFAULT_TAB;
  const tabB = routeB.tab || DEFAULT_TAB;
  const symA = routeA.symbol || null;
  const symB = routeB.symbol || null;
  return tabA === tabB && symA === symB;
}
