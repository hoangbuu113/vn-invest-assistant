import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePortfolioPerformance,
  calendarDaysDifference,
  determineAuthorityStart,
  getPerformanceCalendarWindow,
  getPerformanceRangeStart,
  reconstructCashBalance,
  reconstructHoldingsState,
  resolveCashEntryEconomicTimestamp,
  solveXirr,
  PERFORMANCE_TIMEZONE
} from '../src/performance.js';
import { createApp } from '../index.js';
import { ownerFetch, TEST_OWNER_ACCESS_TOKEN } from './helpers/owner-auth.js';

process.env.OWNER_ACCESS_TOKEN = TEST_OWNER_ACCESS_TOKEN;

describe('Feature 25B — VND Portfolio Performance Engine', () => {
  const assetFpt = {
    id: 'asset-fpt-uuid',
    symbol: 'FPT',
    name: 'FPT Corp',
    quoteCurrency: 'VND',
    quote_currency: 'VND',
    assetType: 'stock',
    exchange: 'HOSE'
  };

  const assetVcb = {
    id: 'asset-vcb-uuid',
    symbol: 'VCB',
    name: 'Vietcombank',
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

  const fixedNow = new Date('2026-08-29T10:00:00.000Z'); // Today is 2026-08-29 in Asia/Ho_Chi_Minh

  // --------------------------------------------------
  // ORACLE 1 — ONE YEAR NO FLOW
  // --------------------------------------------------
  it('ORACLE 1: One year no-flow portfolio (100 -> 110 over 365 days)', () => {
    // 365 days between 2025-08-28 and 2026-08-28
    const cashActivation = {
      openingBalanceAmount: 0,
      activatedAt: '2025-08-28T09:00:00.000Z'
    };

    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 1,
      openingAverageCost: 100,
      accountingCutoffAt: '2025-08-28T09:00:00.000Z',
      cancelledAt: null
    }];

    const priceHistoryMap = {
      FPT: [
        { date: '2025-08-28', close: 100 },
        { date: '2026-08-28', close: 110 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1Y',
      now: fixedNow,
      cashActivation,
      cashEntries: [],
      positionBaselines,
      transactions: [],
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct - 10.0) < 1e-4);
    assert.equal(result.mwr.status, 'available');
    assert.ok(Math.abs(result.mwr.annualizedReturnPct - 10.0) < 1e-4);
  });

  // --------------------------------------------------
  // ORACLE 2 — 30 DAY NO FLOW
  // --------------------------------------------------
  it('ORACLE 2: 30-day no-flow portfolio (100 -> 110 over 30 days)', () => {
    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 1,
      openingAverageCost: 100,
      accountingCutoffAt: '2026-07-29T09:00:00.000Z',
      cancelledAt: null
    }];

    const priceHistoryMap = {
      FPT: [
        { date: '2026-07-29', close: 100 },
        { date: '2026-08-28', close: 110 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1M',
      now: fixedNow,
      cashActivation: { openingBalanceAmount: 0, activatedAt: '2026-07-29T09:00:00.000Z' },
      cashEntries: [],
      positionBaselines,
      transactions: [],
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct - 10.0) < 1e-4);

    const expectedXirrAnnualized = (Math.pow(1.10, 365 / 30) - 1.0) * 100.0;
    assert.equal(result.mwr.status, 'available');
    assert.ok(Math.abs(result.mwr.annualizedReturnPct - expectedXirrAnnualized) < 1e-2);
  });

  // --------------------------------------------------
  // ORACLE 3 — FLAT + DEPOSIT
  // --------------------------------------------------
  it('ORACLE 3: Flat market + deposit yields 0% TWR', () => {
    const cashActivation = {
      openingBalanceAmount: 100,
      activatedAt: '2026-08-25T09:00:00.000Z'
    };

    const cashEntries = [
      {
        entryType: 'DEPOSIT',
        amount: 50,
        effectiveAt: '2026-08-27T10:00:00.000Z'
      }
    ];

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions: [],
      assets: [],
      priceHistoryMap: {}
    });

    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct) < 1e-6);
  });

  // --------------------------------------------------
  // ORACLE 4 — FLAT + WITHDRAWAL
  // --------------------------------------------------
  it('ORACLE 4: Flat market + withdrawal yields 0% TWR', () => {
    const cashActivation = {
      openingBalanceAmount: 100,
      activatedAt: '2026-08-25T09:00:00.000Z'
    };

    const cashEntries = [
      {
        entryType: 'WITHDRAWAL',
        amount: 30,
        effectiveAt: '2026-08-27T10:00:00.000Z'
      }
    ];

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions: [],
      assets: [],
      priceHistoryMap: {}
    });

    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct) < 1e-6);
  });

  // --------------------------------------------------
  // ORACLE 5 — BUY WITH EXISTING CASH
  // --------------------------------------------------
  it('ORACLE 5: BUY using existing cash causes 0% return distortion and 0 net external flow', () => {
    const cashActivation = {
      openingBalanceAmount: 100,
      activatedAt: '2026-08-25T09:00:00.000Z'
    };

    const cashEntries = [
      {
        entryType: 'BUY',
        amount: 40,
        effectiveAt: '2026-08-26T10:00:00.000Z'
      }
    ];

    const transactions = [
      {
        assetId: assetFpt.id,
        transactionType: 'BUY',
        quantity: 1,
        price: 40,
        realizedPnL: null,
        executedAt: '2026-08-26T10:00:00.000Z',
        createdAt: '2026-08-26T10:00:00.000Z'
      }
    ];

    const priceHistoryMap = {
      FPT: [
        { date: '2026-08-25', close: 40 },
        { date: '2026-08-26', close: 40 },
        { date: '2026-08-27', close: 40 },
        { date: '2026-08-28', close: 40 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions,
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct) < 1e-6);
    // Every day total portfolio value is 100
    for (const pt of result.series) {
      assert.equal(pt.portfolioValueVnd, 100);
      assert.equal(pt.netExternalFlowVnd, 0);
    }
  });

  // --------------------------------------------------
  // ORACLE 6 — SELL INTERNAL
  // --------------------------------------------------
  it('ORACLE 6: SELL to cash causes 0% trade effect return', () => {
    const cashActivation = {
      openingBalanceAmount: 60,
      activatedAt: '2026-08-25T09:00:00.000Z'
    };

    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 1,
      openingAverageCost: 40,
      accountingCutoffAt: '2026-08-25T09:00:00.000Z',
      cancelledAt: null
    }];

    const cashEntries = [
      {
        entryType: 'SELL',
        amount: 50,
        effectiveAt: '2026-08-26T10:00:00.000Z'
      }
    ];

    const transactions = [
      {
        assetId: assetFpt.id,
        transactionType: 'SELL',
        quantity: 1,
        price: 50,
        realizedPnL: 10,
        executedAt: '2026-08-26T10:00:00.000Z',
        createdAt: '2026-08-26T10:00:00.000Z'
      }
    ];

    const priceHistoryMap = {
      FPT: [
        { date: '2026-08-25', close: 50 },
        { date: '2026-08-26', close: 50 },
        { date: '2026-08-27', close: 50 },
        { date: '2026-08-28', close: 50 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines,
      transactions,
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct) < 1e-6);
    assert.equal(result.pnl.cumulativeRealizedPnlToEnd, 10);
  });

  it('P0.1: back-entered linked BUY uses executedAt for both cash and position economics', () => {
    const transaction = {
      id: 'tx-backdated-buy',
      profileId: 'profile-1',
      assetId: assetFpt.id,
      transactionType: 'BUY',
      quantity: 1,
      price: 40,
      executedAt: '2026-08-26T10:00:00.000Z',
      createdAt: '2026-08-28T10:00:00.000Z'
    };
    const cashEntry = {
      profileId: 'profile-1',
      entryType: 'BUY',
      amount: 40,
      portfolioTransactionId: transaction.id,
      effectiveAt: '2026-08-28T10:00:00.000Z',
      createdAt: '2026-08-28T10:00:00.000Z'
    };

    assert.equal(
      resolveCashEntryEconomicTimestamp(cashEntry, [transaction]),
      transaction.executedAt
    );
    assert.equal(
      reconstructCashBalance('2026-08-26', { openingBalanceAmount: 100 }, [cashEntry], [transaction]),
      60
    );

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation: { openingBalanceAmount: 100, activatedAt: '2026-08-25T09:00:00.000Z' },
      cashEntries: [cashEntry],
      positionBaselines: [],
      transactions: [transaction],
      assets: [assetFpt],
      priceHistoryMap: { FPT: [{ date: '2026-08-25', close: 40 }] }
    });

    assert.deepEqual(result.series.map((point) => point.portfolioValueVnd), [100, 100, 100, 100]);
    assert.equal(result.twr.returnPct, 0);
    assert.equal(result.drawdown.maxDrawdownPct, 0);
  });

  it('P0.1: back-entered linked SELL uses executedAt and remains an internal TWR flow', () => {
    const transaction = {
      id: 'tx-backdated-sell',
      profileId: 'profile-1',
      assetId: assetFpt.id,
      transactionType: 'SELL',
      quantity: 1,
      price: 40,
      realizedPnL: 0,
      executedAt: '2026-08-26T10:00:00.000Z',
      createdAt: '2026-08-28T10:00:00.000Z'
    };
    const cashEntry = {
      profileId: 'profile-1',
      entryType: 'SELL',
      amount: 40,
      portfolioTransactionId: transaction.id,
      effectiveAt: '2026-08-28T10:00:00.000Z',
      createdAt: '2026-08-28T10:00:00.000Z'
    };
    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation: { openingBalanceAmount: 60, activatedAt: '2026-08-25T09:00:00.000Z' },
      cashEntries: [cashEntry],
      positionBaselines: [{
        assetId: assetFpt.id,
        openingQuantity: 1,
        openingAverageCost: 40,
        accountingCutoffAt: '2026-08-25T09:00:00.000Z',
        cancelledAt: null
      }],
      transactions: [transaction],
      assets: [assetFpt],
      priceHistoryMap: { FPT: [{ date: '2026-08-25', close: 40 }] }
    });

    assert.deepEqual(result.series.map((point) => point.portfolioValueVnd), [100, 100, 100, 100]);
    assert.ok(result.series.every((point) => point.netExternalFlowVnd === 0));
    assert.equal(result.twr.returnPct, 0);
    assert.equal(result.drawdown.maxDrawdownPct, 0);
  });

  it('P0.1: ambiguous linked cash history fails closed instead of guessing economic time', () => {
    assert.throws(
      () => reconstructCashBalance('2026-08-28', { openingBalanceAmount: 100 }, [{
        entryType: 'BUY',
        amount: 40,
        portfolioTransactionId: 'missing-transaction',
        effectiveAt: '2026-08-28T10:00:00.000Z'
      }], []),
      (error) => error.code === 'AMBIGUOUS_LINKED_CASH_EVENT' && error.status === 503
    );

    assert.throws(
      () => resolveCashEntryEconomicTimestamp({
        profileId: 'profile-1',
        entryType: 'BUY',
        portfolioTransactionId: 'duplicated-transaction'
      }, [{
        id: 'duplicated-transaction',
        profileId: 'profile-1',
        transactionType: 'BUY',
        executedAt: '2026-08-26T10:00:00.000Z'
      }, {
        id: 'duplicated-transaction',
        profileId: 'profile-1',
        transactionType: 'BUY',
        executedAt: '2026-08-26T10:00:00.000Z'
      }]),
      (error) => error.code === 'AMBIGUOUS_LINKED_CASH_EVENT'
    );
  });

  // --------------------------------------------------
  // ORACLE 7 — OPENING BASELINE
  // --------------------------------------------------
  it('ORACLE 7: Opening baseline inception uses completed market price, not acquisition cost', () => {
    const cashActivation = {
      openingBalanceAmount: 30000000,
      activatedAt: '2026-08-20T09:00:00.000Z'
    };

    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 100,
      openingAverageCost: 50000, // acquisition cost differs from market price
      accountingCutoffAt: '2026-08-20T09:00:00.000Z',
      cancelledAt: null
    }];

    const priceHistoryMap = {
      FPT: [
        { date: '2026-08-20', close: 70000 },
        { date: '2026-08-21', close: 70000 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: new Date('2026-08-22T10:00:00.000Z'),
      cashActivation,
      cashEntries: [],
      positionBaselines,
      transactions: [],
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.period.inceptionDate, '2026-08-20');
    // Starting value on 2026-08-20 = 30,000,000 + 100 * 70,000 = 37,000,000
    assert.equal(result.series[0].portfolioValueVnd, 37000000);
  });

  // --------------------------------------------------
  // ORACLE 8 — WEEKEND DEPOSIT
  // --------------------------------------------------
  it('ORACLE 8: Weekend deposit uses carried-forward mark and yields 0% weekend TWR', () => {
    // 2026-08-21 is Friday, 2026-08-22 is Saturday, 2026-08-23 is Sunday, 2026-08-24 is Monday
    const cashActivation = {
      openingBalanceAmount: 20,
      activatedAt: '2026-08-21T09:00:00.000Z'
    };

    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 1,
      openingAverageCost: 80,
      accountingCutoffAt: '2026-08-21T09:00:00.000Z',
      cancelledAt: null
    }];

    const cashEntries = [
      {
        entryType: 'DEPOSIT',
        amount: 20,
        effectiveAt: '2026-08-22T10:00:00.000Z' // Saturday deposit
      }
    ];

    const priceHistoryMap = {
      FPT: [
        { date: '2026-08-21', close: 80 }, // Friday close
        { date: '2026-08-24', close: 84 }  // Monday close (+5% stock rise)
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: new Date('2026-08-25T10:00:00.000Z'),
      cashActivation,
      cashEntries,
      positionBaselines,
      transactions: [],
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.valuationCoverage.carriedForwardMarks >= 2, true); // Saturday and Sunday carried forward
    assert.equal(result.twr.status, 'available');

    // Find Saturday point
    const satPoint = result.series.find((p) => p.date === '2026-08-22');
    assert.equal(satPoint.portfolioValueVnd, 120); // 80 holding + 40 cash
    assert.equal(satPoint.netExternalFlowVnd, 20);
    assert.equal(satPoint.twrIndex, 100); // 0% return on Saturday

    // Find Monday point
    const monPoint = result.series.find((p) => p.date === '2026-08-24');
    assert.equal(monPoint.portfolioValueVnd, 124); // 84 holding + 40 cash
    assert.ok(Math.abs(monPoint.twrIndex - 103.3333) < 0.01);
  });

  // --------------------------------------------------
  // ORACLE 9 — MISSING PRICE
  // --------------------------------------------------
  it('ORACLE 9: Missing price yields partial coverage and null numeric TWR', () => {
    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 1,
      openingAverageCost: 100,
      accountingCutoffAt: '2026-08-20T09:00:00.000Z',
      cancelledAt: null
    }];

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation: { openingBalanceAmount: 0, activatedAt: '2026-08-20T09:00:00.000Z' },
      cashEntries: [],
      positionBaselines,
      transactions: [],
      assets: [assetFpt],
      priceHistoryMap: { FPT: [] } // Empty history
    });

    assert.equal(result.valuationCoverage.status, 'partial');
    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.returnPct, null);
  });

  // --------------------------------------------------
  // ORACLE 10 — NON-VND HOLDING
  // --------------------------------------------------
  it('ORACLE 10: Non-VND asset without historical FX yields partial coverage and null TWR', () => {
    const positionBaselines = [{
      assetId: assetBtc.id,
      openingQuantity: 1,
      openingAverageCost: 60000,
      accountingCutoffAt: '2026-08-20T09:00:00.000Z',
      cancelledAt: null
    }];

    const priceHistoryMap = {
      BTC: [{ date: '2026-08-20', close: 60000 }, { date: '2026-08-28', close: 62000 }]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation: { openingBalanceAmount: 1000000, activatedAt: '2026-08-20T09:00:00.000Z' },
      cashEntries: [],
      positionBaselines,
      transactions: [],
      assets: [assetBtc],
      priceHistoryMap
    });

    assert.equal(result.valuationCoverage.status, 'partial');
    assert.ok(result.valuationCoverage.reasons.includes('NON_VND_HISTORICAL_FX_UNAVAILABLE'));
    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.returnPct, null);
  });

  // --------------------------------------------------
  // ORACLE 11 — ZERO CAPITAL BREAK
  // --------------------------------------------------
  it('ORACLE 11: Portfolio dropping to zero and restarting yields ZERO_CAPITAL_BREAK', () => {
    const cashActivation = {
      openingBalanceAmount: 100,
      activatedAt: '2026-08-20T09:00:00.000Z'
    };

    const cashEntries = [
      { entryType: 'WITHDRAWAL', amount: 100, effectiveAt: '2026-08-22T09:00:00.000Z' },
      { entryType: 'DEPOSIT', amount: 100, effectiveAt: '2026-08-25T09:00:00.000Z' }
    ];

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions: [],
      assets: [],
      priceHistoryMap: {}
    });

    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.reason, 'ZERO_CAPITAL_BREAK');
    assert.equal(result.twr.returnPct, null);
  });

  // --------------------------------------------------
  // ORACLE 12 — XIRR SAME-DAY FLOW
  // --------------------------------------------------
  it('ORACLE 12: Same-day deposit and withdrawal are aggregated before XIRR solving', () => {
    const flows = [
      { dateKey: '2026-01-01', amount: -100 },
      { dateKey: '2026-06-01', amount: -10 },
      { dateKey: '2026-06-01', amount: 4 }, // Net = -6
      { dateKey: '2026-12-31', amount: 120 }
    ];

    const result = solveXirr(flows);
    assert.equal(result.status, 'available');
    assert.ok(typeof result.annualizedReturnPct === 'number');
  });

  // --------------------------------------------------
  // ORACLE 13 — XIRR AMBIGUOUS SIGN PATTERN
  // --------------------------------------------------
  it('ORACLE 13: Multiple sign transitions yield AMBIGUOUS_XIRR_ROOT', () => {
    const ambiguousFlows = [
      { dateKey: '2026-01-01', amount: -100 },
      { dateKey: '2026-04-01', amount: 50 },
      { dateKey: '2026-08-01', amount: -60 },
      { dateKey: '2026-12-31', amount: 80 }
    ];

    const result = solveXirr(ambiguousFlows);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'AMBIGUOUS_XIRR_ROOT');
    assert.equal(result.annualizedReturnPct, null);
  });

  // --------------------------------------------------
  // ORACLE 14 — DRAWDOWN ON WEALTH INDEX
  // --------------------------------------------------
  it('ORACLE 14: Drawdown on wealth index (100 -> 80 -> 90 yields max -20% and current -10%)', () => {
    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 1,
      openingAverageCost: 100,
      accountingCutoffAt: '2026-08-25T09:00:00.000Z',
      cancelledAt: null
    }];

    const priceHistoryMap = {
      FPT: [
        { date: '2026-08-25', close: 100 },
        { date: '2026-08-26', close: 80 },
        { date: '2026-08-27', close: 90 },
        { date: '2026-08-28', close: 90 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation: { openingBalanceAmount: 0, activatedAt: '2026-08-25T09:00:00.000Z' },
      cashEntries: [],
      positionBaselines,
      transactions: [],
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.drawdown.status, 'available');
    assert.ok(Math.abs(result.drawdown.maxDrawdownPct - (-20.0)) < 1e-4);
    assert.ok(Math.abs(result.drawdown.currentDrawdownPct - (-10.0)) < 1e-4);
  });

  // --------------------------------------------------
  // ORACLE 15 — RANGE BEFORE INCEPTION
  // --------------------------------------------------
  it('ORACLE 15: Range start before inception clips actualStartDate to inception date', () => {
    const cashActivation = {
      openingBalanceAmount: 100,
      activatedAt: '2026-08-01T09:00:00.000Z'
    };

    const result = calculatePortfolioPerformance({
      range: '1Y',
      now: fixedNow,
      cashActivation,
      cashEntries: [],
      positionBaselines: [],
      transactions: [],
      assets: [],
      priceHistoryMap: {}
    });

    assert.equal(result.period.inceptionDate, '2026-08-01');
    assert.equal(result.period.actualStartDate, '2026-08-01');
    assert.equal(result.period.clippedToInception, true);
  });

  // --------------------------------------------------
  // ORACLE 16 — LEAP-YEAR 1Y
  // --------------------------------------------------
  it('ORACLE 16: 1Y lookback across a leap year correctly spans 366 calendar days', () => {
    const leapYearEndDate = '2024-12-31';
    const rangeStart = getPerformanceRangeStart(leapYearEndDate, '1Y');
    assert.equal(rangeStart, '2023-12-31');
    const diff = calendarDaysDifference(rangeStart, leapYearEndDate);
    assert.equal(diff, 366);
  });

  // --------------------------------------------------
  // ORACLE 17 — CURRENT DAY EXCLUSION
  // --------------------------------------------------
  it('ORACLE 17: Current calendar day is excluded from completed performance series', () => {
    const window = getPerformanceCalendarWindow('1M', fixedNow);
    assert.equal(window.todayKey, '2026-08-29');
    assert.equal(window.completedEndDate, '2026-08-28');
  });

  // --------------------------------------------------
  // ORACLE 18 — P/L AS-OF HISTORICAL END
  // --------------------------------------------------
  it('ORACLE 18: Unrealized and realized P/L are evaluated as of actualEndDate', () => {
    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 10,
      openingAverageCost: 50,
      accountingCutoffAt: '2026-08-01T09:00:00.000Z',
      cancelledAt: null
    }];

    const transactions = [
      {
        assetId: assetFpt.id,
        transactionType: 'SELL',
        quantity: 2,
        price: 70,
        realizedPnL: 40, // (70 - 50) * 2
        executedAt: '2026-08-15T10:00:00.000Z',
        createdAt: '2026-08-15T10:00:00.000Z'
      }
    ];

    const priceHistoryMap = {
      FPT: [
        { date: '2026-08-01', close: 50 },
        { date: '2026-08-15', close: 70 },
        { date: '2026-08-28', close: 80 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1M',
      now: fixedNow,
      cashActivation: { openingBalanceAmount: 0, activatedAt: '2026-08-01T09:00:00.000Z' },
      cashEntries: [{ entryType: 'SELL', amount: 140, effectiveAt: '2026-08-15T10:00:00.000Z' }],
      positionBaselines,
      transactions,
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.pnl.status, 'available');
    assert.equal(result.pnl.realizedPnlDuringPeriod, 40);
    assert.equal(result.pnl.cumulativeRealizedPnlToEnd, 40);
    // Remaining quantity at 2026-08-28 is 8 @ avg cost 50, market price 80 -> unrealized = 8 * (80 - 50) = 240
    assert.equal(result.pnl.unrealizedPnlAtEnd, 240);
    assert.equal(result.pnl.totalAccountingPnlAtEnd, 280);
  });

  // --------------------------------------------------
  // INTEGRATION TESTS FOR API ENDPOINT
  // --------------------------------------------------
  it('GET /api/portfolio/performance returns 200 with valid structure', async () => {
    const mockApp = createApp({
      getPortfolioPerformanceFn: async ({ range }) => ({
        status: 'available',
        reportingCurrency: 'VND',
        period: {
          range,
          requestedStartDate: '2026-07-28',
          actualStartDate: '2026-07-28',
          endDate: '2026-08-28',
          inceptionDate: '2026-01-01',
          clippedToInception: false,
          performanceTimezone: 'Asia/Ho_Chi_Minh'
        },
        valuationCoverage: {
          status: 'complete',
          valuationMarks: 32,
          carriedForwardMarks: 8,
          missingValuationMarks: 0,
          reasons: []
        },
        twr: {
          status: 'available',
          returnPct: 12.5,
          methodology: 'DAILY_CHAINED_EOD_EXTERNAL_FLOW',
          exact: false,
          reason: null
        },
        mwr: {
          status: 'available',
          annualizedReturnPct: 15.2,
          methodology: 'XIRR',
          dayCountConvention: 'ACT/365',
          reason: null
        },
        pnl: {
          status: 'available',
          currency: 'VND',
          asOfDate: '2026-08-28',
          realizedPnlDuringPeriod: 5000000,
          cumulativeRealizedPnlToEnd: 10000000,
          unrealizedPnlAtEnd: 8000000,
          totalAccountingPnlAtEnd: 18000000,
          reason: null
        },
        drawdown: {
          status: 'available',
          currentDrawdownPct: -1.2,
          maxDrawdownPct: -5.4,
          peakDate: '2026-08-15',
          troughDate: '2026-08-20',
          reason: null
        },
        methodology: {
          feesIncluded: false,
          taxesIncluded: false,
          dividendsIncluded: false,
          corporateActionsAdjusted: false
        },
        series: []
      })
    });

    const server = mockApp.listen(0);
    const port = server.address().port;

    try {
      const response = await ownerFetch(`http://127.0.0.1:${port}/api/portfolio/performance?range=1M`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(body.data.reportingCurrency, 'VND');
      assert.equal(body.data.twr.returnPct, 12.5);
      assert.equal(body.data.mwr.annualizedReturnPct, 15.2);
      assert.equal(body.data.benchmark, undefined); // Feature 25B must not have benchmark
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('GET /api/portfolio/performance returns 400 for invalid range', async () => {
    const mockApp = createApp({
      getPortfolioPerformanceFn: async ({ range }) => {
        getPerformanceRangeStart('2026-08-28', range);
      }
    });
    const server = mockApp.listen(0);
    const port = server.address().port;

    try {
      const response = await ownerFetch(`http://127.0.0.1:${port}/api/portfolio/performance?range=2M`);
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.status, 'error');
      assert.equal(body.code, 'INVALID_PERFORMANCE_RANGE');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // --------------------------------------------------
  // ADDITIONAL AUTHORITY & RECONSTRUCTION TESTS
  // --------------------------------------------------
  it('determineAuthorityStart calculates max cutoff among active baselines and cash activation', () => {
    // 1. Unactivated cash ledger
    assert.equal(determineAuthorityStart(null), null);

    // 2. Cash activation only
    const start1 = determineAuthorityStart({ activatedAt: '2026-05-01T09:00:00.000Z' }, []);
    assert.equal(start1.toISOString(), '2026-05-01T09:00:00.000Z');

    // 3. Baselines with later cutoff
    const start2 = determineAuthorityStart(
      { activatedAt: '2026-05-01T09:00:00.000Z' },
      [
        { accountingCutoffAt: '2026-04-01T09:00:00.000Z', cancelledAt: null },
        { accountingCutoffAt: '2026-06-15T09:00:00.000Z', cancelledAt: null },
        { accountingCutoffAt: '2026-07-01T09:00:00.000Z', cancelledAt: '2026-07-02T09:00:00.000Z' } // cancelled, ignored
      ]
    );
    assert.equal(start2.toISOString(), '2026-06-15T09:00:00.000Z');
  });

  it('reconstructCashBalance accurately accounts for all cash entry types', () => {
    const cashActivation = { openingBalanceAmount: 50000000 };
    const cashEntries = [
      { entryType: 'OPENING_BALANCE', amount: 50000000, effectiveAt: '2026-08-01T09:00:00.000Z' },
      { entryType: 'DEPOSIT', amount: 20000000, effectiveAt: '2026-08-05T09:00:00.000Z' },
      { entryType: 'BUY', amount: 30000000, effectiveAt: '2026-08-10T09:00:00.000Z' },
      { entryType: 'SELL', amount: 15000000, effectiveAt: '2026-08-15T09:00:00.000Z' },
      { entryType: 'WITHDRAWAL', amount: 10000000, effectiveAt: '2026-08-20T09:00:00.000Z' }
    ];

    // As of 2026-08-01: 50M
    assert.equal(reconstructCashBalance('2026-08-01', cashActivation, cashEntries), 50000000);
    // As of 2026-08-05: 50M + 20M = 70M
    assert.equal(reconstructCashBalance('2026-08-05', cashActivation, cashEntries), 70000000);
    // As of 2026-08-10: 70M - 30M = 40M
    assert.equal(reconstructCashBalance('2026-08-10', cashActivation, cashEntries), 40000000);
    // As of 2026-08-15: 40M + 15M = 55M
    assert.equal(reconstructCashBalance('2026-08-15', cashActivation, cashEntries), 55000000);
    // As of 2026-08-20: 55M - 10M = 45M
    assert.equal(reconstructCashBalance('2026-08-20', cashActivation, cashEntries), 45000000);
  });

  it('reconstructHoldingsState updates weighted-average cost correctly on sequential BUYs and SELLs', () => {
    const baselines = [
      {
        assetId: assetFpt.id,
        openingQuantity: 100,
        openingAverageCost: 50,
        accountingCutoffAt: '2026-08-01T09:00:00.000Z',
        cancelledAt: null
      }
    ];

    const transactions = [
      // BUY 100 @ 70 -> Qty = 200, AvgCost = (100*50 + 100*70)/200 = 60
      {
        assetId: assetFpt.id,
        transactionType: 'BUY',
        quantity: 100,
        price: 70,
        executedAt: '2026-08-05T09:00:00.000Z',
        createdAt: '2026-08-05T09:00:00.000Z'
      },
      // SELL 50 @ 80 -> Qty = 150, AvgCost = 60
      {
        assetId: assetFpt.id,
        transactionType: 'SELL',
        quantity: 50,
        price: 80,
        executedAt: '2026-08-10T09:00:00.000Z',
        createdAt: '2026-08-10T09:00:00.000Z'
      },
      // SELL 150 @ 90 -> Qty = 0, AvgCost = 0
      {
        assetId: assetFpt.id,
        transactionType: 'SELL',
        quantity: 150,
        price: 90,
        executedAt: '2026-08-15T09:00:00.000Z',
        createdAt: '2026-08-15T09:00:00.000Z'
      }
    ];

    const state1 = reconstructHoldingsState('2026-08-01', baselines, transactions).get(assetFpt.id);
    assert.equal(state1.quantity, 100);
    assert.equal(state1.averageCost, 50);

    const state2 = reconstructHoldingsState('2026-08-05', baselines, transactions).get(assetFpt.id);
    assert.equal(state2.quantity, 200);
    assert.equal(state2.averageCost, 60);

    const state3 = reconstructHoldingsState('2026-08-10', baselines, transactions).get(assetFpt.id);
    assert.equal(state3.quantity, 150);
    assert.equal(state3.averageCost, 60);

    const state4 = reconstructHoldingsState('2026-08-15', baselines, transactions).get(assetFpt.id);
    assert.equal(state4.quantity, 0);
    assert.equal(state4.averageCost, 0);
  });

  // --------------------------------------------------
  // REPAIR BOUNDARY TESTS
  // --------------------------------------------------
  it('REPAIR BOUNDARY: Terminal withdrawal on actualEndDate is correctly aggregated into terminal MWR cash flow', () => {
    // Start 2026-08-21 (Friday): Cash 100
    // Flat portfolio thereafter
    // 2026-08-28 (Friday, actualEndDate): WITHDRAWAL = 20 -> Ending cash = 80
    const cashActivation = {
      openingBalanceAmount: 100,
      activatedAt: '2026-08-21T09:00:00.000Z'
    };

    const cashEntries = [
      {
        entryType: 'WITHDRAWAL',
        amount: 20,
        effectiveAt: '2026-08-28T09:00:00.000Z' // on actualEndDate
      }
    ];

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow, // today is 2026-08-29, completedEndDate = 2026-08-28
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions: [],
      assets: [],
      priceHistoryMap: {}
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct) < 1e-6);

    assert.equal(result.mwr.status, 'available');
    // Terminal investor cash flow = 80 (ending portfolio) - (-20 NetExternalFlow) = 100
    // Start CF = -100, End CF = +100 -> MWR = 0%
    assert.ok(Math.abs(result.mwr.annualizedReturnPct) < 1e-6);
  });

  it('REPAIR BOUNDARY: Terminal deposit on actualEndDate is correctly aggregated into terminal MWR cash flow', () => {
    // Start 2026-08-21: Cash 100
    // 2026-08-28 (actualEndDate): DEPOSIT = 20 -> Ending cash = 120
    const cashActivation = {
      openingBalanceAmount: 100,
      activatedAt: '2026-08-21T09:00:00.000Z'
    };

    const cashEntries = [
      {
        entryType: 'DEPOSIT',
        amount: 20,
        effectiveAt: '2026-08-28T09:00:00.000Z'
      }
    ];

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions: [],
      assets: [],
      priceHistoryMap: {}
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct) < 1e-6);

    assert.equal(result.mwr.status, 'available');
    // Terminal investor cash flow = 120 (ending portfolio) - (+20 NetExternalFlow) = 100
    // Start CF = -100, End CF = +100 -> MWR = 0%
    assert.ok(Math.abs(result.mwr.annualizedReturnPct) < 1e-6);
  });

  it('REPAIR BOUNDARY: Start-date external flow is embedded in V_start and not double-counted', () => {
    // 2026-08-21: Inception with opening balance 50 + deposit 50 on same day = 100 V_start
    const cashActivation = {
      openingBalanceAmount: 50,
      activatedAt: '2026-08-21T09:00:00.000Z'
    };

    const cashEntries = [
      {
        entryType: 'DEPOSIT',
        amount: 50,
        effectiveAt: '2026-08-21T10:00:00.000Z'
      }
    ];

    const result = calculatePortfolioPerformance({
      range: '1W',
      now: fixedNow,
      cashActivation,
      cashEntries,
      positionBaselines: [],
      transactions: [],
      assets: [],
      priceHistoryMap: {}
    });

    assert.equal(result.status, 'available');
    assert.equal(result.series[0].portfolioValueVnd, 100);
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct) < 1e-6);
    assert.equal(result.mwr.status, 'available');
    assert.ok(Math.abs(result.mwr.annualizedReturnPct) < 1e-6);
  });

  it('REPAIR BOUNDARY: realizedPnlDuringPeriod strictly includes SELLs over (actualStartDate, actualEndDate]', () => {
    const positionBaselines = [{
      assetId: assetFpt.id,
      openingQuantity: 10,
      openingAverageCost: 50,
      accountingCutoffAt: '2026-08-01T09:00:00.000Z',
      cancelledAt: null
    }];

    const transactions = [
      // SELL A: executed on actualStartDate (2026-08-01) -> realizedPnL = 10
      {
        assetId: assetFpt.id,
        transactionType: 'SELL',
        quantity: 1,
        price: 60,
        realizedPnL: 10,
        executedAt: '2026-08-01T10:00:00.000Z',
        createdAt: '2026-08-01T10:00:00.000Z'
      },
      // SELL B: executed after actualStartDate (2026-08-15) -> realizedPnL = 20
      {
        assetId: assetFpt.id,
        transactionType: 'SELL',
        quantity: 1,
        price: 70,
        realizedPnL: 20,
        executedAt: '2026-08-15T10:00:00.000Z',
        createdAt: '2026-08-15T10:00:00.000Z'
      }
    ];

    const priceHistoryMap = {
      FPT: [
        { date: '2026-08-01', close: 60 },
        { date: '2026-08-15', close: 70 },
        { date: '2026-08-28', close: 70 }
      ]
    };

    const result = calculatePortfolioPerformance({
      range: '1M',
      now: fixedNow,
      cashActivation: { openingBalanceAmount: 0, activatedAt: '2026-08-01T09:00:00.000Z' },
      cashEntries: [
        { entryType: 'SELL', amount: 60, effectiveAt: '2026-08-01T10:00:00.000Z' },
        { entryType: 'SELL', amount: 70, effectiveAt: '2026-08-15T10:00:00.000Z' }
      ],
      positionBaselines,
      transactions,
      assets: [assetFpt],
      priceHistoryMap
    });

    assert.equal(result.pnl.status, 'available');
    // realizedPnlDuringPeriod must only include SELL B (20), NOT SELL A (10)
    assert.equal(result.pnl.realizedPnlDuringPeriod, 20);
    // cumulativeRealizedPnlToEnd includes both SELL A and SELL B (10 + 20 = 30)
    assert.equal(result.pnl.cumulativeRealizedPnlToEnd, 30);
  });
});
