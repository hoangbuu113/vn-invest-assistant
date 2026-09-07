import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMarketObservation,
  createUnavailableObservation,
  buildObservationId,
  validateIsoTimestamp,
  PILLARS,
  OBSERVATION_STATUS,
  OBSERVATION_FRESHNESS,
  AUTHORITY_LEVELS,
  UNIT_TYPES
} from '../src/context/factModel.js';
import {
  parseVndirectIndexQuote,
  getVietnamSessionInfo,
  fetchVietnamMarketPillar,
  VIETNAM_INDICES
} from '../src/context/providers/vndirectMarket.js';
import {
  parseYahooQuote,
  fetchCanonicalGoldSpot,
  GLOBAL_INDICATORS
} from '../src/context/providers/globalMarket.js';
import { ContextCache } from '../src/context/cache.js';
import {
  persistMarketObservations,
  fetchLatestPersistedObservations,
  fetchObservationByVintageId,
  clearPersistenceStore,
  rowToObservation,
  observationToRow
} from '../src/context/repository.js';
import {
  runMarketContextCollector,
  mergeWithLastKnownGood,
  normalizeMacroObservations,
  normalizeMonetaryObservations
} from '../src/context/collector.js';
import { evaluateObservationFreshness, CADENCE_POLICIES } from '../src/context/freshnessPolicy.js';
import { getMarketContextFabric } from '../src/context/fabric.js';
import { createApp } from '../index.js';
import { getVietnamRegime } from '../src/regime.js';
import {
  formatMetricValue,
  formatMetricChange,
  buildVietnamRegimeViewModel
} from '../../client/src/utils/regimeDisplay.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(testDir, '..', '..', 'supabase', 'migrations', '20260904030000_create_market_context_observations.sql');

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('V1.2 Improvement 02 — Vietnam Context Data Fabric', () => {

  beforeEach(() => {
    clearPersistenceStore();
  });

  describe('Suite 1: Observation Identity & Vintage Immutability', () => {
    test('1. Exact same observation vintage is idempotent', async () => {
      const obs = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        observationId: 'vn.market.vnindex.close:2026-09-04:pub_close',
        pillar: PILLARS.MARKET,
        label: 'VN-Index',
        value: 1853.08,
        unit: 'điểm',
        referenceTime: '2026-09-04'
      });

      const write1 = await persistMarketObservations([obs], null);
      assert.equal(write1.persisted.length, 1);

      const write2 = await persistMarketObservations([obs], null);
      assert.equal(write2.persisted.length, 1);

      const all = await fetchLatestPersistedObservations(null);
      assert.equal(all.length, 1);
      assert.equal(all[0].value, 1853.08);
      assert.equal(all[0].observationId, 'vn.market.vnindex.close:2026-09-04:pub_close');
    });

    test('2. Revised observation creates a new observation', async () => {
      const preliminaryObs = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        observationId: buildObservationId({
          factId: 'vn.macro.cpi.yoy',
          referenceTime: '2026-08',
          publishedAt: '2026-09-01T02:00:00.000Z',
          revision: 'PRELIMINARY'
        }),
        pillar: PILLARS.MACRO,
        label: 'CPI YoY',
        value: 4.80,
        unit: '%',
        referenceTime: '2026-08',
        publishedAt: '2026-09-01T02:00:00.000Z',
        revisionMarker: 'PRELIMINARY'
      });

      const revisedObs = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        observationId: buildObservationId({
          factId: 'vn.macro.cpi.yoy',
          referenceTime: '2026-08',
          publishedAt: '2026-09-05T02:00:00.000Z',
          revision: 'REVISED'
        }),
        pillar: PILLARS.MACRO,
        label: 'CPI YoY',
        value: 4.89,
        unit: '%',
        referenceTime: '2026-08',
        publishedAt: '2026-09-05T02:00:00.000Z',
        revisionMarker: 'REVISED'
      });

      assert.notEqual(preliminaryObs.observationId, revisedObs.observationId);

      await persistMarketObservations([preliminaryObs], null);
      await persistMarketObservations([revisedObs], null);

      const latest = await fetchLatestPersistedObservations(null);
      assert.equal(latest.length, 1);
      assert.equal(latest[0].value, 4.89);
      assert.equal(latest[0].revisionMarker, 'REVISED');
    });

    test('3. Old revision remains queryable by vintage ID', async () => {
      const preliminaryObs = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        observationId: buildObservationId({
          factId: 'vn.macro.cpi.yoy',
          referenceTime: '2026-08',
          publishedAt: '2026-09-01T02:00:00.000Z',
          revision: 'PRELIMINARY'
        }),
        pillar: PILLARS.MACRO,
        label: 'CPI YoY',
        value: 4.80,
        unit: '%',
        referenceTime: '2026-08',
        publishedAt: '2026-09-01T02:00:00.000Z',
        revisionMarker: 'PRELIMINARY'
      });

      const revisedObs = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        observationId: buildObservationId({
          factId: 'vn.macro.cpi.yoy',
          referenceTime: '2026-08',
          publishedAt: '2026-09-05T02:00:00.000Z',
          revision: 'REVISED'
        }),
        pillar: PILLARS.MACRO,
        label: 'CPI YoY',
        value: 4.89,
        unit: '%',
        referenceTime: '2026-08',
        publishedAt: '2026-09-05T02:00:00.000Z',
        revisionMarker: 'REVISED'
      });

      await persistMarketObservations([preliminaryObs], null);
      await persistMarketObservations([revisedObs], null);

      const oldRecord = await fetchObservationByVintageId(preliminaryObs.observationId, null);
      assert.ok(oldRecord);
      assert.equal(oldRecord.value, 4.80);
      assert.equal(oldRecord.revisionMarker, 'PRELIMINARY');

      const newRecord = await fetchObservationByVintageId(revisedObs.observationId, null);
      assert.ok(newRecord);
      assert.equal(newRecord.value, 4.89);
      assert.equal(newRecord.revisionMarker, 'REVISED');
    });
  });

  describe('Suite 2: Fact Contract & Serialization Round-Trip', () => {
    test('4. Full fact contract survives persistence round-trip', () => {
      const original = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        observationId: 'vn.macro.cpi.yoy:2026-08:pub_20260904',
        pillar: PILLARS.MACRO,
        label: 'Chỉ số CPI (YoY)',
        metric: 'Chỉ số giá tiêu dùng so với cùng kỳ năm trước',
        value: 4.89,
        unit: '%',
        unitType: UNIT_TYPES.PERCENT,
        change: -0.71,
        changeUnit: 'điểm %',
        changeUnitType: UNIT_TYPES.PERCENTAGE_POINT,
        changePercent: -12.68,
        changeBasis: 'SAME_MONTH_PREVIOUS_YEAR',
        previousValue: 5.60,
        quoteDirection: null,
        volume: null,
        volumeUnit: null,
        referenceTime: '2026-08',
        observedAt: null,
        publishedAt: '2026-09-04T02:00:00.000Z',
        fetchedAt: '2026-09-04T07:00:00.000Z',
        source: 'Tổng cục Thống kê (NSO)',
        authorityLevel: AUTHORITY_LEVELS.PRIMARY_OFFICIAL,
        provenance: { releaseDate: '2026-08-29', document: 'Báo cáo KT-XH' },
        freshness: OBSERVATION_FRESHNESS.FRESH,
        status: OBSERVATION_STATUS.AVAILABLE,
        qualityStatus: 'VERIFIED',
        revisionMarker: 'FINAL',
        methodologyVersion: 'v1.2'
      });

      const row = observationToRow(original);
      const restored = rowToObservation(row);

      assert.equal(restored.factId, original.factId);
      assert.equal(restored.observationId, original.observationId);
      assert.equal(restored.pillar, original.pillar);
      assert.equal(restored.label, original.label);
      assert.equal(restored.metric, original.metric);
      assert.equal(restored.value, original.value);
      assert.equal(restored.unit, original.unit);
      assert.equal(restored.unitType, original.unitType);
      assert.equal(restored.change, original.change);
      assert.equal(restored.changeUnit, original.changeUnit);
      assert.equal(restored.changeUnitType, original.changeUnitType);
      assert.equal(restored.changeBasis, original.changeBasis);
      assert.equal(restored.changePercent, original.changePercent);
      assert.equal(restored.previousValue, original.previousValue);
      assert.equal(restored.referenceTime, original.referenceTime);
      assert.equal(restored.observedAt, null);
      assert.equal(restored.publishedAt, original.publishedAt);
      assert.equal(restored.fetchedAt, original.fetchedAt);
      assert.equal(restored.source, original.source);
      assert.equal(restored.authorityLevel, original.authorityLevel);
      assert.deepEqual(restored.provenance, original.provenance);
      assert.equal(restored.freshness, original.freshness);
      assert.equal(restored.status, original.status);
      assert.equal(restored.qualityStatus, original.qualityStatus);
      assert.equal(restored.revisionMarker, original.revisionMarker);
      assert.equal(restored.methodologyVersion, original.methodologyVersion);
    });

    test('5. Persistence write failure is reported visibly', async () => {
      const obs = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        pillar: PILLARS.MARKET,
        label: 'VN-Index',
        value: 1853.08,
        unit: 'điểm',
        referenceTime: '2026-09-04'
      });

      const mockDbErrorClient = {
        from: () => ({
          upsert: async () => ({
            data: null,
            error: {
              message: 'relation "public.market_context_observations" does not exist',
              code: '42P01'
            }
          })
        })
      };

      const result = await persistMarketObservations([obs], mockDbErrorClient);
      assert.equal(result.isDurable, false);
      assert.equal(result.persisted.length, 0);
      assert.equal(result.failed.length, 1);
      assert.ok(result.error);
      assert.match(result.error.message, /does not exist/);
      assert.equal(result.error.code, '42P01');
    });
  });

  describe('Suite 3: Public Request Path Safety & Cold-Start Reads', () => {
    test('6. Public GET never calls provider/collector', async () => {
      let liveScraperCalled = false;
      let liveCollectorCalled = false;

      // Seed 1 persisted fact so the regime endpoint has data to return 200
      await persistMarketObservations([
        createMarketObservation({
          factId: 'vn.macro.cpi.yoy',
          id: 'macro.cpi_yoy',
          pillar: PILLARS.MACRO,
          label: 'CPI YoY',
          value: 4.89,
          unit: '%',
          referenceTime: '2026-08'
        })
      ], null);

      const app = createApp({
        runMarketContextCollectorFn: async () => {
          liveCollectorCalled = true;
          return { success: true };
        },
        fetchNsoInflationFn: async () => {
          liveScraperCalled = true;
          return { status: 'available' };
        }
      });

      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/regime/vietnam`);
        assert.equal(res.status, 200);
        assert.equal(liveCollectorCalled, false, 'Collector must NEVER be called on public GET');
        assert.equal(liveScraperCalled, false, 'Live provider scraper must NEVER be called on public GET');
      });
    });

    test('7. Cache miss + persistence miss returns unavailable without live provider fetch', async () => {
      clearPersistenceStore();
      const emptyCache = new ContextCache(60);

      const fabric = await getMarketContextFabric({
        client: null,
        now: new Date('2026-09-04T07:00:00.000Z'),
        cache: emptyCache
      });

      assert.ok(fabric.pillars);
      assert.equal(fabric.source, 'empty');
      assert.equal(fabric.facts.length, 0);

      // Verify getVietnamRegime derives explicit unavailable domains without live fetch
      const regime = await getVietnamRegime({
        client: null,
        now: new Date('2026-09-04T07:00:00.000Z'),
        getFabricFn: async () => fabric
      });

      assert.equal(regime.inflation.status, 'unavailable');
      assert.equal(regime.inflation.headlineCpiYoYPct, null);
      assert.equal(regime.moneyMarket.status, 'unavailable');
      assert.equal(regime.moneyMarket.vndOvernightRatePct, null);
    });

    test('8. Cold start reads persisted facts', async () => {
      const seedFacts = [
        createMarketObservation({
          factId: 'vn.macro.cpi.yoy',
          id: 'macro.cpi_yoy',
          pillar: PILLARS.MACRO,
          label: 'CPI YoY',
          value: 4.89,
          unit: '%',
          referenceTime: '2026-08'
        }),
        createMarketObservation({
          factId: 'vn.market.vnindex.close',
          id: 'market.vnindex',
          pillar: PILLARS.MARKET,
          label: 'VN-Index',
          value: 1853.08,
          unit: 'điểm',
          referenceTime: '2026-09-04'
        })
      ];

      await persistMarketObservations(seedFacts, null);

      const freshCache = new ContextCache(60);
      const fabric = await getMarketContextFabric({
        client: null,
        now: new Date('2026-09-04T07:00:00.000Z'),
        cache: freshCache
      });

      const vnindex = fabric.pillars.market.find((o) => o.factId === 'vn.market.vnindex.close');
      assert.ok(vnindex);
      assert.equal(vnindex.value, 1853.08);

      const cpi = fabric.pillars.macro.find((o) => o.factId === 'vn.macro.cpi.yoy');
      assert.ok(cpi);
      assert.equal(cpi.value, 4.89);
    });
  });

  describe('Suite 4: Collector Fault Isolation & Staleness Semantics', () => {
    test('9. Partial provider failure preserves last-known-good', () => {
      const now = new Date('2026-09-04T12:00:00.000Z');
      const lastKnownGood = [
        createMarketObservation({
          factId: 'vn.monetary.rate.vnd_overnight',
          id: 'monetary.vnd_overnight_rate',
          pillar: PILLARS.MONETARY,
          label: 'Lãi suất VND qua đêm',
          value: 4.25,
          unit: '%',
          referenceTime: '2026-09-03',
          observedAt: '2026-09-03T10:00:00.000Z'
        })
      ];

      const currentRaw = [
        createUnavailableObservation('monetary.vnd_overnight_rate', PILLARS.MONETARY, 'Lãi suất VND qua đêm', 'CONNECTION_TIMEOUT', {
          factId: 'vn.monetary.rate.vnd_overnight'
        })
      ];

      const merged = mergeWithLastKnownGood(currentRaw, lastKnownGood, now);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].value, 4.25);
      assert.deepEqual(merged[0].provenance, lastKnownGood[0].provenance);
      assert.equal(merged[0].status, 'available');
    });

    test('10. Stale status derived correctly from source age (>36h)', () => {
      const now = new Date('2026-09-05T12:00:00.000Z');
      // 48 hours old observation
      const oldObs = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        id: 'market.vnindex',
        pillar: PILLARS.MARKET,
        label: 'VN-Index',
        value: 1850.00,
        unit: 'điểm',
        referenceTime: '2026-09-03',
        observedAt: '2026-09-03T08:00:00.000Z'
      });

      const currentUnavailable = [
        createUnavailableObservation('market.vnindex', PILLARS.MARKET, 'VN-Index', 'PROVIDER_DOWN', {
          factId: 'vn.market.vnindex.close'
        })
      ];

      const merged = mergeWithLastKnownGood(currentUnavailable, [oldObs], now);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].value, 1850.00);
      assert.equal(merged[0].status, 'stale');
      assert.equal(merged[0].freshness, 'stale');
    });

    test('10b. Official SBV WAF denial remains an explicit source-access blocker', () => {
      const observations = normalizeMonetaryObservations({
        status: 'unavailable',
        reason: 'BLOCKED_BY_SOURCE_ACCESS',
        vndOvernightRatePct: null,
        provenance: { source: 'Ngân hàng Nhà nước Việt Nam (SBV)' }
      }, null, new Date('2026-09-07T00:00:00.000Z'));

      const officialRate = observations.find((item) => item.factId === 'vn.monetary.rate.vnd_overnight');
      assert.equal(officialRate.status, 'unavailable');
      assert.equal(officialRate.value, null);
      assert.equal(officialRate.statusReason, 'BLOCKED_BY_SOURCE_ACCESS');
      assert.equal(officialRate.provenance.reason, 'BLOCKED_BY_SOURCE_ACCESS');
    });
  });

  describe('Suite 5: Data Correctness & Unit Semantics', () => {
    test('11. Missing numerical value is null, never zero', () => {
      const obs = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        pillar: PILLARS.MACRO,
        label: 'Lạm phát CPI',
        value: null,
        unit: '%'
      });

      assert.strictEqual(obs.value, null);
      assert.notEqual(obs.value, 0);
      assert.equal(obs.status, 'unavailable');
    });

    test('12. Percent != percentage_point', () => {
      const cpi = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        pillar: PILLARS.MACRO,
        label: 'CPI YoY',
        value: 4.89,
        unit: '%',
        unitType: UNIT_TYPES.PERCENT,
        change: -0.71,
        changeUnit: 'điểm %',
        changeUnitType: UNIT_TYPES.PERCENTAGE_POINT
      });

      assert.equal(cpi.unit, '%');
      assert.equal(cpi.unitType, 'percent');
      assert.equal(cpi.changeUnit, 'điểm %');
      assert.equal(cpi.changeUnitType, 'percentage_point');
      assert.notEqual(cpi.unit, cpi.changeUnit);
    });

    test('13. FX quote direction preserved (VND_PER_USD, CNY_PER_USD)', () => {
      const usdVnd = createMarketObservation({
        factId: 'vn.monetary.fx.usd_vnd',
        pillar: PILLARS.MONETARY,
        label: 'USD/VND',
        value: 26070,
        unit: 'VND',
        unitType: UNIT_TYPES.CURRENCY_RATIO,
        quoteDirection: 'VND_PER_USD'
      });
      assert.equal(usdVnd.quoteDirection, 'VND_PER_USD');

      const usdCny = createMarketObservation({
        factId: 'global.intermarket.fx.usd_cny',
        pillar: PILLARS.INTERMARKET,
        label: 'USD/CNY',
        value: 6.70,
        unit: 'CNY',
        unitType: UNIT_TYPES.CURRENCY_RATIO,
        quoteDirection: 'CNY_PER_USD'
      });
      assert.equal(usdCny.quoteDirection, 'CNY_PER_USD');
    });
  });

  describe('Suite 6: Vietnam Session Timing & Breadth Invariants', () => {
    test('14. Completed Vietnam session behavior (Asia/Ho_Chi_Minh)', () => {
      // Friday 2026-08-28 15:30 ICT (08:30 UTC) -> completed session
      const fridayEpochSec = Math.floor(new Date('2026-08-28T08:30:00.000Z').getTime() / 1000);
      const evalTime = new Date('2026-08-28T09:00:00.000Z');
      const info = getVietnamSessionInfo(fridayEpochSec, evalTime);

      assert.equal(info.sessionDate, '2026-08-28');
      assert.equal(info.isCompleted, true);
      assert.equal(info.isWeekend, false);
      assert.equal(info.isFuture, false);
    });

    test('15. Weekend / current-session exclusion (before 15:00 ICT)', () => {
      // Intraday Friday 10:30 ICT (03:30 UTC) -> ongoing, not completed
      const intradayEpoch = Math.floor(new Date('2026-08-28T03:30:00.000Z').getTime() / 1000);
      const intradayNow = new Date('2026-08-28T03:30:00.000Z');
      const intradayInfo = getVietnamSessionInfo(intradayEpoch, intradayNow);
      assert.equal(intradayInfo.isCompleted, false, 'Session before 15:00 ICT must NOT be treated as completed');

      // Saturday timestamp
      const saturdayEpoch = Math.floor(new Date('2026-08-29T08:00:00.000Z').getTime() / 1000);
      const saturdayNow = new Date('2026-08-29T10:00:00.000Z');
      const saturdayInfo = getVietnamSessionInfo(saturdayEpoch, saturdayNow);
      assert.equal(saturdayInfo.isWeekend, true);
      assert.equal(saturdayInfo.isCompleted, false, 'Weekend bar must not be marked as completed session');
    });

    test('16. Gold Futures != Gold Spot', async () => {
      const futuresDef = GLOBAL_INDICATORS.find((i) => i.id === 'intermarket.gold_futures');
      assert.ok(futuresDef);
      assert.equal(futuresDef.symbol, 'GC=F');
      assert.equal(futuresDef.factId, 'global.intermarket.gold_futures.price');
      assert.match(futuresDef.label, /Vàng tương lai/i);
      assert.doesNotMatch(futuresDef.label, /XAU\/USD/i);

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Gold',
          symbol: 'XAU',
          price: '4512.60',
          timestamp: '2026-09-04 12:00:00'
        })
      });

      const spotObs = await fetchCanonicalGoldSpot({ fetchFn: mockFetch, apiKey: 'test_key' });
      assert.equal(spotObs.factId, 'global.intermarket.gold_spot.price');
      assert.equal(spotObs.label, 'Vàng giao ngay (XAU/USD)');
      assert.equal(spotObs.value, 4512.60);
      assert.equal(spotObs.unit, 'USD/oz');
      assert.notEqual(spotObs.factId, futuresDef.factId);
    });

    test('17. Breadth stays unavailable (SOURCE_NOT_PROVISIONED)', async () => {
      const mockVndirectData = {
        s: 'ok',
        t: [1787875200, 1787961600],
        o: [1840.0, 1845.0],
        h: [1850.0, 1860.0],
        l: [1835.0, 1842.0],
        c: [1840.74, 1853.08],
        v: [220000000, 250000000]
      };
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => mockVndirectData
      });

      const observations = await fetchVietnamMarketPillar({ fetchFn: mockFetch });
      const breadth = observations.find((o) => o.id === 'market.breadth');
      assert.ok(breadth);
      assert.equal(breadth.status, 'unavailable');
      assert.equal(breadth.statusReason, 'SOURCE_NOT_PROVISIONED');
      assert.equal(breadth.value, null);
    });
  });

  describe('Suite 7: Security Boundary & Schema Integrity', () => {
    test('18. Scheduler route remains protected (>=32 chars token)', async () => {
      let collectorRan = false;
      const validToken = 'test-alert-scheduler-token-32chars-long!';
      const app = createApp({
        alertSchedulerToken: validToken,
        runMarketContextCollectorFn: async () => {
          collectorRan = true;
          return { success: true, isDurable: true, failedPersistence: 0, persisted: 8, totalPersisted: 8 };
        }
      });

      await withServer(app, async (baseUrl) => {
        // Without token: 401
        const unauth = await fetch(`${baseUrl}/api/internal/context/refresh`, { method: 'POST' });
        assert.equal(unauth.status, 401);
        assert.equal(collectorRan, false);

        // With valid Bearer token: 200
        const auth = await fetch(`${baseUrl}/api/internal/context/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${validToken}` }
        });
        assert.equal(auth.status, 200);
        const body = await auth.json();
        assert.equal(body.status, 'ok');
        assert.equal(collectorRan, true);
      });
    });

    test('19. Public cannot write market context table (RLS migration)', () => {
      assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');

      assert.match(migrationSql, /ENABLE ROW LEVEL SECURITY/i);
      assert.match(migrationSql, /CREATE POLICY market_context_observations_read/i);
      assert.match(migrationSql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.market_context_observations FROM PUBLIC/i);
      assert.match(migrationSql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.market_context_observations FROM anon, authenticated/i);
      assert.match(migrationSql, /GRANT ALL ON public\.market_context_observations TO service_role/i);
      assert.doesNotMatch(migrationSql, /^\s*user_id\s+/m);
      assert.doesNotMatch(migrationSql, /^\s*profile_id\s+/m);
    });
  });

  describe('Suite 8: UI View Model & Formatting', () => {
    test('20. UI view model preserves units and stale status', () => {
      const payload = {
        partial: false,
        fetchedAt: '2026-09-04T08:00:00.000Z',
        inflation: {
          status: 'available',
          headlineCpiYoYPct: 4.89,
          threeMonthDeltaPp: -0.71,
          referencePeriod: '2026-08'
        },
        moneyMarket: {
          status: 'stale',
          underlyingStatus: 'available',
          vndOvernightRatePct: 4.25
        },
        marketBreadth: {
          status: 'unavailable',
          reason: 'SOURCE_NOT_PROVISIONED'
        },
        pillars: {
          macro: [
            { id: 'macro.cpi_yoy', label: 'CPI YoY', value: 4.89, unit: '%', status: 'available' }
          ],
          monetary: [
            { id: 'monetary.vnd_overnight_rate', label: 'Qua đêm', value: 4.25, unit: '%', status: 'stale' }
          ]
        },
        pulseMetrics: [
          {
            id: 'cpi_yoy',
            factId: 'vn.macro.cpi.yoy',
            label: 'CPI YoY',
            value: 4.89,
            unit: '%',
            change: -0.71,
            changeUnit: 'điểm %',
            changeUnitType: 'percentage_point',
            status: 'available'
          },
          {
            id: 'overnight_rate',
            factId: 'vn.monetary.rate.vnd_overnight',
            label: 'Lãi suất qua đêm',
            value: 4.25,
            unit: '%',
            status: 'stale'
          }
        ]
      };

      const vm = buildVietnamRegimeViewModel(payload);
      assert.equal(vm.inflation.usable, true);
      assert.equal(vm.moneyMarket.usable, true);
      assert.equal(vm.moneyMarket.status, 'stale');
      assert.equal(vm.marketBreadth.status, 'unavailable');
      assert.equal(vm.pulseMetrics.length, 2);

      const cpiPulse = vm.pulseMetrics.find((p) => p.factId === 'vn.macro.cpi.yoy');
      assert.ok(cpiPulse);
      assert.equal(cpiPulse.unit, '%');

      // Test formatting functions
      const formattedCpiVal = formatMetricValue(4.89, '%');
      assert.match(formattedCpiVal, /4,89\s*%/);

      const formattedPpChange = formatMetricChange(-0.71, null, 'điểm %', 'percentage_point');
      assert.equal(formattedPpChange, '-0,71 điểm %');

      const formattedIndexChange = formatMetricChange(12.34, 0.67, 'điểm', 'index_point');
      assert.match(formattedIndexChange, /\+12,34\s*điểm\s*\(\+0,67%\)/);

      const nullVal = formatMetricValue(null, '%');
      assert.equal(nullVal, '—');
    });
  });

  describe('Suite 9: Codex Final Blocker Verification (Tests A - P)', () => {
    test('A. Same metadata + corrected content/value produces new observationId and retains old observation', async () => {
      const obs1 = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        referenceTime: '2026-08',
        publishedAt: '2026-09-01T02:00:00.000Z',
        revisionMarker: 'PRELIMINARY',
        value: 4.80,
        unit: '%',
        pillar: PILLARS.MACRO,
        label: 'CPI YoY'
      });

      const obs2 = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        referenceTime: '2026-08',
        publishedAt: '2026-09-01T02:00:00.000Z',
        revisionMarker: 'PRELIMINARY', // Exact same metadata
        value: 4.85, // Corrected value
        unit: '%',
        pillar: PILLARS.MACRO,
        label: 'CPI YoY'
      });

      assert.notEqual(obs1.observationId, obs2.observationId, 'Differing content must produce differing observationId even with identical metadata');
      assert.notEqual(obs1.sourceContentHash, obs2.sourceContentHash);

      await persistMarketObservations([obs1], null);
      await persistMarketObservations([obs2], null);

      const oldObs = await fetchObservationByVintageId(obs1.observationId, null);
      const newObs = await fetchObservationByVintageId(obs2.observationId, null);
      assert.ok(oldObs, 'Old observation must be retained');
      assert.equal(oldObs.value, 4.80);
      assert.ok(newObs, 'New observation must be retained');
      assert.equal(newObs.value, 4.85);
    });

    test('B. Exact same content is idempotent with identical observationId', async () => {
      const obs1 = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        referenceTime: '2026-09-04',
        publishedAt: '2026-09-04T08:05:00.000Z',
        value: 1853.08,
        unit: 'điểm',
        pillar: PILLARS.MARKET,
        label: 'VN-Index'
      });

      const obs2 = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        referenceTime: '2026-09-04',
        publishedAt: '2026-09-04T08:05:00.000Z',
        value: 1853.08,
        unit: 'điểm',
        pillar: PILLARS.MARKET,
        label: 'VN-Index'
      });

      assert.equal(obs1.observationId, obs2.observationId);
      assert.equal(obs1.sourceContentHash, obs2.sourceContentHash);
    });

    test('C. Serializer values satisfy migration SQL enum/check constraints', () => {
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');

      const validPillars = ['macro', 'monetary', 'market', 'intermarket'];
      for (const p of Object.values(PILLARS)) {
        assert.ok(validPillars.includes(p), `Pillar ${p} must be valid in SQL enum`);
      }

      const validStatuses = ['available', 'stale', 'unavailable', 'insufficient_history'];
      for (const s of Object.values(OBSERVATION_STATUS)) {
        assert.ok(validStatuses.includes(s), `Status ${s} must be valid in SQL enum`);
      }

      const allowedQualityStatuses = ['available', 'verified', 'preliminary', 'revised', 'reported'];
      const sampleObs = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        pillar: PILLARS.MACRO,
        label: 'CPI',
        value: 4.8,
        unit: '%',
        qualityStatus: 'verified'
      });
      const sampleRow = observationToRow(sampleObs);
      assert.ok(allowedQualityStatuses.includes(sampleRow.quality_status), 'quality_status must satisfy SQL check constraint');
      assert.notEqual(sampleRow.quality_status, 'stale', 'quality_status must NEVER be set to stale');

      assert.match(migrationSql, /CHECK\s*\(\s*quality_status\s+IN\s*\('available',\s*'verified',\s*'preliminary',\s*'revised',\s*'reported'\)\s*\)/i);
      assert.match(migrationSql, /CHECK\s*\(\s*pillar\s+IN\s*\('macro',\s*'monetary',\s*'market',\s*'intermarket'\)\s*\)/i);
      assert.match(migrationSql, /CHECK\s*\(\s*status\s+IN\s*\('available',\s*'unavailable',\s*'stale'\)\s*\)/i);
    });

    test('D. No fabricated referenceTime (nullable in DB and model)', () => {
      const intradayObs = createMarketObservation({
        factId: 'global.intermarket.brent.price',
        pillar: PILLARS.INTERMARKET,
        label: 'Dầu Brent',
        value: 78.50,
        unit: 'USD/thùng',
        publishedAt: '2026-09-04T10:00:00.000Z',
        referenceTime: null
      });

      assert.equal(intradayObs.referenceTime, null, 'referenceTime must remain null when not supplied');

      const row = observationToRow(intradayObs);
      assert.equal(row.reference_time, null, 'Serialized row reference_time must be null');

      const restored = rowToObservation(row);
      assert.equal(restored.referenceTime, null, 'Restored observation referenceTime must remain null, never fabricated');
    });

    test('E. CPI monthly freshness is valid through cadence, not stale after 36h', () => {
      const cpiObs = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        pillar: PILLARS.MACRO,
        label: 'CPI YoY',
        value: 4.45,
        unit: '%',
        referenceTime: '2026-07',
        publishedAt: '2026-08-03T02:00:00.000Z'
      });

      // 48 hours after publication (would be stale under old generic 36h rule)
      const after48h = new Date('2026-08-05T02:00:00.000Z');
      const eval48h = evaluateObservationFreshness(cpiObs, after48h);
      assert.equal(eval48h.freshness, 'fresh', 'CPI must be fresh 48h after publication');

      // 20 days after publication (mid August)
      const midAug = new Date('2026-08-23T02:00:00.000Z');
      const evalMidAug = evaluateObservationFreshness(cpiObs, midAug);
      assert.equal(evalMidAug.freshness, 'fresh', 'CPI must remain fresh through monthly cadence');

      // 50 days after month end (late September, next release overdue)
      const lateSep = new Date('2026-09-25T02:00:00.000Z');
      const evalLateSep = evaluateObservationFreshness(cpiObs, lateSep);
      assert.equal(evalLateSep.freshness, 'stale', 'CPI becomes stale after cadence policy threshold expires');
    });

    test('F. Daily market freshness: Friday close remains valid over weekend until Monday 15:00 ICT', () => {
      // Friday Sept 4, 2026 close (15:00 ICT = 08:00 UTC)
      const vnindexFriday = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        pillar: PILLARS.MARKET,
        label: 'VN-Index',
        value: 1853.08,
        unit: 'điểm',
        referenceTime: '2026-09-04',
        observedAt: '2026-09-04T08:00:00.000Z',
        publishedAt: '2026-09-04T08:05:00.000Z'
      });

      // Saturday Sept 5, 12:00 ICT
      const saturday = new Date('2026-09-05T05:00:00.000Z');
      assert.equal(evaluateObservationFreshness(vnindexFriday, saturday).freshness, 'fresh', 'Friday close is fresh on Saturday');

      // Sunday Sept 6, 20:00 ICT
      const sunday = new Date('2026-09-06T13:00:00.000Z');
      assert.equal(evaluateObservationFreshness(vnindexFriday, sunday).freshness, 'fresh', 'Friday close is fresh on Sunday');

      // Monday Sept 7, 10:00 ICT (active trading hours of next session)
      const mondayMorning = new Date('2026-09-07T03:00:00.000Z');
      assert.equal(evaluateObservationFreshness(vnindexFriday, mondayMorning).freshness, 'fresh', 'Friday close is fresh on Monday morning');

      // Monday Sept 7, 20:00 ICT (after Monday session close + grace)
      const mondayNight = new Date('2026-09-07T13:00:00.000Z');
      assert.equal(evaluateObservationFreshness(vnindexFriday, mondayNight).freshness, 'stale', 'Friday close becomes stale once Monday session closes');
    });

    test('F2. Expired cache TTL never overrides cadence-valid market freshness', async () => {
      const cachedAt = new Date('2026-09-04T08:05:00.000Z');
      const sunday = new Date('2026-09-06T13:00:00.000Z');
      const mondayMorning = new Date('2026-09-07T03:00:00.000Z');
      const mondayAfterClose = new Date('2026-09-07T13:00:00.000Z');
      const cache = new ContextCache({
        macro: { freshTtlMs: 1, staleTtlMs: 7 * 24 * 60 * 60 * 1000 },
        monetary: { freshTtlMs: 1, staleTtlMs: 7 * 24 * 60 * 60 * 1000 },
        market: { freshTtlMs: 1, staleTtlMs: 7 * 24 * 60 * 60 * 1000 },
        intermarket: { freshTtlMs: 1, staleTtlMs: 7 * 24 * 60 * 60 * 1000 }
      });

      const fridayClose = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        id: 'market.vnindex',
        pillar: PILLARS.MARKET,
        label: 'VN-Index',
        value: 1853.08,
        unit: 'điểm',
        referenceTime: '2026-09-04',
        observedAt: '2026-09-04T08:00:00.000Z',
        publishedAt: '2026-09-04T08:05:00.000Z'
      });
      const supportingPillars = {
        macro: createMarketObservation({
          factId: 'vn.macro.cpi.yoy', pillar: PILLARS.MACRO, label: 'CPI YoY',
          value: 4.89, unit: '%', referenceTime: '2026-08', publishedAt: '2026-08-31T02:00:00.000Z'
        }),
        monetary: createMarketObservation({
          factId: 'vn.monetary.rate.vnd_overnight', pillar: PILLARS.MONETARY, label: 'Lãi suất VND qua đêm',
          value: 4.25, unit: '%', referenceTime: '2026-08-31', publishedAt: '2026-09-01T02:00:00.000Z',
          authorityLevel: AUTHORITY_LEVELS.REGULATORY_OFFICIAL
        }),
        intermarket: createMarketObservation({
          factId: 'global.intermarket.dxy.quote', pillar: PILLARS.INTERMARKET, label: 'DXY',
          value: 98.25, observedAt: '2026-09-04T08:00:00.000Z'
        })
      };

      cache.set('macro', [supportingPillars.macro], cachedAt);
      cache.set('monetary', [supportingPillars.monetary], cachedAt);
      cache.set('market', [fridayClose], cachedAt);
      cache.set('intermarket', [supportingPillars.intermarket], cachedAt);

      const expiredCacheEntry = cache.get('market', sunday);
      assert.equal(expiredCacheEntry.cacheStatus, 'stale', 'cache payload is due for refresh');
      assert.equal(expiredCacheEntry.data[0].freshness, 'fresh', 'cache TTL must not mutate economic freshness');

      const sundayFabric = await getMarketContextFabric({ client: null, now: sunday, cache });
      assert.equal(sundayFabric.pillars.market[0].freshness, 'fresh', 'Friday close remains cadence-valid on Sunday');

      const mondayMorningFabric = await getMarketContextFabric({ client: null, now: mondayMorning, cache });
      assert.equal(mondayMorningFabric.pillars.market[0].freshness, 'fresh', 'Friday close remains valid before Monday replacement close');

      const staleFabric = await getMarketContextFabric({ client: null, now: mondayAfterClose, cache });
      assert.equal(staleFabric.pillars.market[0].freshness, 'stale', 'genuinely stale Friday close is rejected after the next session');

      const mondayClose = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        id: 'market.vnindex',
        pillar: PILLARS.MARKET,
        label: 'VN-Index',
        referenceTime: '2026-09-07',
        value: 1860.12,
        unit: 'điểm',
        observedAt: '2026-09-07T08:00:00.000Z',
        publishedAt: '2026-09-07T08:05:00.000Z'
      });
      cache.set('market', [mondayClose], new Date('2026-09-07T08:05:00.000Z'));

      const supersededFabric = await getMarketContextFabric({ client: null, now: mondayAfterClose, cache });
      assert.equal(supersededFabric.pillars.market[0].referenceTime, '2026-09-07');
      assert.equal(supersededFabric.pillars.market[0].freshness, 'fresh', 'next valid close supersedes the prior session');
    });

    test('G. Cold DB read dynamically recalculates freshness based on current time', async () => {
      const cpiJuly = createMarketObservation({
        factId: 'vn.macro.cpi.yoy',
        pillar: PILLARS.MACRO,
        label: 'CPI YoY',
        value: 4.45,
        unit: '%',
        referenceTime: '2026-07',
        publishedAt: '2026-08-03T02:00:00.000Z',
        freshness: 'fresh'
      });

      await persistMarketObservations([cpiJuly], null);

      // Read at time when it was fresh (mid-August 2026)
      const readFresh = await fetchLatestPersistedObservations(null, new Date('2026-08-15T00:00:00.000Z'));
      assert.equal(readFresh[0].freshness, 'fresh');
      assert.equal(readFresh[0].status, 'available');

      // Read at time when it is stale (October 2026)
      const readStale = await fetchLatestPersistedObservations(null, new Date('2026-10-01T00:00:00.000Z'));
      assert.equal(readStale[0].freshness, 'stale');
      assert.equal(readStale[0].status, 'stale');
    });

    test('H. Whole provider failure retains ALL last-known-good facts for that domain', () => {
      const now = new Date('2026-09-04T12:00:00.000Z');
      const lkgMarketFacts = [
        createMarketObservation({ factId: 'vn.market.vnindex.close', value: 1853.08, pillar: PILLARS.MARKET, label: 'VN-Index', unit: 'điểm' }),
        createMarketObservation({ factId: 'vn.market.vn30.close', value: 1910.45, pillar: PILLARS.MARKET, label: 'VN30', unit: 'điểm' }),
        createMarketObservation({ factId: 'vn.market.hnx.close', value: 242.30, pillar: PILLARS.MARKET, label: 'HNX-Index', unit: 'điểm' })
      ];

      // Entire market provider failed and returned empty array []
      const emptyMarketBatch = [];
      const merged = mergeWithLastKnownGood(emptyMarketBatch, lkgMarketFacts, now);

      assert.equal(merged.length, 3, 'All 3 LKG facts must be preserved when provider returns empty batch');
      assert.ok(merged.find((f) => f.factId === 'vn.market.vnindex.close'));
      assert.ok(merged.find((f) => f.factId === 'vn.market.vn30.close'));
      assert.ok(merged.find((f) => f.factId === 'vn.market.hnx.close'));
    });

    test('I. LKG is NOT re-persisted under modified provenance or freshness', async () => {
      let upsertPayload = null;
      const mockClient = {
        from: () => ({
          upsert: async (rows) => {
            upsertPayload = rows;
            return { data: rows, error: null };
          }
        })
      };

      const existingLkg = [
        createMarketObservation({
          factId: 'vn.macro.cpi.yoy',
          value: 4.89,
          pillar: PILLARS.MACRO,
          label: 'CPI YoY',
          unit: '%',
          referenceTime: '2026-08',
          provenance: { source: 'NSO', releaseDate: '2026-08-29' }
        })
      ];

      // Collector runs where macro provider returns null (fails)
      await runMarketContextCollector({
        now: new Date('2026-09-04T12:00:00.000Z'),
        client: mockClient,
        fetchNsoInflationFn: async () => null,
        fetchSbvMoneyMarketFn: async () => null,
        fetchUsdVndFn: async () => null,
        fetchMarketPillarFn: async () => [],
        fetchGlobalPillarFn: async () => []
      });

      // No new valid observations were fetched, so collector must NOT re-persist LKG facts
      assert.equal(upsertPayload, null, 'LKG must NOT be re-persisted when no new observation is fetched');
      assert.deepEqual(existingLkg[0].provenance, { source: 'NSO', releaseDate: '2026-08-29' });
    });

    test('J. Memory-only write reports durablyPersisted = 0 and isDurable = false', async () => {
      const obs = createMarketObservation({
        factId: 'vn.market.vnindex.close',
        value: 1853.08,
        pillar: PILLARS.MARKET,
        label: 'VN-Index',
        unit: 'điểm'
      });

      const writeResult = await persistMarketObservations([obs], null);
      assert.equal(writeResult.isDurable, false);
      assert.equal(writeResult.durablyPersisted, 0);
      assert.equal(writeResult.memoryAccepted, 1);
      assert.equal(writeResult.memoryOnly, true);
    });

    test('K. Internal refresh route reports persistence failure truthfully (HTTP 503 degraded)', async () => {
      const validToken = 'test-alert-scheduler-token-32chars-long!';
      const app = createApp({
        alertSchedulerToken: validToken,
        runMarketContextCollectorFn: async () => ({
          success: false,
          isDurable: false,
          fetched: 5,
          validated: 5,
          durablyPersisted: 0,
          memoryAccepted: 5,
          failedPersistence: 5,
          persistenceError: { message: 'Database connection timeout' }
        })
      });

      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/internal/context/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${validToken}` }
        });
        assert.equal(res.status, 503);
        const body = await res.json();
        assert.equal(body.status, 'degraded');
        assert.equal(body.data.isDurable, false);
        assert.equal(body.data.failedPersistence, 5);
      });
    });

    test('L. CPI M-3 change basis is THREE_MONTH_CHANGE with percentage_point unit', () => {
      const macroObs = normalizeMacroObservations({
        status: 'available',
        headlineCpiYoYPct: 4.45,
        threeMonthDeltaPp: -1.01,
        referencePeriod: '2026-07',
        publishedAt: '2026-08-03T02:00:00.000Z',
        provenance: { source: 'NSO' }
      }, new Date('2026-08-03T05:00:00.000Z'));

      const cpi = macroObs.find((o) => o.factId === 'vn.macro.cpi.yoy');
      assert.ok(cpi);
      assert.equal(cpi.change, -1.01);
      assert.equal(cpi.changeUnit, 'điểm %');
      assert.equal(cpi.changeUnitType, 'percentage_point');
      assert.equal(cpi.changeBasis, 'THREE_MONTH_CHANGE');
    });

    test('M. Global market indicators specify explicit changeUnitType and changeBasis', () => {
      for (const def of GLOBAL_INDICATORS) {
        assert.ok(def.changeBasis, `Indicator ${def.id} must specify changeBasis`);
        assert.ok(def.changeUnitType, `Indicator ${def.id} must specify changeUnitType`);
      }

      const dxy = GLOBAL_INDICATORS.find((i) => i.symbol === 'DX-Y.NYB');
      assert.equal(dxy.changeBasis, 'PREVIOUS_SESSION_CLOSE');
      assert.equal(dxy.changeUnitType, 'index_point');

      const brent = GLOBAL_INDICATORS.find((i) => i.symbol === 'BZ=F');
      assert.equal(brent.changeBasis, 'PREVIOUS_SESSION_CLOSE');
      assert.equal(brent.changeUnitType, 'price_usd');
    });

    test('N. Percent changes are calculated from unrounded source values', () => {
      const rawClose = 1853.0764;
      const rawPrev = 1840.7382;

      const expectedUnroundedPercent = ((rawClose - rawPrev) / rawPrev) * 100;
      const expectedRoundedAtEnd = Math.round(expectedUnroundedPercent * 100) / 100;

      // 1787788800 is Thursday Aug 27, 2026; 1787875200 is Friday Aug 28, 2026 (both completed sessions)
      const quote = parseVndirectIndexQuote({
        s: 'ok',
        t: [1787788800, 1787875200],
        c: [rawPrev, rawClose]
      }, VIETNAM_INDICES[0], new Date('2026-08-28T12:00:00.000Z'));

      assert.equal(quote.changePercent, expectedRoundedAtEnd);
      assert.equal(quote.change, 12.34);
    });

    test('O. UI formatting preserves full units without discarding or double-appending', () => {
      assert.equal(formatMetricValue(1853.08, 'điểm'), '1.853,08 điểm');
      assert.equal(formatMetricValue(2845.50, 'USD/oz'), '2,845.50 USD/oz');
      assert.equal(formatMetricValue(78.25, 'USD/thùng'), '78.25 USD/thùng');
      assert.match(formatMetricValue(4.8, '%'), /4,8\s*%/);
      assert.equal(formatMetricValue(25450, 'VND'), '25.450 VND');
      assert.equal(formatMetricValue(7.2345, 'CNY'), '7,2345 CNY');

      assert.equal(formatMetricChange(12.34, 0.67, 'điểm'), '+12,34 điểm (+0,67%)');
      assert.equal(formatMetricChange(-15.20, -0.53, 'USD/oz'), '-15,2 USD/oz (-0,53%)');
      assert.equal(formatMetricChange(0.50, 0.64, 'USD/thùng'), '+0,5 USD/thùng (+0,64%)');
      assert.equal(formatMetricChange(-0.71, null, 'điểm %', 'percentage_point'), '-0,71 điểm %');
      assert.equal(formatMetricChange(50, 0.20, 'VND'), '+50 VND (+0,20%)');
    });

    test('P. Actual VNDirect provider selection excludes current active Vietnam session bar', async () => {
      // 10:00 ICT on Friday Sept 4, 2026 (03:00 UTC) -> active trading session
      const nowDuringSession = new Date('2026-09-04T03:00:00.000Z');

      // Thursday Sept 3 close epoch: 1787875200 (completed session, close: 1840.74)
      // Friday Sept 4 10:00 epoch: 1787961600 (active ongoing session, intraday: 1853.08)
      const mockVndirectData = {
        s: 'ok',
        t: [1787875200, 1787961600],
        o: [1830.0, 1845.0],
        h: [1845.0, 1860.0],
        l: [1828.0, 1842.0],
        c: [1840.74, 1853.08],
        v: [200000000, 50000000]
      };

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => mockVndirectData
      });

      const observations = await fetchVietnamMarketPillar({ now: nowDuringSession, fetchFn: mockFetch });
      const vnindex = observations.find((o) => o.factId === 'vn.market.vnindex.close');

      assert.ok(vnindex);
      assert.equal(vnindex.value, 1840.74);
      assert.equal(vnindex.status, 'available');
    });
  });
});
