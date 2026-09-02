import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  normalizeAsset,
  isPortfolioTradeableAsset,
  isOpeningPositionSupported,
  isTransactionSupported,
  isHoldableVndAsset,
  filterAssetsForCapability
} from '../../client/src/utils/assetCapabilities.js';
import { calculatePortfolioValuation } from '../src/portfolio.js';
import { createUnavailableFxRate } from '../src/fx.js';

describe('V1.1 Improvement 07E — Cross-Currency User-Facing Activation & Valuation Integrity', () => {
  const canonicalAssets = [
    {
      id: 'asset-fpt',
      symbol: 'FPT',
      name: 'CTCP FPT',
      asset_type: 'stock',
      quote_currency: 'VND',
      base_currency: 'VND',
      exchange: 'HOSE'
    },
    {
      id: 'asset-e1vfvn30',
      symbol: 'E1VFVN30',
      name: 'Quỹ ETF VFMVN30',
      asset_type: 'etf',
      quote_currency: 'VND',
      base_currency: 'VND',
      exchange: 'HOSE'
    },
    {
      id: 'asset-btc',
      symbol: 'BTC',
      name: 'Bitcoin',
      asset_type: 'crypto',
      quote_currency: 'USD',
      base_currency: 'BTC',
      exchange: 'CRYPTO'
    },
    {
      id: 'asset-eth',
      symbol: 'ETH',
      name: 'Ethereum',
      asset_type: 'crypto',
      quote_currency: 'USD',
      base_currency: 'ETH',
      exchange: 'CRYPTO'
    },
    {
      id: 'asset-xau-usd',
      symbol: 'XAU/USD',
      name: 'Vàng Giao Ngay (USD)',
      asset_type: 'gold',
      quote_currency: 'USD',
      base_currency: 'XAU',
      exchange: 'COMMODITY'
    },
    {
      id: 'asset-usd-vnd',
      symbol: 'USD/VND',
      name: 'Tỷ giá USD / VND',
      asset_type: 'fx',
      quote_currency: 'VND',
      base_currency: 'USD',
      exchange: 'FOREX'
    }
  ];

  const [fpt, e1vfvn30, btc, eth, xauUsd, usdVnd] = canonicalAssets;

  describe('1. Asset Selector Capability Activation', () => {
    it('Transaction selector exposes VN stocks, VN ETFs, Crypto, and Gold, but excludes USD/VND', () => {
      const tradeable = filterAssetsForCapability(canonicalAssets, 'transactions');
      const symbols = tradeable.map((a) => a.symbol);
      assert.deepEqual(symbols, ['FPT', 'E1VFVN30', 'BTC', 'ETH', 'XAU/USD']);
      assert.equal(symbols.includes('USD/VND'), false);
    });

    it('Opening Position selector exposes VN stocks, VN ETFs, Crypto, and Gold, but excludes USD/VND', () => {
      const openable = filterAssetsForCapability(canonicalAssets, 'opening_position');
      const symbols = openable.map((a) => a.symbol);
      assert.deepEqual(symbols, ['FPT', 'E1VFVN30', 'BTC', 'ETH', 'XAU/USD']);
      assert.equal(symbols.includes('USD/VND'), false);
    });

    it('Individual predicates agree on capability boundaries', () => {
      assert.equal(isTransactionSupported(fpt), true);
      assert.equal(isTransactionSupported(e1vfvn30), true);
      assert.equal(isTransactionSupported(btc), true);
      assert.equal(isTransactionSupported(eth), true);
      assert.equal(isTransactionSupported(xauUsd), true);
      assert.equal(isTransactionSupported(usdVnd), false);

      assert.equal(isOpeningPositionSupported(fpt), true);
      assert.equal(isOpeningPositionSupported(e1vfvn30), true);
      assert.equal(isOpeningPositionSupported(btc), true);
      assert.equal(isOpeningPositionSupported(eth), true);
      assert.equal(isOpeningPositionSupported(xauUsd), true);
      assert.equal(isOpeningPositionSupported(usdVnd), false);
    });
  });

  describe('2. Modal Component Source Integrity & Disclosures', () => {
    const txModalSrc = readFileSync(new URL('../../client/src/components/TransactionModal.jsx', import.meta.url), 'utf8');
    const openingModalSrc = readFileSync(new URL('../../client/src/components/OpeningPositionModal.jsx', import.meta.url), 'utf8');

    it('TransactionModal contains required XAU/USD gold Troy ounce disclosure', () => {
      assert.match(txModalSrc, /Vàng quốc tế XAU\/USD/);
      assert.match(txModalSrc, /ounce troy/);
      assert.match(txModalSrc, /không phải vàng SJC\/PNJ/);
    });

    it('OpeningPositionModal contains required XAU/USD gold Troy ounce disclosure', () => {
      assert.match(openingModalSrc, /Vàng quốc tế XAU\/USD/);
      assert.match(openingModalSrc, /ounce troy/);
      assert.match(openingModalSrc, /không phải vàng SJC\/PNJ/);
    });

    it('TransactionModal contains dual settlement modes and Vietnamese labels', () => {
      assert.match(txModalSrc, /Giao dịch qua ví \/ sàn \/ tài khoản bên ngoài/);
      assert.match(txModalSrc, /Thanh toán từ tiền mặt VND đang theo dõi/);
      assert.match(txModalSrc, /EXTERNAL_SETTLEMENT/);
      assert.match(txModalSrc, /INTERNAL_VND_CASH/);
    });

    it('TransactionModal contains USDT notice avoiding USD substitution', () => {
      assert.match(txModalSrc, /USDT/);
      assert.match(txModalSrc, /giá vốn\/giá trị quy đổi VND thực tế/);
      assert.match(txModalSrc, /không tự động quy đổi USDT=USD/);
    });

    it('OpeningPositionModal preserves cash neutrality notice for opening positions', () => {
      assert.match(openingModalSrc, /không làm thay đổi số dư tiền mặt/);
      assert.match(openingModalSrc, /USER_SUPPLIED_OPENING_VND_BASIS/);
    });

    it('Neither modal contains browser localStorage or raw credential leaks', () => {
      assert.doesNotMatch(txModalSrc, /localStorage/);
      assert.doesNotMatch(openingModalSrc, /localStorage/);
      assert.doesNotMatch(txModalSrc, /OWNER_ACCESS_TOKEN/);
      assert.doesNotMatch(openingModalSrc, /OWNER_ACCESS_TOKEN/);
    });
  });

  describe('3. Representative Multi-Asset Portfolio Valuation & P&L', () => {
    const mockFxRate = {
      baseCurrency: 'USD',
      quoteCurrency: 'VND',
      rate: 25400,
      provider: 'twelvedata',
      sourceTimestamp: '2026-09-02T10:00:00.000Z',
      availability: 'available',
      freshness: 'delayed',
      reason: null
    };

    it('VND asset (FPT): preserves unchanged VND market value and P&L math', () => {
      const holdings = [
        {
          id: 'holding-fpt',
          asset_id: 'asset-fpt',
          quantity: 1000,
          average_cost: 120000,
          asset: {
            symbol: 'FPT',
            name: 'CTCP FPT',
            asset_type: 'stock',
            quote_currency: 'VND'
          }
        }
      ];

      const snapshots = {
        FPT: { price: 135000, currency: 'VND', priceAsOf: '2026-09-02T10:00:00.000Z' }
      };

      const result = calculatePortfolioValuation({ cash_available: 50000000 }, holdings, snapshots, {});
      const fptVal = result.holdings[0];

      assert.equal(fptVal.costBasis, 120000000);
      assert.equal(fptVal.marketValue, 135000000);
      assert.equal(fptVal.reportingMarketValue, 135000000);
      assert.equal(fptVal.unrealizedPnL, 15000000);
      assert.equal(fptVal.unrealizedPnLPercent, 12.5);
      assert.equal(fptVal.valuationStatus, 'available');
      assert.equal(fptVal.pnlStatus, 'available');
      assert.equal(result.summary.totalPortfolioValue, 50000000 + 135000000);
      assert.equal(result.summary.totalUnrealizedPnL, 15000000);
    });

    it('Crypto holding (BTC): quantity 0.01, avg_cost 1.5B VND, price 90k USD, FX 25.4k VND/USD', () => {
      const holdings = [
        {
          id: 'holding-btc',
          asset_id: 'asset-btc',
          quantity: 0.01,
          average_cost: 1500000000,
          asset: {
            symbol: 'BTC',
            name: 'Bitcoin',
            asset_type: 'crypto',
            quote_currency: 'USD'
          }
        }
      ];

      const snapshots = {
        BTC: { price: 90000, currency: 'USD', priceAsOf: '2026-09-02T10:00:00.000Z' }
      };

      const result = calculatePortfolioValuation(
        { cash_available: 0 },
        holdings,
        snapshots,
        { USD: mockFxRate }
      );

      const btcVal = result.holdings[0];
      // Expected:
      // nativeMarketValue = 0.01 * 90000 = 900 USD
      // reportingMarketValue = 900 * 25400 = 22,860,000 VND
      // costBasis = 0.01 * 1,500,000,000 = 15,000,000 VND
      // unrealizedPnL = 22,860,000 - 15,000,000 = 7,860,000 VND
      // unrealizedPnLPercent = (7,860,000 / 15,000,000) * 100 = 52.4%
      assert.equal(btcVal.nativeMarketValue, 900);
      assert.equal(btcVal.reportingMarketValue, 22860000);
      assert.equal(btcVal.costBasis, 15000000);
      assert.equal(btcVal.unrealizedPnL, 7860000);
      assert.ok(Math.abs(btcVal.unrealizedPnLPercent - 52.4) < 1e-6);
      assert.equal(btcVal.valuationStatus, 'available');
      assert.equal(btcVal.pnlStatus, 'available');
      assert.equal(result.summary.totalCostBasis, 15000000);
      assert.equal(result.summary.totalMarketValue, 22860000);
      assert.equal(result.summary.totalUnrealizedPnL, 7860000);
    });

    it('Gold holding (XAU/USD): quantity 1 troy oz, avg_cost 65M VND, price 2700 USD, FX 25.4k VND/USD', () => {
      const holdings = [
        {
          id: 'holding-xau',
          asset_id: 'asset-xau-usd',
          quantity: 1,
          average_cost: 65000000,
          asset: {
            symbol: 'XAU/USD',
            name: 'Vàng Giao Ngay',
            asset_type: 'gold',
            quote_currency: 'USD'
          }
        }
      ];

      const snapshots = {
        'XAU/USD': { price: 2700, currency: 'USD', priceAsOf: '2026-09-02T10:00:00.000Z' }
      };

      const result = calculatePortfolioValuation(
        { cash_available: 0 },
        holdings,
        snapshots,
        { USD: mockFxRate }
      );

      const xauVal = result.holdings[0];
      // Expected:
      // nativeMarketValue = 1 * 2700 = 2700 USD
      // reportingMarketValue = 2700 * 25400 = 68,580,000 VND
      // costBasis = 1 * 65,000,000 = 65,000,000 VND
      // unrealizedPnL = 68,580,000 - 65,000,000 = 3,580,000 VND
      // unrealizedPnLPercent = (3,580,000 / 65,000,000) * 100 = 5.507692307692308%
      assert.equal(xauVal.nativeMarketValue, 2700);
      assert.equal(xauVal.reportingMarketValue, 68580000);
      assert.equal(xauVal.costBasis, 65000000);
      assert.equal(xauVal.unrealizedPnL, 3580000);
      assert.equal(xauVal.unrealizedPnLPercent, (3580000 / 65000000) * 100);
      assert.equal(xauVal.valuationStatus, 'available');
      assert.equal(xauVal.pnlStatus, 'available');
    });

    it('Missing FX rate makes non-VND valuation & P&L unavailable without fabricating zero', () => {
      const holdings = [
        {
          id: 'holding-fpt',
          asset_id: 'asset-fpt',
          quantity: 100,
          average_cost: 100000,
          asset: { symbol: 'FPT', quote_currency: 'VND' }
        },
        {
          id: 'holding-btc',
          asset_id: 'asset-btc',
          quantity: 0.01,
          average_cost: 1500000000,
          asset: { symbol: 'BTC', quote_currency: 'USD' }
        }
      ];

      const snapshots = {
        FPT: { price: 110000, currency: 'VND' },
        BTC: { price: 90000, currency: 'USD' }
      };

      const unavailableFx = {
        USD: createUnavailableFxRate('USD', 'VND', 'FX_PROVIDER_UNCONFIGURED')
      };

      const result = calculatePortfolioValuation({ cash_available: 1000000 }, holdings, snapshots, unavailableFx);

      const fptVal = result.holdings[0];
      const btcVal = result.holdings[1];

      assert.equal(fptVal.valuationStatus, 'available');
      assert.equal(fptVal.pnlStatus, 'available');
      assert.equal(fptVal.reportingMarketValue, 11000000);

      assert.equal(btcVal.valuationStatus, 'unavailable');
      assert.equal(btcVal.pnlStatus, 'unavailable');
      assert.equal(btcVal.reportingMarketValue, null);
      assert.equal(btcVal.unrealizedPnL, null);
      assert.equal(btcVal.valuationReason, 'FX_PROVIDER_UNCONFIGURED');
      assert.equal(btcVal.costBasis, 15000000); // VND cost basis is preserved, never rewritten

      assert.equal(result.summary.valuationStatus, 'partial');
      assert.equal(result.summary.pnlCoverageStatus, 'partial');
      assert.equal(result.summary.totalMarketValue, 11000000); // only priced holding included
      assert.equal(result.summary.totalUnrealizedPnL, 1000000);
    });

    it('Malformed holding quantity or averageCost degrades safely to unavailable', () => {
      const holdings = [
        {
          id: 'holding-bad-qty',
          asset_id: 'asset-btc',
          quantity: null,
          average_cost: 1500000000,
          asset: { symbol: 'BTC', quote_currency: 'USD' }
        },
        {
          id: 'holding-bad-cost',
          asset_id: 'asset-xau',
          quantity: 1,
          average_cost: null,
          asset: { symbol: 'XAU/USD', quote_currency: 'USD' }
        }
      ];

      const snapshots = {
        BTC: { price: 90000, currency: 'USD' },
        'XAU/USD': { price: 2700, currency: 'USD' }
      };

      const result = calculatePortfolioValuation({ cash_available: 0 }, holdings, snapshots, { USD: mockFxRate });

      assert.equal(result.holdings[0].valuationStatus, 'unavailable');
      assert.equal(result.holdings[0].valuationReason, 'MALFORMED_HOLDING_QUANTITY');
      assert.equal(result.holdings[0].pnlStatus, 'unavailable');

      assert.equal(result.holdings[1].valuationStatus, 'available');
      assert.equal(result.holdings[1].pnlStatus, 'unavailable');
      assert.equal(result.holdings[1].pnlReason, 'MALFORMED_HOLDING_COST');
    });
  });
});
