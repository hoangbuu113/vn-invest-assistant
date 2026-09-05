import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PILLARS,
  UNIT_TYPES,
  OBSERVATION_FRESHNESS,
  OBSERVATION_STATUS,
  AUTHORITY_LEVELS,
  createMarketObservation,
  buildObservationId,
  calculateSourceContentHash,
  compareObservationVintages,
  selectLatestObservationPerFact
} from '../src/context/factModel.js';
import {
  evaluateObservationFreshness,
  CADENCE_POLICIES
} from '../src/context/freshnessPolicy.js';
import {
  mergeWithLastKnownGood
} from '../src/context/collector.js';
import {
  persistMarketObservations,
  fetchLatestPersistedObservations,
  fetchObservationByVintageId,
  clearPersistenceStore
} from '../src/context/repository.js';
import {
  normalizeCanonicalArticle,
  calculateArticleContentHash
} from '../src/news/contract.js';
import {
  applyNewsFreshness
} from '../src/news/repository.js';
import {
  buildMarketStrategistFactPacket,
  computeStrategistFingerprint,
  computeEvidenceDataAsOf,
  generateMarketStrategist,
  generateDeterministicMarketStrategist,
  MarketStrategistRuntime,
  STRATEGIST_SELECTION_POLICY_VERSION
} from '../src/ai/marketStrategistEngine.js';
import {
  validateMarketStrategistOutput
} from '../src/ai/marketStrategistValidation.js';
import {
  persistRunManifest,
  fetchRunManifest,
  clearManifestStore
} from '../src/ai/marketStrategistManifest.js';
import {
  STRATEGIST_MODEL,
  STRATEGIST_PROMPT_VERSION,
  STRATEGIST_SCHEMA_VERSION
} from '../src/ai/marketStrategistPrompt.js';

