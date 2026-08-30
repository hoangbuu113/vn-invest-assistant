/**
 * Feature 26A — Binance Crypto Market Data Reliability V2 Tests
 *
 * Deterministic test suite covering all 23 specification requirements (A - W).
 * NO live network calls — all Binance requests and WebSockets are mocked.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  BINANCE_USDT_MAPPING,
  BINANCE_SYMBOL_TO_ASSET_ID,
  CANONICAL_SYMBOL_TO_ASSET_ID,
  isBinanceSupported,
  getBinanceMappingBySymbol,
  CircuitBreaker,
  BinanceHistoryCache,
  parseBinanceKline,
  normalizeHistoricalData,
  getHistory,
  getSnapshot,
  createBinanceService,
  _resetBinanceService,
  getBinanceHealth,
  binanceProvider
} from '../src/providers/binance.js';

import { getMarketSnapshot, getMarketHistory } from '../src/market.js';
import { getAssetAnalysis } from '../src/analysis.js';
import { getHistoryRangeStart } from '../src/history.js';
import { createApp } from '../index.js';

// ---------------------------------------------------------------------------
// Mock WebSocket Helper
// ---------------------------------------------------------------------------
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.closed = false;
  }
  send(data) {}
  close() {
    this.closed = true;
    if (typeof this.onclose === 'function') {
      this.onclose({ code: 1000, reason: 'Normal Closure' });
    }
  }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('Feature 26A — Binance Market Data Reliability Foundation', () => {

  afterEach(() => {
    _resetBinanceService();
  });

  // ---------------------------------------------------------------------------
  // A. Exactly 40 supported crypto mappings
  // ---------------------------------------------------------------------------
  it('A. BINANCE_USDT_MAPPING contains exactly 40 supported crypto mappings', () => {
    const keys = Object.keys(BINANCE_USDT_MAPPING);
    assert.equal(keys.length, 40, `Expected exactly 40 crypto mappings, got ${keys.length}`);
    for (const [id, def] of Object.entries(BINANCE_USDT_MAPPING)) {
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'Valid UUID format');
      assert.ok(def.binanceSymbol.endsWith('USDT'), 'Must be a USDT pair');
      assert.equal(def.quoteCurrency, 'USDT', 'Quote currency must be USDT');
    }
  });

  // ---------------------------------------------------------------------------
  // B. Every supported asset: Binance Spot, USDT, TRADING, unique mapping
  // ---------------------------------------------------------------------------
  it('B. all 40 assets have unique canonical symbols, unique Binance symbols, and valid baseAsset', () => {
    const canonicalSymbols = new Set();
    const binanceSymbols = new Set();

    for (const [id, def] of Object.entries(BINANCE_USDT_MAPPING)) {
      assert.ok(!canonicalSymbols.has(def.canonicalSymbol), `Duplicate canonical symbol: ${def.canonicalSymbol}`);
      assert.ok(!binanceSymbols.has(def.binanceSymbol), `Duplicate binance symbol: ${def.binanceSymbol}`);
      canonicalSymbols.add(def.canonicalSymbol);
      binanceSymbols.add(def.binanceSymbol);

      assert.equal(isBinanceSupported(id), true);
      assert.equal(BINANCE_SYMBOL_TO_ASSET_ID[def.binanceSymbol], id);
      assert.equal(CANONICAL_SYMBOL_TO_ASSET_ID[def.canonicalSymbol], id);
    }

    assert.equal(canonicalSymbols.size, 40);
    assert.equal(binanceSymbols.size, 40);
  });

  // ---------------------------------------------------------------------------
  // C. Current UTC day excluded from daily history
  // ---------------------------------------------------------------------------
  it('C. current UTC day is strictly excluded from completed daily history', () => {
    const fixedNow = new Date('2026-08-29T14:30:00.000Z');
    // Raw klines containing 2026-08-27, 2026-08-28, and 2026-08-29 (ongoing)
    const rawKlines = [
      [Date.parse('2026-08-27T00:00:00.000Z'), '60000', '61000', '59000', '60500', '1000', 0, 0, 0, 0, 0, '0'],
      [Date.parse('2026-08-28T00:00:00.000Z'), '60500', '62000', '60000', '61500', '1200', 0, 0, 0, 0, 0, '0'],
      [Date.parse('2026-08-29T00:00:00.000Z'), '61500', '63000', '61000', '62500', '800', 0, 0, 0, 0, 0, '0']
    ];

    const result = normalizeHistoricalData(rawKlines, 'BTC', '1W', { now: fixedNow, applyRangeFilter: false });
    assert.equal(result.bars.length, 2, 'Should only contain 2 completed bars');
    assert.equal(result.bars[0].date, '2026-08-27');
    assert.equal(result.bars[1].date, '2026-08-28');
    assert.ok(!result.bars.some(b => b.date === '2026-08-29'), 'Current day 2026-08-29 must be excluded');
  });

  // ---------------------------------------------------------------------------
  // D. Weekend crypto bars retained
  // ---------------------------------------------------------------------------
  it('D. weekend crypto bars are retained without synthetic gaps', () => {
    const fixedNow = new Date('2026-08-25T10:00:00.000Z'); // Tuesday
    // 2026-08-22 (Sat), 2026-08-23 (Sun), 2026-08-24 (Mon)
    const rawKlines = [
      [Date.parse('2026-08-22T00:00:00.000Z'), '60000', '61000', '59000', '60500', '1000', 0, 0, 0, 0, 0, '0'],
      [Date.parse('2026-08-23T00:00:00.000Z'), '60500', '62000', '60000', '61500', '1200', 0, 0, 0, 0, 0, '0'],
      [Date.parse('2026-08-24T00:00:00.000Z'), '61500', '63000', '61000', '62500', '1100', 0, 0, 0, 0, 0, '0']
    ];

    const result = normalizeHistoricalData(rawKlines, 'BTC', '1W', { now: fixedNow, applyRangeFilter: false });
    assert.equal(result.bars.length, 3);
    assert.equal(result.bars[0].date, '2026-08-22');
    assert.equal(result.bars[1].date, '2026-08-23');
    assert.equal(result.bars[2].date, '2026-08-24');
  });

  // ---------------------------------------------------------------------------
  // E. 1Y leap-year calendar semantics
  // ---------------------------------------------------------------------------
  it('E. getHistoryRangeStart calculates exact 1Y calendar year subtraction', () => {
    // 2026-08-28 - 1Y = 2025-08-28
    assert.equal(getHistoryRangeStart('2026-08-28', '1Y'), '2025-08-28');
    // Leap year boundary: 2024-02-29 - 1Y = 2023-02-28
    assert.equal(getHistoryRangeStart('2024-02-29', '1Y'), '2023-02-28');
  });

  // ---------------------------------------------------------------------------
  // F. Multi-chunk history merge / dedup / order
  // ---------------------------------------------------------------------------
  it('F. raw klines are deduplicated, ordered chronologically, and valid', () => {
    const fixedNow = new Date('2026-08-25T10:00:00.000Z');
    // Duplicate + out of order
    const rawKlines = [
      [Date.parse('2026-08-24T00:00:00.000Z'), '61500', '63000', '61000', '62500', '1100', 0, 0, 0, 0, 0, '0'],
      [Date.parse('2026-08-22T00:00:00.000Z'), '60000', '61000', '59000', '60500', '1000', 0, 0, 0, 0, 0, '0'],
      [Date.parse('2026-08-22T00:00:00.000Z'), '60000', '61000', '59000', '60500', '1000', 0, 0, 0, 0, 0, '0'],
      [Date.parse('2026-08-23T00:00:00.000Z'), '60500', '62000', '60000', '61500', '1200', 0, 0, 0, 0, 0, '0']
    ];

    const result = normalizeHistoricalData(rawKlines, 'BTC', '1W', { now: fixedNow, applyRangeFilter: false });
    assert.equal(result.bars.length, 3);
    assert.equal(result.bars[0].date, '2026-08-22');
    assert.equal(result.bars[1].date, '2026-08-23');
    assert.equal(result.bars[2].date, '2026-08-24');
  });

  // ---------------------------------------------------------------------------
  // G. Malformed Binance Kline rejected
  // ---------------------------------------------------------------------------
  it('G. malformed Binance Kline rows are safely rejected', () => {
    assert.equal(parseBinanceKline(null), null);
    assert.equal(parseBinanceKline([]), null);
    assert.equal(parseBinanceKline(['invalid_time', '10', '12', '9', '11', '100']), null);
    assert.equal(parseBinanceKline([1787616000000, null, '12', '9', '11', '100']), null);
    assert.equal(parseBinanceKline([1787616000000, '10', '12', '9', '-5', '100']), null);
  });

  // ---------------------------------------------------------------------------
  // H. Invalid OHLC rejected
  // ---------------------------------------------------------------------------
  it('H. contradictory OHLC (high < low, high < close) is rejected', () => {
    // High (8) < Low (9)
    assert.equal(parseBinanceKline([1787616000000, '10', '8', '9', '10', '100']), null);
    // High (10) < Close (11)
    assert.equal(parseBinanceKline([1787616000000, '10', '10', '9', '11', '100']), null);
    // Low (10) > Open (9)
    assert.equal(parseBinanceKline([1787616000000, '9', '12', '10', '11', '100']), null);
  });

  // ---------------------------------------------------------------------------
  // I. Request coalescing: 10 concurrent same-history requests -> 1 upstream call
  // ---------------------------------------------------------------------------
  it('I. request coalescing ensures concurrent same-history requests make exactly ONE upstream call', async () => {
    let upstreamCallCount = 0;
    const mockFetch = async () => {
      upstreamCallCount++;
      await new Promise(r => setTimeout(r, 15));
      return {
        ok: true,
        json: async () => [
          [Date.parse('2026-08-27T00:00:00.000Z'), '60000', '61000', '59000', '60500', '1000', 0, 0, 0, 0, 0, '0'],
          [Date.parse('2026-08-28T00:00:00.000Z'), '60500', '62000', '60000', '61500', '1200', 0, 0, 0, 0, 0, '0']
        ]
      };
    };

    const cache = new BinanceHistoryCache();
    const asset = { symbol: 'BTC', quoteCurrency: 'USDT', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC' };
    const mapping = { canonicalSymbol: 'BTC', binanceSymbol: 'BTCUSDT' };
    const now = new Date('2026-08-29T10:00:00.000Z');

    // Launch 10 simultaneous requests
    const promises = Array.from({ length: 10 }, () =>
      getHistory(asset, mapping, { range: '1W', now, cache, fetchFn: mockFetch })
    );

    const results = await Promise.all(promises);
    assert.equal(upstreamCallCount, 1, 'Exactly one upstream fetch should have executed');
    for (const res of results) {
      assert.equal(res.bars.length, 2);
      assert.equal(res.bars[1].close, 61500);
    }
  });

  // ---------------------------------------------------------------------------
  // J. Successful cache hit: no redundant upstream call
  // ---------------------------------------------------------------------------
  it('J. subsequent request for cached range makes zero upstream calls', async () => {
    let upstreamCallCount = 0;
    const mockFetch = async () => {
      upstreamCallCount++;
      return {
        ok: true,
        json: async () => [
          [Date.parse('2026-08-27T00:00:00.000Z'), '60000', '61000', '59000', '60500', '1000', 0, 0, 0, 0, 0, '0']
        ]
      };
    };

    const cache = new BinanceHistoryCache();
    const asset = { symbol: 'BTC', quoteCurrency: 'USDT', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC' };
    const mapping = { canonicalSymbol: 'BTC', binanceSymbol: 'BTCUSDT' };
    const now = new Date('2026-08-29T10:00:00.000Z');

    // First call populates cache
    await getHistory(asset, mapping, { range: '1W', now, cache, fetchFn: mockFetch });
    assert.equal(upstreamCallCount, 1);

    // Second call hits cache
    const secondResult = await getHistory(asset, mapping, { range: '1W', now, cache, fetchFn: mockFetch });
    assert.equal(upstreamCallCount, 1, 'No additional upstream call should be made');
    assert.equal(secondResult.bars.length, 1);
  });

  // ---------------------------------------------------------------------------
  // K. Stale fallback: provider fails + complete cached coverage exists -> stale usable result
  // ---------------------------------------------------------------------------
  it('K. stale fallback returns previously cached completed history when upstream fails', async () => {
    const cache = new BinanceHistoryCache();
    const asset = { symbol: 'BTC', quoteCurrency: 'USDT', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC' };
    const mapping = { canonicalSymbol: 'BTC', binanceSymbol: 'BTCUSDT' };
    const yesterday = new Date('2026-08-28T10:00:00.000Z');
    const today = new Date('2026-08-29T10:00:00.000Z');

    // 1. Successful fetch yesterday
    const goodFetch = async () => ({
      ok: true,
      json: async () => Array.from({ length: 8 }, (_, index) => {
        const timestamp = Date.parse(`2026-08-${String(20 + index).padStart(2, '0')}T00:00:00.000Z`);
        const open = 60000 + index * 100;
        return [timestamp, String(open), String(open + 200), String(open - 200), String(open + 100), '1000', 0, 0, 0, 0, 0, '0'];
      })
    });
    await getHistory(asset, mapping, { range: '1W', now: yesterday, cache, fetchFn: goodFetch });

    // 2. Upstream network failure today
    const badFetch = async () => { throw new Error('Upstream network failure'); };
    const fallbackResult = await getHistory(asset, mapping, { range: '1W', now: today, cache, fetchFn: badFetch });

    assert.ok(fallbackResult);
    assert.equal(fallbackResult.stale, true);
    assert.equal(fallbackResult.bars.length, 7);
  });

  // ---------------------------------------------------------------------------
  // L. Incomplete stale coverage must NOT masquerade as complete
  // ---------------------------------------------------------------------------
  it('L. incomplete stale cache (e.g. 1W cache for 1Y request) is rejected on upstream failure', async () => {
    const cache = new BinanceHistoryCache();
    const asset = { symbol: 'BTC', quoteCurrency: 'USDT', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC' };
    const mapping = { canonicalSymbol: 'BTC', binanceSymbol: 'BTCUSDT' };
    const now = new Date('2026-08-29T10:00:00.000Z');

    // Only 1W is cached
    const goodFetch = async () => ({
      ok: true,
      json: async () => [
        [Date.parse('2026-08-27T00:00:00.000Z'), '60000', '61000', '59000', '60500', '1000', 0, 0, 0, 0, 0, '0']
      ]
    });
    await getHistory(asset, mapping, { range: '1W', now, cache, fetchFn: goodFetch });

    // Requesting 1Y when upstream fails -> 1W cache does not satisfy 1Y
    const badFetch = async () => { throw new Error('Upstream 500 error'); };
    await assert.rejects(
      () => getHistory(asset, mapping, { range: '1Y', now, cache, fetchFn: badFetch }),
      /Upstream 500 error/
    );
  });

  // ---------------------------------------------------------------------------
  // M. Repeated failures open circuit
  // ---------------------------------------------------------------------------
  it('M. 3 consecutive failures transition circuit breaker from CLOSED to OPEN', () => {
    const circuit = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 5000 });
    assert.equal(circuit.getState(), 'CLOSED');

    circuit.recordFailure();
    assert.equal(circuit.getState(), 'CLOSED');
    circuit.recordFailure();
    assert.equal(circuit.getState(), 'CLOSED');
    circuit.recordFailure();
    assert.equal(circuit.getState(), 'OPEN');
    assert.equal(circuit.canAttempt(), false);
  });

  // ---------------------------------------------------------------------------
  // N. OPEN circuit avoids upstream request storm
  // ---------------------------------------------------------------------------
  it('N. OPEN circuit immediately fails fast or falls back to stale cache without calling fetch', async () => {
    let callCount = 0;
    const mockFetch = async () => { callCount++; return { ok: true, json: async () => [] }; };

    const circuit = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10000 });
    circuit.recordFailure(); // Open circuit
    assert.equal(circuit.getState(), 'OPEN');

    const cache = new BinanceHistoryCache();
    const asset = { symbol: 'BTC', quoteCurrency: 'USDT', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC' };
    const mapping = { canonicalSymbol: 'BTC', binanceSymbol: 'BTCUSDT' };

    await assert.rejects(
      () => getHistory(asset, mapping, { range: '1W', cache, circuitBreaker: circuit, fetchFn: mockFetch }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
        assert.equal(err.status, 503);
        return true;
      }
    );
    assert.equal(callCount, 0, 'No fetch should have been attempted while circuit is OPEN');
  });

  // ---------------------------------------------------------------------------
  // O. HALF_OPEN permits limited probe
  // ---------------------------------------------------------------------------
  it('O. after cooldown, circuit transitions to HALF_OPEN and permits one probe', async () => {
    const circuit = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 });
    circuit.recordFailure();
    assert.equal(circuit.state, 'OPEN');

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 15));
    assert.equal(circuit.getState(), 'HALF_OPEN');
    assert.equal(circuit.canAttempt(), true);
  });

  // ---------------------------------------------------------------------------
  // P. Successful half-open closes circuit
  // ---------------------------------------------------------------------------
  it('P. successful probe in HALF_OPEN transitions circuit back to CLOSED', async () => {
    const circuit = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 });
    circuit.recordFailure();
    await new Promise(r => setTimeout(r, 15));
    assert.equal(circuit.getState(), 'HALF_OPEN');

    circuit.recordSuccess();
    assert.equal(circuit.getState(), 'CLOSED');
    assert.equal(circuit.failureCount, 0);
  });

  // ---------------------------------------------------------------------------
  // Q. Realtime reconnect
  // ---------------------------------------------------------------------------
  it('Q. WebSocket service handles connection lifecycle and reconnect scheduling', () => {
    let wsInstance = null;
    const MockWS = function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    };

    const service = createBinanceService({ WebSocket: MockWS, silent: true });
    assert.equal(service.getConnectionState(), 'CONNECTING');

    // Trigger open
    wsInstance.onopen();
    assert.equal(service.getConnectionState(), 'CONNECTED');

    // Trigger close -> enters RECONNECTING
    wsInstance.onclose({ code: 1006 });
    assert.equal(service.getConnectionState(), 'RECONNECTING');

    service.destroy();
    assert.equal(service.getConnectionState(), 'DISCONNECTED');
  });

  // ---------------------------------------------------------------------------
  // R. Realtime observation handling
  // ---------------------------------------------------------------------------
  it('R. incoming miniTicker events update memory cache with USDT currency', () => {
    const service = createBinanceService({ disabled: true, silent: true });
    const btcAssetId = '1aca9503-acf1-4450-9b75-4f8935324398';

    service._handleMiniTickerArray([
      {
        e: '24hrMiniTicker',
        s: 'BTCUSDT',
        c: '67432.10',
        o: '65000.00',
        h: '68000.00',
        l: '64500.00',
        v: '15000.5',
        q: '1012345678.9',
        E: Date.now()
      }
    ]);

    const obs = service.getSnapshot(btcAssetId);
    assert.ok(obs);
    assert.equal(obs.price, 67432.10);
    assert.equal(obs.realtimeCurrency, 'USDT');
    assert.equal(obs.currency, 'USDT');
    assert.equal(obs.changeBasis, 'ROLLING_24H');
    assert.equal(obs.freshness, 'live');
    service.destroy();
  });

  // ---------------------------------------------------------------------------
  // S. Stale realtime mark
  // ---------------------------------------------------------------------------
  it('S. observation older than 30s is marked stale when connection is active', () => {
    let wsInstance = null;
    const MockWS = function(url) {
      wsInstance = new MockWebSocket(url);
      return wsInstance;
    };

    const service = createBinanceService({ WebSocket: MockWS, silent: true });
    wsInstance.onopen(); // Connection is CONNECTED
    assert.equal(service.getConnectionState(), 'CONNECTED');

    const btcAssetId = '1aca9503-acf1-4450-9b75-4f8935324398';
    const pastTime = Date.now() - 45_000; // 45 seconds ago

    service._handleMiniTickerArray([
      { e: '24hrMiniTicker', s: 'BTCUSDT', c: '67432.10', o: '65000', h: '68000', l: '64000', v: '100', q: '100', E: pastTime }
    ]);

    const obs = service.getSnapshot(btcAssetId, { nowMs: Date.now() });
    assert.ok(obs);
    assert.equal(obs.freshness, 'stale');
    service.destroy();
  });

  // ---------------------------------------------------------------------------
  // T. FX failure: USDT remains available, ≈VND unavailable only
  // ---------------------------------------------------------------------------
  it('T. snapshot returns valid USDT price when reference FX is unavailable (priceVnd = null)', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        lastPrice: '67432.10',
        openPrice: '65000.00',
        highPrice: '68000.00',
        lowPrice: '64000.00',
        volume: '15000.0',
        closeTime: Date.now()
      })
    });

    const failingFxFn = async () => ({ availability: 'unavailable', rate: null });

    const asset = { id: '1aca9503-acf1-4450-9b75-4f8935324398', symbol: 'BTC' };
    const mapping = { canonicalSymbol: 'BTC', binanceSymbol: 'BTCUSDT' };

    const snapshot = await getSnapshot(asset, mapping, { fetchFn: mockFetch, getFxRateFn: failingFxFn });
    assert.equal(snapshot.price, 67432.10);
    assert.equal(snapshot.currency, 'USDT');
    assert.equal(snapshot.priceVnd, null);
    assert.equal(snapshot.referenceFxRate, null);
  });

  it('T2. snapshot calculates priceVnd when reference FX is available', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        lastPrice: '2.00',
        openPrice: '1.90',
        highPrice: '2.10',
        lowPrice: '1.80',
        volume: '1000',
        closeTime: Date.now()
      })
    });

    const goodFxFn = async () => ({ availability: 'available', rate: 25400, provider: 'twelvedata' });

    const asset = { id: 'd3c678a1-5801-4475-8025-aa80e5572bb1', symbol: 'APT' };
    const mapping = { canonicalSymbol: 'APT', binanceSymbol: 'APTUSDT' };

    const snapshot = await getSnapshot(asset, mapping, { fetchFn: mockFetch, getFxRateFn: goodFxFn });
    assert.equal(snapshot.price, 2.00);
    assert.equal(snapshot.currency, 'USDT');
    assert.equal(snapshot.priceVnd, 50800); // 2.00 * 25400
    assert.equal(snapshot.referenceFxRate, 25400);
  });

  // ---------------------------------------------------------------------------
  // U. No historical use of current FX
  // ---------------------------------------------------------------------------
  it('U. historical daily bars remain quoted in native USDT with no current FX scaling', async () => {
    const fixedNow = new Date('2026-08-25T10:00:00.000Z');
    const rawKlines = [
      [Date.parse('2026-08-24T00:00:00.000Z'), '60000', '61000', '59000', '60500', '1000', 0, 0, 0, 0, 0, '0']
    ];

    const result = normalizeHistoricalData(rawKlines, 'BTC', '1W', { now: fixedNow, applyRangeFilter: false });
    assert.equal(result.bars[0].close, 60500, 'Historical close must be pure native quote, not scaled');
    assert.equal(result.bars[0].open, 60000);
    assert.equal(result.bars[0].high, 61000);
    assert.equal(result.bars[0].low, 59000);
  });

  // ---------------------------------------------------------------------------
  // V. Analysis reuses canonical Binance history
  // ---------------------------------------------------------------------------
  it('V. getAssetAnalysis successfully evaluates Binance crypto history with OHLC capabilities', async () => {
    const fixedNow = new Date('2026-08-25T10:00:00.000Z');
    // Generate 30 daily bars
    const bars = [];
    for (let i = 25; i >= 1; i--) {
      const d = new Date(Date.UTC(2026, 6, 25 + (25 - i))); // July/Aug dates
      const dateStr = d.toISOString().slice(0, 10);
      bars.push({
        date: dateStr,
        timestamp: d.toISOString(),
        open: 100 + i,
        high: 110 + i,
        low: 95 + i,
        close: 105 + i,
        volume: 5000 + i * 10,
        isComplete: true
      });
    }

    const mockHistoryFn = async () => ({
      symbol: 'BTC',
      assetType: 'crypto',
      quoteCurrency: 'USDT',
      currency: 'USDT',
      bars,
      historyCapabilities: { close: true, ohlc: true, volume: true },
      marketPolicy: 'CONTINUOUS_24_7',
      marketTimezone: 'UTC',
      dataCompleteness: 'complete'
    });

    const mockSnapshotFn = async () => ({
      symbol: 'BTC',
      currency: 'USDT',
      price: 130
    });

    const analysis = await getAssetAnalysis('BTC', {
      now: fixedNow,
      getMarketHistoryFn: mockHistoryFn,
      getMarketSnapshotFn: mockSnapshotFn
    });

    assert.equal(analysis.symbol, 'BTC');
    assert.equal(analysis.quoteCurrency, 'USDT');
    assert.ok(analysis.periods['1W']);
    assert.ok(analysis.periods['1M']);
    assert.equal(analysis.periods['1W'].status, 'available');
  });

  // ---------------------------------------------------------------------------
  // W. No raw provider error leakage
  // ---------------------------------------------------------------------------
  it('W. provider errors are mapped to clean typed codes without leaking URLs or raw bodies', async () => {
    const failingFetch = async () => ({
      ok: false,
      status: 500,
      headers: new Map(),
      text: async () => 'Internal Server Error http://api.binance.com/secret'
    });

    const asset = { symbol: 'BTC', quoteCurrency: 'USDT', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC' };
    const mapping = { canonicalSymbol: 'BTC', binanceSymbol: 'BTCUSDT' };

    await assert.rejects(
      () => getHistory(asset, mapping, { fetchFn: failingFetch, bypassCache: true, bypassCircuit: true }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.ok(!err.message.includes('http://'), 'Must not leak URLs');
        return true;
      }
    );
  });

  it('W2. one failed upstream request increments the circuit breaker exactly once', async () => {
    const circuit = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 5000 });
    const asset = { symbol: 'BTC', quoteCurrency: 'USDT', marketPolicy: 'CONTINUOUS_24_7', marketTimezone: 'UTC' };
    const mapping = { canonicalSymbol: 'BTC', binanceSymbol: 'BTCUSDT' };
    const failingFetch = async () => ({
      ok: false,
      status: 500,
      headers: new Map(),
      json: async () => ({})
    });

    await assert.rejects(() => getHistory(asset, mapping, {
      now: new Date('2026-08-29T10:00:00.000Z'),
      cache: new BinanceHistoryCache(),
      circuitBreaker: circuit,
      fetchFn: failingFetch
    }));
    assert.equal(circuit.failureCount, 1);
    assert.equal(circuit.getState(), 'CLOSED');
  });

  // ---------------------------------------------------------------------------
  // Health Signals Test
  // ---------------------------------------------------------------------------
  it('exposes public health status without live calls via getBinanceHealth', () => {
    const health = getBinanceHealth();
    assert.ok(health);
    assert.ok(['healthy', 'degraded', 'unavailable'].includes(health.binanceRealtime));
    assert.ok(['healthy', 'degraded', 'unavailable'].includes(health.binanceHistory));
    assert.ok(['CLOSED', 'OPEN', 'HALF_OPEN'].includes(health.circuitBreaker));
  });

  it('/api/health route returns provider health metadata', async () => {
    const app = createApp();
    const server = app.listen(0);
    const port = server.address().port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, 'ok');
      assert.ok(body.providers);
      assert.ok(body.providers.circuitBreaker);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
