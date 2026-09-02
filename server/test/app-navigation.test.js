import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VALID_NAV_TABS,
  DEFAULT_TAB,
  isValidTab,
  parseRouteFromHash,
  serializeRoute,
  isSameRoute
} from '../../client/src/utils/appNavigation.js';

describe('V1.1 Improvement 11 — Browser History & Deep Linking Contract', () => {
  test('validates all canonical navigation tabs', () => {
    assert.deepEqual([...VALID_NAV_TABS], [
      'dashboard',
      'portfolio',
      'watchlist',
      'opportunities',
      'news',
      'assets',
      'profile'
    ]);

    for (const tab of VALID_NAV_TABS) {
      assert.equal(isValidTab(tab), true);
    }
    assert.equal(isValidTab('invalid'), false);
    assert.equal(isValidTab(null), false);
    assert.equal(isValidTab(''), false);
  });

  test('parses empty and default hash routes', () => {
    assert.deepEqual(parseRouteFromHash(''), { tab: 'dashboard', symbol: null, isFallback: false });
    assert.deepEqual(parseRouteFromHash('#'), { tab: 'dashboard', symbol: null, isFallback: false });
    assert.deepEqual(parseRouteFromHash(null), { tab: 'dashboard', symbol: null, isFallback: false });
    assert.deepEqual(parseRouteFromHash('   '), { tab: 'dashboard', symbol: null, isFallback: false });
  });

  test('parses primary tab hash routes without leading # or with #', () => {
    for (const tab of VALID_NAV_TABS) {
      const withHash = parseRouteFromHash(`#${tab}`);
      assert.equal(withHash.tab, tab);
      assert.equal(withHash.symbol, null);
      assert.equal(withHash.isFallback, false);

      const withoutHash = parseRouteFromHash(tab);
      assert.equal(withoutHash.tab, tab);
      assert.equal(withoutHash.symbol, null);
      assert.equal(withoutHash.isFallback, false);
    }
  });

  test('parses canonical asset detail routes and decodes symbol', () => {
    const btc = parseRouteFromHash('#assets/BTC');
    assert.deepEqual(btc, { tab: 'assets', symbol: 'BTC', isFallback: false });

    const fpt = parseRouteFromHash('#assets/FPT');
    assert.deepEqual(fpt, { tab: 'assets', symbol: 'FPT', isFallback: false });

    const e1vfvn30 = parseRouteFromHash('#assets/E1VFVN30');
    assert.deepEqual(e1vfvn30, { tab: 'assets', symbol: 'E1VFVN30', isFallback: false });
  });

  test('safely encodes and decodes reserved character symbols like XAU/USD', () => {
    const rawSymbol = 'XAU/USD';
    const serialized = serializeRoute({ tab: 'assets', symbol: rawSymbol });
    assert.equal(serialized, '#assets/XAU%2FUSD');

    const parsed = parseRouteFromHash(serialized);
    assert.deepEqual(parsed, { tab: 'assets', symbol: 'XAU/USD', isFallback: false });
  });

  test('handles malformed percent encoding gracefully without crashing', () => {
    const malformed = parseRouteFromHash('#assets/%E0%A4%A');
    assert.equal(malformed.tab, 'assets');
    assert.equal(malformed.symbol, null);
    assert.equal(malformed.isFallback, true);

    const malformedPercent = parseRouteFromHash('#assets/%%%');
    assert.equal(malformedPercent.tab, 'assets');
    assert.equal(malformedPercent.symbol, null);
    assert.equal(malformedPercent.isFallback, true);
  });

  test('falls back safely for unknown or invalid routes', () => {
    const unknown = parseRouteFromHash('#nonexistent-view');
    assert.deepEqual(unknown, { tab: DEFAULT_TAB, symbol: null, isFallback: true });

    const emptyAsset = parseRouteFromHash('#assets/');
    assert.deepEqual(emptyAsset, { tab: 'assets', symbol: null, isFallback: false });
  });

  test('serializes canonical routes reliably', () => {
    assert.equal(serializeRoute({ tab: 'portfolio' }), '#portfolio');
    assert.equal(serializeRoute({ tab: 'watchlist' }), '#watchlist');
    assert.equal(serializeRoute({ tab: 'assets', symbol: 'BTC' }), '#assets/BTC');
    assert.equal(serializeRoute({ tab: 'assets', symbol: '  ETH  ' }), '#assets/ETH');
    assert.equal(serializeRoute({ tab: 'invalid_tab' }), '#dashboard');
  });

  test('round-trips all tabs and representative asset symbols', () => {
    const testCases = [
      { tab: 'dashboard', symbol: null },
      { tab: 'portfolio', symbol: null },
      { tab: 'watchlist', symbol: null },
      { tab: 'opportunities', symbol: null },
      { tab: 'news', symbol: null },
      { tab: 'assets', symbol: null },
      { tab: 'profile', symbol: null },
      { tab: 'assets', symbol: 'BTC' },
      { tab: 'assets', symbol: 'ETH' },
      { tab: 'assets', symbol: 'FPT' },
      { tab: 'assets', symbol: 'VCB' },
      { tab: 'assets', symbol: 'XAU/USD' }
    ];

    for (const testCase of testCases) {
      const hash = serializeRoute(testCase);
      const parsed = parseRouteFromHash(hash);
      assert.equal(parsed.tab, testCase.tab);
      assert.equal(parsed.symbol, testCase.symbol);
      assert.equal(parsed.isFallback, false);
    }
  });

  test('detects identical routes correctly with isSameRoute', () => {
    assert.equal(isSameRoute({ tab: 'portfolio', symbol: null }, { tab: 'portfolio', symbol: null }), true);
    assert.equal(isSameRoute({ tab: 'assets', symbol: 'BTC' }, { tab: 'assets', symbol: 'BTC' }), true);
    assert.equal(isSameRoute({ tab: 'assets', symbol: 'BTC' }, { tab: 'assets', symbol: 'ETH' }), false);
    assert.equal(isSameRoute({ tab: 'portfolio', symbol: null }, { tab: 'watchlist', symbol: null }), false);
    assert.equal(isSameRoute(null, { tab: 'portfolio' }), false);
  });
});