test('V1.2 Improvement 05B — Evidence Versioning & Reproducibility (Astra Regression Suite)', async (t) => {

  t.beforeEach(() => {
    clearPersistenceStore();
    clearManifestStore();
  });

  await t.test('1. Canonical Observation Identity — Same Vintage Invariant', () => {
    const payload1 = {
      factId: 'vn.macro.cpi.yoy',
      value: 4.89,
      unit: '%',
      unitType: UNIT_TYPES.PERCENT,
      change: 0.12,
      referenceTime: '2026-08',
      sourceId: 'NSO',
      revisionMarker: 'PRELIMINARY'
    };

    const payload2 = { ...payload1 };

    const hash1 = calculateSourceContentHash(payload1);
    const hash2 = calculateSourceContentHash(payload2);
    assert.equal(hash1, hash2);

    const id1 = buildObservationId({
      factId: payload1.factId,
      referenceTime: payload1.referenceTime,
      revision: payload1.revisionMarker,
      contentHash: hash1
    });

    const id2 = buildObservationId({
      factId: payload2.factId,
      referenceTime: payload2.referenceTime,
      revision: payload2.revisionMarker,
      contentHash: hash2
    });

    assert.equal(id1, id2);
  });

  await t.test('2. Canonical Observation Identity — Corrected Value Produces New ID', () => {
    const obs1 = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.80,
      unit: '%',
      referenceTime: '2026-08',
      revisionMarker: 'PRELIMINARY'
    });

    const obs2 = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.89, // corrected value
      unit: '%',
      referenceTime: '2026-08',
      revisionMarker: 'PRELIMINARY'
    });

    assert.notEqual(obs1.sourceContentHash, obs2.sourceContentHash);
    assert.notEqual(obs1.observationId, obs2.observationId);
  });

  await t.test('3. Canonical Observation Identity — Material Semantics (Volume, ChangeBasis, QuoteDirection)', () => {
    const base = {
      factId: 'vn.market.vnindex.close',
      pillar: PILLARS.MARKET,
      value: 1850.5,
      unit: 'điểm',
      referenceTime: '2026-09-04',
      volume: 800000000,
      quoteDirection: null,
      changeBasis: 'PREVIOUS_CLOSE'
    };

    const obsBase = createMarketObservation(base);

    // Corrected volume
    const obsDiffVol = createMarketObservation({
      ...base,
      volume: 850000000
    });
    assert.notEqual(obsBase.observationId, obsDiffVol.observationId);

    // Corrected changeBasis
    const obsDiffBasis = createMarketObservation({
      ...base,
      changeBasis: 'INTRADAY_OPEN'
    });
    assert.notEqual(obsBase.observationId, obsDiffBasis.observationId);

    // Corrected quoteDirection
    const obsDiffQuote = createMarketObservation({
      ...base,
      quoteDirection: 'VND_PER_USD'
    });
    assert.notEqual(obsBase.observationId, obsDiffQuote.observationId);
  });

  await t.test('4. Observation Identity — Old Revision Queryable alongside New Revision', async () => {
    const preliminary = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.80,
      unit: '%',
      referenceTime: '2026-08',
      publishedAt: '2026-09-01T02:00:00.000Z',
      revisionMarker: 'PRELIMINARY'
    });

    const revised = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.89,
      unit: '%',
      referenceTime: '2026-08',
      publishedAt: '2026-09-05T02:00:00.000Z',
      revisionMarker: 'REVISED'
    });

    await persistMarketObservations([preliminary], null);
    await persistMarketObservations([revised], null);

    const oldRecord = await fetchObservationByVintageId(preliminary.observationId, null);
    assert.ok(oldRecord);
    assert.equal(oldRecord.value, 4.80);
    assert.equal(oldRecord.revisionMarker, 'PRELIMINARY');

    const newRecord = await fetchObservationByVintageId(revised.observationId, null);
    assert.ok(newRecord);
    assert.equal(newRecord.value, 4.89);
    assert.equal(newRecord.revisionMarker, 'REVISED');
  });

  await t.test('5. Latest Selector — Reference Period Precedence over Revision Publication Time', () => {
    // September CPI published in September
    const cpiSeptember = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.50,
      unit: '%',
      referenceTime: '2026-09',
      publishedAt: '2026-09-29T02:00:00.000Z'
    });

    // August CPI revised and published in October (later publication date!)
    const cpiAugustRevised = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.89,
      unit: '%',
      referenceTime: '2026-08',
      publishedAt: '2026-10-05T02:00:00.000Z',
      revisionMarker: 'REVISED'
    });

    // September period must win over August period revised later
    const cmp = compareObservationVintages(cpiSeptember, cpiAugustRevised);
    assert.ok(cmp < 0, 'September reference period must take precedence over older August period');

    const selected = selectLatestObservationPerFact([cpiAugustRevised, cpiSeptember]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].referenceTime, '2026-09');
    assert.equal(selected[0].value, 4.50);
  });

  await t.test('6. Latest Selector — Latest Revision within Same Reference Period', () => {
    const preliminary = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.80,
      unit: '%',
      referenceTime: '2026-08',
      publishedAt: '2026-09-01T02:00:00.000Z',
      revisionMarker: 'PRELIMINARY'
    });

    const revised = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.89,
      unit: '%',
      referenceTime: '2026-08',
      publishedAt: '2026-09-10T02:00:00.000Z',
      revisionMarker: 'REVISED'
    });

    const selected = selectLatestObservationPerFact([preliminary, revised]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].value, 4.89);
    assert.equal(selected[0].revisionMarker, 'REVISED');
  });

  await t.test('7. Latest Selector — Daily Session Precedence', () => {
    const thursday = createMarketObservation({
      factId: 'vn.market.vnindex.close',
      pillar: PILLARS.MARKET,
      value: 1840.2,
      unit: 'điểm',
      referenceTime: '2026-09-03',
      observedAt: '2026-09-03T08:00:00.000Z'
    });

    const friday = createMarketObservation({
      factId: 'vn.market.vnindex.close',
      pillar: PILLARS.MARKET,
      value: 1853.08,
      unit: 'điểm',
      referenceTime: '2026-09-04',
      observedAt: '2026-09-04T08:00:00.000Z'
    });

    const selected = selectLatestObservationPerFact([thursday, friday]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].referenceTime, '2026-09-04');
    assert.equal(selected[0].value, 1853.08);
  });

  await t.test('8. Cross-Pillar LKG Isolation — Scoped Macro Merge', () => {
    const lkgMacro = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.89,
      unit: '%'
    });

    const lkgMonetary = createMarketObservation({
      factId: 'vn.monetary.rate.vnd_overnight',
      pillar: PILLARS.MONETARY,
      value: 4.15,
      unit: '%'
    });

    const lkgMarket = createMarketObservation({
      factId: 'vn.market.vnindex.close',
      pillar: PILLARS.MARKET,
      value: 1853.08,
      unit: 'điểm'
    });

    const fullLkg = [lkgMacro, lkgMonetary, lkgMarket];

    // Simulate Macro provider failure: returns empty list
    const mergedMacro = mergeWithLastKnownGood([], fullLkg, new Date(), PILLARS.MACRO);

    // Merged macro must ONLY contain macro items; must not cross-import monetary or market
    assert.equal(mergedMacro.length, 1);
    assert.equal(mergedMacro[0].factId, 'vn.macro.cpi.yoy');
    assert.equal(mergedMacro[0].pillar, PILLARS.MACRO);
  });

  await t.test('9. Cross-Pillar LKG Isolation — Scoped Monetary Merge', () => {
    const lkgMacro = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.89,
      unit: '%'
    });

    const lkgMonetary = createMarketObservation({
      factId: 'vn.monetary.rate.vnd_overnight',
      pillar: PILLARS.MONETARY,
      value: 4.15,
      unit: '%'
    });

    const fullLkg = [lkgMacro, lkgMonetary];

    // Simulate Monetary provider failure
    const mergedMonetary = mergeWithLastKnownGood([], fullLkg, new Date(), PILLARS.MONETARY);

    assert.equal(mergedMonetary.length, 1);
    assert.equal(mergedMonetary[0].factId, 'vn.monetary.rate.vnd_overnight');
    assert.equal(mergedMonetary[0].pillar, PILLARS.MONETARY);
  });

  await t.test('10. Source Time Semantics — Missing Timestamps Never Synthesized', () => {
    const obsWithoutTime = createMarketObservation({
      factId: 'global.intermarket.dxy.quote',
      pillar: PILLARS.INTERMARKET,
      value: 104.2,
      unit: 'điểm',
      referenceTime: null,
      observedAt: null,
      publishedAt: null,
      fetchedAt: '2026-09-05T12:00:00.000Z'
    });

    assert.equal(obsWithoutTime.referenceTime, null);
    assert.equal(obsWithoutTime.observedAt, null);
    assert.equal(obsWithoutTime.publishedAt, null);
    assert.equal(obsWithoutTime.fetchedAt, '2026-09-05T12:00:00.000Z');
  });

  await t.test('11. Metric Cadence Freshness — Weekly Monetary Cadence (14 Days)', () => {
    const sbvWeekly = createMarketObservation({
      factId: 'vn.monetary.rate.vnd_overnight',
      pillar: PILLARS.MONETARY,
      value: 4.15,
      unit: '%',
      referenceTime: '2026-08-24' // Monday of reference week
    });

    // Day 10 (within 14 days) -> fresh
    const evalDay10 = evaluateObservationFreshness(sbvWeekly, new Date('2026-09-03T10:00:00.000Z'));
    assert.equal(evalDay10.freshness, 'fresh');
    assert.equal(evalDay10.isStale, false);

    // Day 15 (> 14 days) -> stale
    const evalDay15 = evaluateObservationFreshness(sbvWeekly, new Date('2026-09-08T10:00:00.000Z'));
    assert.equal(evalDay15.freshness, 'stale');
    assert.equal(evalDay15.isStale, true);
  });

  await t.test('12. News Freshness — Publication Age vs Fetch Age', () => {
    const now = new Date('2026-09-05T12:00:00.000Z');

    // Fresh article published 30 minutes ago
    const freshArticle = normalizeCanonicalArticle({
      sourceId: 'cafef',
      title: 'Thị trường tài chính khởi sắc phiên cuối tuần',
      url: 'https://cafef.vn/tin-moi-1.chn',
      publishedAt: '2026-09-05T11:30:00.000Z',
      fetchedAt: '2026-09-05T11:55:00.000Z'
    });

    const evaluatedFresh = applyNewsFreshness(freshArticle, now);
    assert.equal(evaluatedFresh.freshness, 'fresh');

    // Stale article published 3 days ago, but fetched 5 minutes ago!
    const oldArticleFetchedRecently = normalizeCanonicalArticle({
      sourceId: 'cafef',
      title: 'Bản tin kinh tế tuần trước',
      url: 'https://cafef.vn/tin-tuan-truoc.chn',
      publishedAt: '2026-09-02T10:00:00.000Z', // 3 days ago
      fetchedAt: '2026-09-05T11:55:00.000Z'    // 5 minutes ago
    });

    // Publication age evaluation must mark it stale
    const evaluatedStale = applyNewsFreshness(oldArticleFetchedRecently, now);
    assert.equal(evaluatedStale.freshness, 'stale');
    assert.equal(evaluatedStale.status, 'stale');
  });

  await t.test('13. News Versioning & Content Hash', () => {
    const rawArticle = {
      sourceId: 'cafef',
      title: 'Ngân hàng Nhà nước duy trì điều hành linh hoạt',
      excerpt: 'Thanh khoản hệ thống được hỗ trợ duy trì ổn định qua kênh OMO.',
      url: 'https://cafef.vn/sbv-om-1.chn',
      publishedAt: '2026-09-04T10:00:00.000Z'
    };

    const articleV1 = normalizeCanonicalArticle(rawArticle, { fetchedAt: '2026-09-04T10:05:00.000Z' });
    assert.ok(articleV1.versionId.startsWith(`${articleV1.articleId}:v_`));

    // Corrected article content
    const rawArticleV2 = {
      ...rawArticle,
      excerpt: 'Thanh khoản hệ thống được hỗ trợ duy trì ổn định, lãi suất liên ngân hàng hạ nhiệt.'
    };

    const articleV2 = normalizeCanonicalArticle(rawArticleV2, { fetchedAt: '2026-09-04T10:30:00.000Z' });
    assert.equal(articleV1.articleId, articleV2.articleId); // same canonical article
    assert.notEqual(articleV1.versionId, articleV2.versionId); // different content version!
  });

  await t.test('14. Exact Scope Citation — Excluded / Superseded Article Versions', () => {
    const articleV1 = normalizeCanonicalArticle({
      sourceId: 'cafef',
      title: 'Bản tin kinh tế 1',
      excerpt: 'Tóm tắt ban đầu',
      url: 'https://cafef.vn/tin-1.chn',
      publishedAt: '2026-09-04T10:00:00.000Z'
    }, { fetchedAt: '2026-09-04T10:05:00.000Z' });

    const articleV2 = normalizeCanonicalArticle({
      sourceId: 'cafef',
      title: 'Bản tin kinh tế 1',
      excerpt: 'Tóm tắt đính chính sửa đổi bổ sung',
      url: 'https://cafef.vn/tin-1.chn',
      publishedAt: '2026-09-04T10:00:00.000Z'
    }, { fetchedAt: '2026-09-04T10:30:00.000Z' });

    // Fact packet built with active version V2
    const packet = buildMarketStrategistFactPacket({
      marketObservations: [
        createMarketObservation({ factId: 'vn.market.vnindex.close', pillar: PILLARS.MARKET, value: 1850, unit: 'điểm' })
      ],
      newsArticles: [articleV2],
      now: new Date('2026-09-05T08:00:00.000Z')
    });

    const candidate = generateDeterministicMarketStrategist({ factPacket: packet, now: new Date() });

    // Citing active V2 passes
    candidate.citations.articleIds = [articleV2.versionId];
    const validCheck = validateMarketStrategistOutput(candidate, packet);
    assert.equal(validCheck.valid, true);

    // Citing superseded V1 is rejected
    candidate.citations.articleIds = [articleV1.versionId];
    const invalidCheck = validateMarketStrategistOutput(candidate, packet);
    assert.equal(invalidCheck.valid, false);
    assert.ok(invalidCheck.errors.some((e) => e.includes(`UNKNOWN_ARTICLE_CITATION_${articleV1.versionId}`)));
  });

  await t.test('15. Strategist Cache Fingerprint — Sensitivity to Decision-Relevant Inputs', () => {
    const baseObs = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.89,
      unit: '%',
      referenceTime: '2026-08'
    });

    const baseNews = normalizeCanonicalArticle({
      sourceId: 'cafef',
      title: 'Bản tin sáng',
      excerpt: 'Nội dung thị trường',
      url: 'https://cafef.vn/news-1.chn',
      publishedAt: '2026-09-04T08:00:00.000Z'
    }, { fetchedAt: '2026-09-04T08:05:00.000Z' });

    const packet1 = buildMarketStrategistFactPacket({
      marketObservations: [baseObs],
      newsArticles: [baseNews]
    });

    const fp1 = computeStrategistFingerprint(packet1);

    // 1. Observation status/freshness change invalidates fingerprint
    const staleObs = { ...baseObs, status: 'stale', freshness: 'stale' };
    const packetStale = buildMarketStrategistFactPacket({
      marketObservations: [staleObs],
      newsArticles: [baseNews]
    });
    const fpStale = computeStrategistFingerprint(packetStale);
    assert.notEqual(fp1, fpStale);

    // 2. Article version change invalidates fingerprint
    const updatedNews = normalizeCanonicalArticle({
      sourceId: 'cafef',
      title: 'Bản tin sáng',
      excerpt: 'Nội dung thị trường đã cập nhật sửa đổi',
      url: 'https://cafef.vn/news-1.chn',
      publishedAt: '2026-09-04T08:00:00.000Z'
    }, { fetchedAt: '2026-09-04T08:30:00.000Z' });

    const packetUpdatedNews = buildMarketStrategistFactPacket({
      marketObservations: [baseObs],
      newsArticles: [updatedNews]
    });
    const fpNews = computeStrategistFingerprint(packetUpdatedNews);
    assert.notEqual(fp1, fpNews);
  });

  await t.test('16. Strategist Cache Fingerprint — Stability Across Volatile Request Times', () => {
    const baseObs = createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      value: 4.89,
      unit: '%',
      referenceTime: '2026-08',
      observedAt: '2026-09-01T08:00:00.000Z'
    });

    const timeA = new Date('2026-09-05T10:00:00.000Z');
    const timeB = new Date('2026-09-05T14:30:00.000Z');

    const packetA = buildMarketStrategistFactPacket({
      marketObservations: [baseObs],
      newsArticles: [],
      now: timeA
    });

    const packetB = buildMarketStrategistFactPacket({
      marketObservations: [baseObs],
      newsArticles: [],
      now: timeB
    });

    const fpA = computeStrategistFingerprint(packetA);
    const fpB = computeStrategistFingerprint(packetB);

    assert.equal(fpA, fpB, 'Fingerprint must be stable when underlying evidence is unchanged');
  });

  await t.test('17. Run Manifest & Truthful dataAsOf — Zero Private Data & Historical Timestamp', async () => {
    const obsTime = '2026-09-04T15:00:00.000Z';
    const obs = createMarketObservation({
      factId: 'vn.market.vnindex.close',
      pillar: PILLARS.MARKET,
      value: 1853.08,
      unit: 'điểm',
      referenceTime: '2026-09-04',
      observedAt: obsTime
    });

    const requestTime = new Date('2026-09-05T09:00:00.000Z');

    const packet = buildMarketStrategistFactPacket({
      marketObservations: [obs],
      newsArticles: [],
      now: requestTime
    });

    // dataAsOf must reflect evidence observation time, not requestTime
    assert.equal(packet.dataAsOf, obsTime);

    const runtime = new MarketStrategistRuntime();
    const result = await generateMarketStrategist({
      factPacket: packet,
      now: requestTime,
      allowLlm: false,
      runtime
    });

    assert.ok(result.runId);
    assert.equal(result.dataAsOf, obsTime);

    // Fetch persisted manifest
    const manifest = await fetchRunManifest(result.runId, null);
    assert.ok(manifest);
    assert.equal(manifest.dataAsOf, obsTime);
    assert.equal(manifest.model, 'deterministic_fallback');
    assert.equal(manifest.promptVersion, STRATEGIST_PROMPT_VERSION);
    assert.equal(manifest.schemaVersion, STRATEGIST_SCHEMA_VERSION);
    assert.equal(manifest.selectionPolicyVersion, STRATEGIST_SELECTION_POLICY_VERSION);

    // Strict zero private data test
    await assert.rejects(async () => {
      await persistRunManifest({
        runId: 'bad_run',
        packetFingerprint: 'abc',
        userId: 'usr_secret_123'
      }, null);
    }, /FORBIDDEN_USER_DATA/);
  });

});
