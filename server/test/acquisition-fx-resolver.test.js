import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS,
  USDT_VND_ACCOUNTING_PROVENANCE,
  resolveAcquisitionFx
} from '../src/accountingRate.js';

const NOW = new Date('2026-09-21T12:00:00.000Z');

describe('Acquisition FX Resolver Contract', () => {
  test('A. current USDT/VND available => acquisition FX AVAILABLE', async () => {
    const mockObservedAt = '2026-09-21T11:58:00.000Z';
    const mockRate = 26050;

    const result = await resolveAcquisitionFx({
      baseCurrency: 'USDT',
      reportingCurrency: 'VND'
      // executedAt is undefined -> mode: CURRENT
    }, {
      now: NOW,
      enabled: true,
      getCurrentObservationFn: async () => ({
        rate: mockRate,
        observedAt: mockObservedAt
      })
    });

    assert.equal(result.availability, 'available');
    assert.equal(result.mode, 'CURRENT');
    assert.equal(result.rate, mockRate);
    assert.equal(result.baseCurrency, 'USDT');
    assert.equal(result.quoteCurrency, 'VND');
    assert.equal(result.source, 'CoinGecko');
    assert.equal(result.sourceObservedAt, mockObservedAt);
    assert.equal(result.provenance, USDT_VND_ACCOUNTING_PROVENANCE);
    assert.equal(result.reason, null);
    assert.ok(typeof result.observationDeltaMs === 'number');
  });

  test('B. historical exact observation => selected correctly', async () => {
    const executedAt = '2026-09-19T14:00:00.000Z';
    const mockRate = 26015.5;

    const result = await resolveAcquisitionFx({
      baseCurrency: 'USDT',
      reportingCurrency: 'VND',
      executedAt
    }, {
      now: NOW,
      enabled: true,
      getHistoricalObservationsFn: async () => [
        { rate: 25990, observedAt: '2026-09-19T13:00:00.000Z' },
        { rate: mockRate, observedAt: executedAt },
        { rate: 26030, observedAt: '2026-09-19T15:00:00.000Z' }
      ]
    });

    assert.equal(result.availability, 'available');
    assert.equal(result.mode, 'HISTORICAL');
    assert.equal(result.rate, mockRate);
    assert.equal(result.sourceObservedAt, executedAt);
    assert.equal(result.distanceFromExecution, 0);
    assert.equal(result.observationDeltaMs, 0);
    assert.equal(result.provenance, USDT_VND_ACCOUNTING_PROVENANCE);
  });

  test('C. historical nearest observation inside approved tolerance => selected with truthful timestamp/distance', async () => {
    const executedAt = '2026-09-19T14:24:12.000Z';
    const nearestObservedAt = '2026-09-19T14:00:00.000Z';
    const mockRate = 26015.76;
    const expectedDeltaMs = Math.abs(Date.parse(nearestObservedAt) - Date.parse(executedAt));

    const result = await resolveAcquisitionFx({
      baseCurrency: 'USDT',
      reportingCurrency: 'VND',
      executedAt
    }, {
      now: NOW,
      enabled: true,
      getHistoricalObservationsFn: async () => [
        { rate: 25950, observedAt: '2026-09-19T12:00:00.000Z' },
        { rate: mockRate, observedAt: nearestObservedAt },
        { rate: 26050, observedAt: '2026-09-19T15:30:00.000Z' }
      ]
    });

    assert.equal(result.availability, 'available');
    assert.equal(result.mode, 'HISTORICAL');
    assert.equal(result.rate, mockRate);
    assert.equal(result.sourceObservedAt, nearestObservedAt);
    assert.equal(result.distanceFromExecution, expectedDeltaMs);
    assert.equal(result.observationDeltaMs, expectedDeltaMs);
    assert.ok(expectedDeltaMs <= HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS);
  });

  test('D. nearest observation outside tolerance (> 60m) => UNAVAILABLE', async () => {
    const executedAt = '2026-09-19T14:00:00.000Z';
    // Nearest observation is 90 minutes away (> 60 min)
    const distantObservedAt = '2026-09-19T15:30:00.000Z';

    const result = await resolveAcquisitionFx({
      baseCurrency: 'USDT',
      reportingCurrency: 'VND',
      executedAt
    }, {
      now: NOW,
      enabled: true,
      getHistoricalObservationsFn: async () => [
        { rate: 26000, observedAt: distantObservedAt }
      ]
    });

    assert.equal(result.availability, 'unavailable');
    assert.equal(result.rate, null);
    assert.equal(result.provenance, null);
    assert.equal(result.reason, 'OBSERVATION_TOO_DISTANT');
  });

  test('E. USD quote exists but USDT missing => DO NOT substitute', async () => {
    const result = await resolveAcquisitionFx({
      baseCurrency: 'USD',
      reportingCurrency: 'VND',
      executedAt: '2026-09-19T14:00:00.000Z'
    }, {
      now: NOW,
      enabled: true
    });

    assert.equal(result.availability, 'unavailable');
    assert.equal(result.rate, null);
    assert.equal(result.reason, 'PAIR_UNSUPPORTED');
  });

  test('F. provider unavailable / 429 rate limit => UNAVAILABLE with reason', async () => {
    const rateLimitError = new Error('CoinGecko accounting rate rate limited');
    rateLimitError.code = 'PROVIDER_RATE_LIMITED';

    const result = await resolveAcquisitionFx({
      baseCurrency: 'USDT',
      reportingCurrency: 'VND',
      executedAt: '2026-09-19T14:00:00.000Z'
    }, {
      now: NOW,
      enabled: true,
      getHistoricalObservationsFn: async () => {
        throw rateLimitError;
      }
    });

    assert.equal(result.availability, 'unavailable');
    assert.equal(result.rate, null);
    assert.equal(result.reason, 'PROVIDER_RATE_LIMITED');
  });

  test('G. rate <= 0 / malformed => rejected as invalid evidence', async () => {
    // Non-positive rate
    const resultZero = await resolveAcquisitionFx({
      baseCurrency: 'USDT',
      reportingCurrency: 'VND'
    }, {
      now: NOW,
      enabled: true,
      getCurrentObservationFn: async () => ({
        rate: 0,
        observedAt: NOW.toISOString()
      })
    });
    assert.equal(resultZero.availability, 'unavailable');
    assert.equal(resultZero.rate, null);

    // Negative rate
    const resultNegative = await resolveAcquisitionFx({
      baseCurrency: 'USDT',
      reportingCurrency: 'VND'
    }, {
      now: NOW,
      enabled: true,
      getCurrentObservationFn: async () => ({
        rate: -26000,
        observedAt: NOW.toISOString()
      })
    });
    assert.equal(resultNegative.availability, 'unavailable');
    assert.equal(resultNegative.rate, null);

    // NaN / string rate
    const resultNaN = await resolveAcquisitionFx({
      baseCurrency: 'USDT',
      reportingCurrency: 'VND'
    }, {
      now: NOW,
      enabled: true,
      getCurrentObservationFn: async () => ({
        rate: 'invalid-rate',
        observedAt: NOW.toISOString()
      })
    });
    assert.equal(resultNaN.availability, 'unavailable');
    assert.equal(resultNaN.rate, null);
  });
});

