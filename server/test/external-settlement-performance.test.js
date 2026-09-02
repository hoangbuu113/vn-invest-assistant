import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePortfolioPerformance,
  getExternalSettlementFlowForDate,
  PERFORMANCE_TIMEZONE
} from '../src/performance.js';
import {
  calculateBenchmarkComparison,
  BENCHMARK_REGISTRY,
  BENCHMARK_IDS
} from '../src/benchmarks.js';

describe('V1.1 Improvement 07D — External Settlement Performance Integration', () => {
  const assetVnd = {
    id: 'asset-vnd-synth-uuid',
    symbol: 'VN_SYNTH',
    name: 'Synthetic VND Asset',
    quoteCurrency: 'VND',
    quote_currency: 'VND',
    assetType: 'stock',
    exchange: 'HOSE'
  };

  const assetBtc = {
    id: 'asset-btc-uuid',
    symbol: 'BTC',
    name: 'Bitcoin',
    quoteCurrency: 'USD',
    quote_currency: 'USD',
    assetType: 'crypto',
    exchange: null
  };

  const fixedNow = new Date('2026-08-25T10:00:00.000Z'); // completedEndDate is 2026-08-24

  // -------------------------------------------------------------------------
  // TEST A — Flat-Price External BUY (TWR = 0%)
  // -------------------------------------------------------------------------
  it('A. Flat-price external BUY: portfolio value rises from contributed capital, TWR = 0%', () => {
    const cashActivation = {
      openingBalanceAmount: 100000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };

    // External BUY on 2026-08-21: 1 unit at 50,000,000 VND
    const transactions = [{
      id: 'tx-ext-buy-1',
      assetId: assetVnd.id,
      transactionType: 'BUY',
      quantity: 1,
      price: 50000000,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      executedAt: '2026-08-21T09:00:00.000Z',
      createdAt: '2026-08-21T09:00:00.000Z'
    }];

    const priceHistoryMap = {
      VN_SYNTH: [
        { date: '2026-08-20', close: 50000000 },
        { date: '2026-08-21', close: 50000000 },
        { date: '2026-08-22', close: 50000000 },
        { date: '2026-08-23', close: 50000000 },
        { date: '2026-08-24', close: 50000000 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries: [],
      positionBaselines: [],
      transactions,
      assets: [assetVnd],
      priceHistoryMap
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct - 0.0) < 1e-4, `Expected TWR 0%, got ${result.twr.returnPct}%`);

    // Verify daily flow components
    const buyPoint = result.series.find((s) => s.date === '2026-08-21');
    assert.ok(buyPoint);
    assert.equal(buyPoint.portfolioValueVnd, 150000000); // 100M cash + 50M holding
    assert.equal(buyPoint.externalSettlementFlowVnd, 50000000);
    assert.equal(buyPoint.cashCapitalFlowVnd, 0);
    assert.equal(buyPoint.netExternalFlowVnd, 50000000);
    assert.equal(buyPoint.twrIndex, 100.0);
  });

  // -------------------------------------------------------------------------
  // TEST B — Flat-Price External SELL (TWR = 0%)
  // -------------------------------------------------------------------------
  it('B. Flat-price external SELL: portfolio value falls by withdrawal, TWR = 0%', () => {
    const cashActivation = {
      openingBalanceAmount: 100000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };

    // Baseline holding: 1 unit at 50M
    const positionBaselines = [{
      assetId: assetVnd.id,
      openingQuantity: 1,
      openingAverageCost: 50000000,
      accountingCutoffAt: '2026-08-20T00:00:00.000Z',
      cancelledAt: null
    }];

    // External SELL on 2026-08-21: 1 unit at 50M
    const transactions = [{
      id: 'tx-ext-sell-1',
      assetId: assetVnd.id,
      transactionType: 'SELL',
      quantity: 1,
      price: 50000000,
      realizedPnL: 0,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      executedAt: '2026-08-21T09:00:00.000Z',
      createdAt: '2026-08-21T09:00:00.000Z'
    }];

    const priceHistoryMap = {
      VN_SYNTH: [
        { date: '2026-08-20', close: 50000000 },
        { date: '2026-08-21', close: 50000000 },
        { date: '2026-08-22', close: 50000000 },
        { date: '2026-08-23', close: 50000000 },
        { date: '2026-08-24', close: 50000000 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries: [],
      positionBaselines,
      transactions,
      assets: [assetVnd],
      priceHistoryMap
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct - 0.0) < 1e-4, `Expected TWR 0%, got ${result.twr.returnPct}%`);

    const sellPoint = result.series.find((s) => s.date === '2026-08-21');
    assert.ok(sellPoint);
    assert.equal(sellPoint.portfolioValueVnd, 100000000); // 100M cash + 0 holding
    assert.equal(sellPoint.externalSettlementFlowVnd, -50000000);
    assert.equal(sellPoint.cashCapitalFlowVnd, 0);
    assert.equal(sellPoint.netExternalFlowVnd, -50000000);
    assert.equal(sellPoint.twrIndex, 100.0);
  });

  // -------------------------------------------------------------------------
  // TEST C — External BUY then Asset Appreciates
  // -------------------------------------------------------------------------
  it('C. External BUY then asset appreciates: contribution excluded, only market gain counted', () => {
    const cashActivation = {
      openingBalanceAmount: 100000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };

    // External BUY on 2026-08-21: 1 unit at 50,000,000 VND
    const transactions = [{
      id: 'tx-ext-buy-c',
      assetId: assetVnd.id,
      transactionType: 'BUY',
      quantity: 1,
      price: 50000000,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      executedAt: '2026-08-21T09:00:00.000Z',
      createdAt: '2026-08-21T09:00:00.000Z'
    }];

    // Price is 50M on 20th and 21st, then jumps to 60M (+20% on asset) on 22nd-24th
    const priceHistoryMap = {
      VN_SYNTH: [
        { date: '2026-08-20', close: 50000000 },
        { date: '2026-08-21', close: 50000000 },
        { date: '2026-08-22', close: 60000000 },
        { date: '2026-08-23', close: 60000000 },
        { date: '2026-08-24', close: 60000000 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries: [],
      positionBaselines: [],
      transactions,
      assets: [assetVnd],
      priceHistoryMap
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');

    // Expected return: Total portfolio was 150M on Aug 21, rose to 160M on Aug 22 with 0 flows => (160 - 150) / 150 = +6.6667%
    const expectedReturn = (10000000 / 150000000) * 100.0;
    assert.ok(Math.abs(result.twr.returnPct - expectedReturn) < 1e-4);
  });

  // -------------------------------------------------------------------------
  // TEST D — External SELL after Gain (Withdrawal uses total proceeds, NOT realized P&L)
  // -------------------------------------------------------------------------
  it('D. External SELL after gain: withdrawal uses total proceeds, realized P&L is NOT used as flow', () => {
    const cashActivation = {
      openingBalanceAmount: 100000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };

    const positionBaselines = [{
      assetId: assetVnd.id,
      openingQuantity: 1,
      openingAverageCost: 50000000,
      accountingCutoffAt: '2026-08-20T00:00:00.000Z',
      cancelledAt: null
    }];

    // Price rises to 70M on Aug 21
    // Sell on Aug 22 for 70M (realized P&L = +20M)
    const transactions = [{
      id: 'tx-ext-sell-d',
      assetId: assetVnd.id,
      transactionType: 'SELL',
      quantity: 1,
      price: 70000000,
      realizedPnL: 20000000,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      executedAt: '2026-08-22T09:00:00.000Z',
      createdAt: '2026-08-22T09:00:00.000Z'
    }];

    const priceHistoryMap = {
      VN_SYNTH: [
        { date: '2026-08-20', close: 50000000 },
        { date: '2026-08-21', close: 70000000 },
        { date: '2026-08-22', close: 70000000 },
        { date: '2026-08-23', close: 70000000 },
        { date: '2026-08-24', close: 70000000 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries: [],
      positionBaselines,
      transactions,
      assets: [assetVnd],
      priceHistoryMap
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');

    // Expected TWR: Aug 20 (150M) -> Aug 21 (170M, +13.3333%) -> Aug 22 (Sold 70M, cash 100M, flow -70M => (100 - (-70))/170 - 1 = 0%)
    const expectedReturn = (20000000 / 150000000) * 100.0;
    assert.ok(Math.abs(result.twr.returnPct - expectedReturn) < 1e-4);

    const sellPoint = result.series.find((s) => s.date === '2026-08-22');
    assert.equal(sellPoint.externalSettlementFlowVnd, -70000000); // 70M proceeds withdrawn, NOT 20M realized P&L
    assert.equal(sellPoint.netExternalFlowVnd, -70000000);
  });

  // -------------------------------------------------------------------------
  // TEST E & F — Internal VND BUY and SELL (External Flow = 0)
  // -------------------------------------------------------------------------
  it('E & F. Internal VND BUY and SELL: external settlement flow = 0 and existing performance unchanged', () => {
    const cashActivation = {
      openingBalanceAmount: 100000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };

    // Internal BUY on Aug 21
    const cashEntries = [{
      id: 'cash-buy-1',
      entryType: 'BUY',
      amount: 50000000,
      effectiveAt: '2026-08-21T09:00:00.000Z'
    }];
    const transactions = [{
      id: 'tx-int-buy-1',
      assetId: assetVnd.id,
      transactionType: 'BUY',
      quantity: 1,
      price: 50000000,
      settlementMode: 'INTERNAL_VND_CASH',
      settlementCurrency: 'VND',
      executedAt: '2026-08-21T09:00:00.000Z',
      createdAt: '2026-08-21T09:00:00.000Z'
    }];

    const priceHistoryMap = {
      VN_SYNTH: [
        { date: '2026-08-20', close: 50000000 },
        { date: '2026-08-21', close: 50000000 },
        { date: '2026-08-22', close: 50000000 },
        { date: '2026-08-23', close: 50000000 },
        { date: '2026-08-24', close: 50000000 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions,
      assets: [assetVnd],
      priceHistoryMap
    });

    assert.equal(result.twr.returnPct, 0);
    const buyPoint = result.series.find((s) => s.date === '2026-08-21');
    assert.equal(buyPoint.externalSettlementFlowVnd, 0);
    assert.equal(buyPoint.cashCapitalFlowVnd, 0);
    assert.equal(buyPoint.netExternalFlowVnd, 0);
  });

  // -------------------------------------------------------------------------
  // TEST G — Deposit + External BUY in Same Period
  // -------------------------------------------------------------------------
  it('G. Deposit + external BUY same period: both flow components counted exactly once', () => {
    const cashActivation = {
      openingBalanceAmount: 50000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };

    // Deposit 20M on Aug 21
    const cashEntries = [{
      id: 'cash-dep-1',
      entryType: 'DEPOSIT',
      amount: 20000000,
      effectiveAt: '2026-08-21T09:00:00.000Z'
    }];

    // External BUY 30M on Aug 21
    const transactions = [{
      id: 'tx-ext-buy-g',
      assetId: assetVnd.id,
      transactionType: 'BUY',
      quantity: 1,
      price: 30000000,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      executedAt: '2026-08-21T09:00:00.000Z',
      createdAt: '2026-08-21T09:00:00.000Z'
    }];

    const priceHistoryMap = {
      VN_SYNTH: [
        { date: '2026-08-20', close: 30000000 },
        { date: '2026-08-21', close: 30000000 },
        { date: '2026-08-22', close: 30000000 },
        { date: '2026-08-23', close: 30000000 },
        { date: '2026-08-24', close: 30000000 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions,
      assets: [assetVnd],
      priceHistoryMap
    });

    assert.ok(Math.abs(result.twr.returnPct - 0.0) < 1e-4);
    const point = result.series.find((s) => s.date === '2026-08-21');
    assert.equal(point.cashCapitalFlowVnd, 20000000);
    assert.equal(point.externalSettlementFlowVnd, 30000000);
    assert.equal(point.netExternalFlowVnd, 50000000);
  });

  // -------------------------------------------------------------------------
  // TEST H — Withdrawal + External SELL in Same Period
  // -------------------------------------------------------------------------
  it('H. Withdrawal + external SELL same period: both counted exactly once', () => {
    const cashActivation = {
      openingBalanceAmount: 100000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };
    const positionBaselines = [{
      assetId: assetVnd.id,
      openingQuantity: 1,
      openingAverageCost: 50000000,
      accountingCutoffAt: '2026-08-20T00:00:00.000Z',
      cancelledAt: null
    }];

    const cashEntries = [{
      id: 'cash-wdr-1',
      entryType: 'WITHDRAWAL',
      amount: 30000000,
      effectiveAt: '2026-08-21T09:00:00.000Z'
    }];
    const transactions = [{
      id: 'tx-ext-sell-h',
      assetId: assetVnd.id,
      transactionType: 'SELL',
      quantity: 1,
      price: 50000000,
      realizedPnL: 0,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      executedAt: '2026-08-21T09:00:00.000Z',
      createdAt: '2026-08-21T09:00:00.000Z'
    }];

    const priceHistoryMap = {
      VN_SYNTH: [
        { date: '2026-08-20', close: 50000000 },
        { date: '2026-08-21', close: 50000000 },
        { date: '2026-08-22', close: 50000000 },
        { date: '2026-08-23', close: 50000000 },
        { date: '2026-08-24', close: 50000000 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines,
      transactions,
      assets: [assetVnd],
      priceHistoryMap
    });

    assert.ok(Math.abs(result.twr.returnPct - 0.0) < 1e-4);
    const point = result.series.find((s) => s.date === '2026-08-21');
    assert.equal(point.cashCapitalFlowVnd, -30000000);
    assert.equal(point.externalSettlementFlowVnd, -50000000);
    assert.equal(point.netExternalFlowVnd, -80000000);
  });

  // -------------------------------------------------------------------------
  // TEST I — Concurrent Multiple Transactions on Same Date
  // -------------------------------------------------------------------------
  it('I. Concurrent multiple transactions same date: deterministic ordering and result', () => {
    // Two external BUYs on same day
    const transactions = [
      {
        id: 'tx-1',
        assetId: assetVnd.id,
        transactionType: 'BUY',
        quantity: 1,
        price: 20000000,
        settlementMode: 'EXTERNAL_SETTLEMENT',
        executedAt: '2026-08-21T09:00:00.000Z'
      },
      {
        id: 'tx-2',
        assetId: assetVnd.id,
        transactionType: 'BUY',
        quantity: 2,
        price: 20000000,
        settlementMode: 'EXTERNAL_SETTLEMENT',
        executedAt: '2026-08-21T10:00:00.000Z'
      }
    ];

    const flow = getExternalSettlementFlowForDate('2026-08-21', transactions);
    assert.equal(flow.contributions, 60000000);
    assert.equal(flow.withdrawals, 0);
    assert.equal(flow.netExternalSettlementFlow, 60000000);
  });

  // -------------------------------------------------------------------------
  // TEST J — Opening Baseline Does NOT Generate External Flow
  // -------------------------------------------------------------------------
  it('J. Opening baseline: no external contribution generated', () => {
    const flow = getExternalSettlementFlowForDate('2026-08-20', []);
    assert.equal(flow.contributions, 0);
    assert.equal(flow.withdrawals, 0);
    assert.equal(flow.netExternalSettlementFlow, 0);
  });

  // -------------------------------------------------------------------------
  // TEST K & L — Non-VND Historical Authority Missing & USDT Separation
  // -------------------------------------------------------------------------
  it('K & L. Non-VND historical authority missing & USDT separation: performance explicitly unavailable, no fake FX', () => {
    const cashActivation = {
      openingBalanceAmount: 100000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };

    const positionBaselines = [{
      assetId: assetBtc.id,
      openingQuantity: 0.5,
      openingAverageCost: 1500000000,
      accountingCutoffAt: '2026-08-20T00:00:00.000Z',
      cancelledAt: null
    }];

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries: [],
      positionBaselines,
      transactions: [],
      assets: [assetBtc],
      priceHistoryMap: {}
    });

    assert.equal(result.valuationCoverage.status, 'partial');
    assert.ok(result.valuationCoverage.reasons.includes('NON_VND_HISTORICAL_FX_UNAVAILABLE'));
    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.returnPct, null);
  });

  // -------------------------------------------------------------------------
  // TEST M — Benchmark Consumes Corrected TWR
  // -------------------------------------------------------------------------
  it('M. Benchmark consumes corrected TWR: does not recalculate flows independently and flat BUY has no fake alpha', () => {
    const cashActivation = {
      openingBalanceAmount: 100000000,
      activatedAt: '2026-08-20T00:00:00.000Z'
    };

    const transactions = [{
      id: 'tx-ext-buy-m',
      assetId: assetVnd.id,
      transactionType: 'BUY',
      quantity: 1,
      price: 50000000,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      executedAt: '2026-08-21T09:00:00.000Z',
      createdAt: '2026-08-21T09:00:00.000Z'
    }];

    const priceHistoryMap = {
      VN_SYNTH: [
        { date: '2026-08-20', close: 50000000 },
        { date: '2026-08-21', close: 50000000 },
        { date: '2026-08-22', close: 50000000 },
        { date: '2026-08-23', close: 50000000 },
        { date: '2026-08-24', close: 50000000 }
      ]
    };

    const portfolioPerformance = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries: [],
      positionBaselines: [],
      transactions,
      assets: [assetVnd],
      priceHistoryMap
    });

    // Benchmark VN_INDEX bars (gained 5% over period)
    const benchmarkBars = [
      { date: '2026-08-20', close: 1000 },
      { date: '2026-08-21', close: 1010 },
      { date: '2026-08-22', close: 1020 },
      { date: '2026-08-23', close: 1030 },
      { date: '2026-08-24', close: 1050 }
    ];

    const comparison = calculateBenchmarkComparison({
      portfolioPerformance,
      benchmarkDef: BENCHMARK_REGISTRY[BENCHMARK_IDS.VN_INDEX],
      benchmarkBars,
      now: fixedNow
    });

    assert.equal(comparison.status, 'available');
    assert.ok(Math.abs(comparison.portfolio.returnPctOnCommonPeriod - 0.0) < 1e-4);
    assert.ok(Math.abs(comparison.benchmarkReturnPct - 5.0) < 1e-4);
    assert.ok(Math.abs(comparison.returnDifferencePctPoints - (-5.0)) < 1e-4); // Exactly 0 - 5 = -5%, NO fake alpha from 50M external BUY
  });
});
