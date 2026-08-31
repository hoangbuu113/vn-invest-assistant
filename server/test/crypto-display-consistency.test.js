import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getWatchlistDisplayCurrency,
  isCryptoDisplayAsset,
  selectCryptoWatchlistDisplayData
} from '../../client/src/utils/watchlistDisplay.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(testDir, '..', '..', 'client', 'src', 'App.jsx');

describe('Feature 26 production closeout — Crypto display-price consistency', () => {
  test('prefers a valid Binance realtime USDT observation over a valid CoinGecko USD snapshot', () => {
    const realtime = { price: 0.3512, currency: 'USDT', priceSource: 'binance_websocket' };
    const snapshot = { price: 0.3498, currency: 'USD', priceSource: 'coingecko_market_snapshot' };

    const selected = selectCryptoWatchlistDisplayData({ realtime, snapshot });

    assert.equal(selected, realtime);
    assert.equal(getWatchlistDisplayCurrency(selected, { quoteCurrency: 'USD' }), 'USDT');
  });

  test('falls back to the canonical CoinGecko USD snapshot when realtime is unavailable', () => {
    const snapshot = { price: 102.67, currency: 'USD', priceSource: 'coingecko_market_snapshot' };

    const selected = selectCryptoWatchlistDisplayData({ realtime: null, snapshot });

    assert.equal(selected, snapshot);
    assert.equal(getWatchlistDisplayCurrency(selected, { quoteCurrency: 'USD' }), 'USD');
  });

  test('returns unavailable when neither source has a valid, truthfully denominated price', () => {
    assert.equal(selectCryptoWatchlistDisplayData({ realtime: null, snapshot: null }), null);
    assert.equal(
      selectCryptoWatchlistDisplayData({
        realtime: { price: 1, currency: 'USD' },
        snapshot: { price: 1, currency: 'USDT' }
      }),
      null
    );
  });

  test('recognizes canonical Crypto metadata without treating other assets as Crypto', () => {
    assert.equal(isCryptoDisplayAsset({ assetType: 'crypto' }), true);
    assert.equal(isCryptoDisplayAsset({ asset_type: 'CRYPTO' }), true);
    assert.equal(isCryptoDisplayAsset({ assetType: 'stock' }), false);
  });

  test('keeps display routing separate from canonical snapshot data used by alerts', () => {
    const app = fs.readFileSync(appPath, 'utf8');

    assert.match(app, /const \[watchlistDisplayMarketData, setWatchlistDisplayMarketData\] = useState\(\{\}\)/);
    assert.match(app, /`\/api\/market\/\$\{encodedSymbol\}\/realtime`/);
    assert.match(app, /`\/api\/market\/\$\{encodedSymbol\}`/);
    assert.match(app, /computeWatchlistMovers\(watchlist, watchlistDisplayMarketData\)/);
    assert.match(app, /const mkt = watchlistDisplayMarketData\[sym\]/);
    assert.match(app, /watchlistMarketData\[alertTargetAsset\.symbol\]\?\.price/);
    assert.doesNotMatch(app, /watchlistDisplayMarketData\[alertTargetAsset\.symbol\]\?\.price/);
  });
});
