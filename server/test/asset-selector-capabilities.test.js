import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAsset,
  isHoldableVndAsset,
  isPortfolioTradeableAsset,
  isOpeningPositionSupported,
  isTransactionSupported,
  isHistoricalComparisonSupported,
  isAnalysisSupported,
  isMarketSnapshotSupported,
  filterAssetsForCapability
} from '../../client/src/utils/assetCapabilities.js';

describe('V1.1 Improvement 06 — Asset Selector Capability Contracts', () => {
  // Representative Canonical Assets
  const canonicalAssets = [
    {
      id: 'asset_fpt',
      symbol: 'FPT',
      name: 'CTCP FPT',
      asset_type: 'stock',
      quote_currency: 'VND',
      base_currency: 'VND',
      market_policy: 'VN_EXCHANGE',
      exchange: 'HOSE',
      portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
    },
    {
      id: 'asset_e1vfvn30',
      symbol: 'E1VFVN30',
      name: 'Quỹ ETF VFMVN30',
      asset_type: 'etf',
      quote_currency: 'VND',
      base_currency: 'VND',
      market_policy: 'VN_EXCHANGE',
      exchange: 'HOSE',
      portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
    },
    {
      id: 'asset_xau_usd',
      symbol: 'XAU/USD',
      name: 'Vàng Giao Ngay (USD)',
      asset_type: 'gold',
      quote_currency: 'USD',
      base_currency: 'XAU',
      market_policy: 'GLOBAL_24_5_GOLD',
      exchange: 'COMMODITY',
      portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
    },
    {
      id: 'asset_usd_vnd',
      symbol: 'USD/VND',
      name: 'Tỷ giá USD / VND',
      asset_type: 'fx',
      quote_currency: 'VND',
      base_currency: 'USD',
      market_policy: 'GLOBAL_24_5_FX',
      exchange: 'FOREX',
      portfolio_eligibility: 'REFERENCE_ONLY'
    },
    {
      id: 'asset_btc',
      symbol: 'BTC',
      name: 'Bitcoin',
      asset_type: 'crypto',
      quote_currency: 'USD',
      base_currency: 'BTC',
      market_policy: 'CONTINUOUS_24_7',
      exchange: 'CRYPTO',
      portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
    },
    {
      id: 'asset_eth',
      symbol: 'ETH',
      name: 'Ethereum',
      asset_type: 'crypto',
      quote_currency: 'USD',
      base_currency: 'ETH',
      market_policy: 'CONTINUOUS_24_7',
      exchange: 'CRYPTO',
      portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
    }
  ];

  const fpt = canonicalAssets[0];
  const e1vfvn30 = canonicalAssets[1];
  const xauUsd = canonicalAssets[2];
  const usdVnd = canonicalAssets[3];
  const btc = canonicalAssets[4];
  const eth = canonicalAssets[5];

  describe('1. Normalization & Safety', () => {
    it('handles null, undefined, or malformed asset objects safely', () => {
      assert.equal(normalizeAsset(null), null);
      assert.equal(normalizeAsset(undefined), null);
      assert.equal(normalizeAsset(''), null);
      assert.equal(normalizeAsset({}), null);
    });

    it('normalizes asset properties consistently', () => {
      const norm = normalizeAsset(fpt);
      assert.equal(norm.symbol, 'FPT');
      assert.equal(norm.assetType, 'stock');
      assert.equal(norm.quoteCurrency, 'VND');
    });
  });

  describe('2. Holdable VND Assets (Opening Position & Buy/Sell Transactions)', () => {
    it('allows VN Stock (FPT) and VN ETF (E1VFVN30)', () => {
      assert.equal(isHoldableVndAsset(fpt), true);
      assert.equal(isHoldableVndAsset(e1vfvn30), true);
    });

    it('strictly excludes FX pair (USD/VND) even though its quote_currency is VND', () => {
      assert.equal(isHoldableVndAsset(usdVnd), false);
    });

    it('strictly excludes Gold (XAU/USD) and Crypto (BTC, ETH) from VND trading/holdings', () => {
      assert.equal(isHoldableVndAsset(xauUsd), false);
      assert.equal(isHoldableVndAsset(btc), false);
      assert.equal(isHoldableVndAsset(eth), false);
    });

    it('filters representative assets down to only 2 holdable VND assets', () => {
      const holdable = filterAssetsForCapability(canonicalAssets, 'holdable_vnd');
      assert.deepEqual(
        holdable.map((a) => a.symbol),
        ['FPT', 'E1VFVN30']
      );
    });
  });

  describe('2b. Cross-Currency Portfolio Entry Capability (Opening Position & Transactions)', () => {
    it('supports VN Stocks (FPT), VN ETFs (E1VFVN30), Gold (XAU/USD), and Crypto (BTC, ETH)', () => {
      assert.equal(isPortfolioTradeableAsset(fpt), true);
      assert.equal(isPortfolioTradeableAsset(e1vfvn30), true);
      assert.equal(isPortfolioTradeableAsset(xauUsd), true);
      assert.equal(isPortfolioTradeableAsset(btc), true);
      assert.equal(isPortfolioTradeableAsset(eth), true);
      assert.equal(isOpeningPositionSupported(btc), true);
      assert.equal(isTransactionSupported(xauUsd), true);
    });

    it('strictly excludes pure reference FX (USD/VND) from portfolio trading and opening positions', () => {
      assert.equal(isPortfolioTradeableAsset(usdVnd), false);
      assert.equal(isOpeningPositionSupported(usdVnd), false);
      assert.equal(isTransactionSupported(usdVnd), false);
    });

    it('uses canonical eligibility instead of inferring investability from asset type or symbol', () => {
      assert.equal(isPortfolioTradeableAsset({
        ...fpt,
        portfolio_eligibility: 'REFERENCE_ONLY'
      }), false);
      assert.equal(isPortfolioTradeableAsset({
        ...usdVnd,
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
      }), true);
    });

    it('filters representative assets down to 5 tradeable / opening-position assets', () => {
      const openable = filterAssetsForCapability(canonicalAssets, 'opening_position');
      assert.deepEqual(
        openable.map((a) => a.symbol),
        ['FPT', 'E1VFVN30', 'XAU/USD', 'BTC', 'ETH']
      );

      const tradeable = filterAssetsForCapability(canonicalAssets, 'transactions');
      assert.deepEqual(
        tradeable.map((a) => a.symbol),
        ['FPT', 'E1VFVN30', 'XAU/USD', 'BTC', 'ETH']
      );
    });
  });

  describe('3. Historical Base-100 Comparison Capability', () => {
    it('supports VN Stocks (FPT), VN ETFs (E1VFVN30), Gold (XAU/USD), and Crypto (BTC, ETH)', () => {
      assert.equal(isHistoricalComparisonSupported(fpt), true);
      assert.equal(isHistoricalComparisonSupported(e1vfvn30), true);
      assert.equal(isHistoricalComparisonSupported(xauUsd), true);
      assert.equal(isHistoricalComparisonSupported(btc), true);
      assert.equal(isHistoricalComparisonSupported(eth), true);
    });

    it('strictly excludes Twelve Data FX (USD/VND) where history is unsupported', () => {
      assert.equal(isHistoricalComparisonSupported(usdVnd), false);
    });

    it('filters representative assets down to 5 comparison-supported assets', () => {
      const comparable = filterAssetsForCapability(canonicalAssets, 'comparison');
      assert.deepEqual(
        comparable.map((a) => a.symbol),
        ['FPT', 'E1VFVN30', 'XAU/USD', 'BTC', 'ETH']
      );
    });
  });

  describe('4. Analysis V2 Capability', () => {
    it('supports VN Stocks, VN ETFs, Gold, and Crypto', () => {
      assert.equal(isAnalysisSupported(fpt), true);
      assert.equal(isAnalysisSupported(e1vfvn30), true);
      assert.equal(isAnalysisSupported(xauUsd), true);
      assert.equal(isAnalysisSupported(btc), true);
      assert.equal(isAnalysisSupported(eth), true);
    });

    it('strictly marks Twelve Data FX (USD/VND) as unsupported for analysis', () => {
      assert.equal(isAnalysisSupported(usdVnd), false);
    });
  });

  describe('5. Market Snapshot, Watchlist & Price Alerts Capability', () => {
    it('supports all canonical universe assets including FX context', () => {
      assert.equal(isMarketSnapshotSupported(fpt), true);
      assert.equal(isMarketSnapshotSupported(e1vfvn30), true);
      assert.equal(isMarketSnapshotSupported(xauUsd), true);
      assert.equal(isMarketSnapshotSupported(usdVnd), true);
      assert.equal(isMarketSnapshotSupported(btc), true);
      assert.equal(isMarketSnapshotSupported(eth), true);
    });

    it('preserves full universe for discovery and live snapshots', () => {
      const snapshots = filterAssetsForCapability(canonicalAssets, 'all');
      assert.equal(snapshots.length, 6);
    });
  });
});
