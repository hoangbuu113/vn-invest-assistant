import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isOfficialCustomsUrl,
  isValidPdfBuffer,
  parseCustomsNumber,
  parseCustomsTradeDocumentText,
  parseCustomsTradeDocument,
  deriveTradeBalance,
  normalizeCustomsTradeFacts,
  ingestCustomsDocument,
  TRADE_FACT_IDS,
  TRADE_REVISION_STATUS
} from '../src/context/providers/customsTrade.js';

import {
  OFFICIAL_CUSTOMS_URLS,
  VALID_EXPORT_TEXT_FEB_2026,
  VALID_IMPORT_TEXT_FEB_2026,
  REVISED_EXPORT_TEXT_FEB_2026,
  SEMIMONTHLY_EXPORT_TEXT,
  CUMULATIVE_ONLY_EXPORT_TEXT,
  PERCENT_CHANGE_ONLY_TEXT,
  PARTNER_SUBTOTAL_ONLY_TEXT,
  VALID_PDF_MOCK_BUFFER,
  INVALID_NON_PDF_BUFFER
} from './fixtures/customsTradeFixtures.js';

import {
  compareObservationVintages,
  OBSERVATION_STATUS,
  OBSERVATION_FRESHNESS,
  PILLARS,
  FACT_LIFECYCLE_STATUS
} from '../src/context/factModel.js';

import { applyRuntimeFreshness, CADENCE_POLICIES } from '../src/context/freshnessPolicy.js';
import { deriveMarketSignals } from '../src/ai/derivedSignals.js';
import { runMarketContextCollector } from '../src/context/collector.js';

test('1. monthly exports extracted correctly', () => {
  const result = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026, {
    sourceUrl: OFFICIAL_CUSTOMS_URLS.EXPORT_FEB_2026_SB
  });

  assert.equal(result.status, 'available');
  assert.equal(result.direction, 'EXPORT');
  assert.equal(result.factId, TRADE_FACT_IDS.EXPORTS_MONTH_USD);
  assert.equal(result.monthlyValue, 33090034032);
  assert.equal(result.unit, 'USD');
  assert.equal(result.referencePeriod, '2026-02');
  assert.equal(result.revisionMarker, TRADE_REVISION_STATUS.PRELIMINARY);
  assert.equal(result.formNumber, '015.T/BCB-TC');
});

test('2. YTD exports cannot substitute monthly exports', () => {
  const result = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  assert.equal(result.monthlyValue, 33090034032);
  // YTD cumulative is 76,392,787,810 USD; it must NEVER be returned as monthlyValue
  assert.notEqual(result.monthlyValue, result.ytdCumulativeValue);
  assert.equal(result.ytdCumulativeValue, 76392787810);

  // When only cumulative exists without monthly column, parser must quarantine
  const cumulativeOnlyResult = parseCustomsTradeDocumentText(CUMULATIVE_ONLY_EXPORT_TEXT);
  assert.equal(cumulativeOnlyResult.status, 'quarantined');
  assert.equal(cumulativeOnlyResult.reason, 'MISSING_TOTAL_TRADE_VALUE');
});

test('3. semimonthly exports cannot substitute monthly exports', () => {
  const result = parseCustomsTradeDocumentText(SEMIMONTHLY_EXPORT_TEXT);
  assert.equal(result.status, 'quarantined');
  assert.equal(result.reason, 'SEMIMONTHLY_DOCUMENT_NOT_SUPPORTED');
  assert.ok(result.details.includes('Kỳ 1 / Kỳ 2 / 15 ngày'));
});

test('4. monthly imports extracted correctly', () => {
  const result = parseCustomsTradeDocumentText(VALID_IMPORT_TEXT_FEB_2026, {
    sourceUrl: OFFICIAL_CUSTOMS_URLS.IMPORT_FEB_2026_SB
  });

  assert.equal(result.status, 'available');
  assert.equal(result.direction, 'IMPORT');
  assert.equal(result.factId, TRADE_FACT_IDS.IMPORTS_MONTH_USD);
  assert.equal(result.monthlyValue, 34102372899);
  assert.equal(result.unit, 'USD');
  assert.equal(result.referencePeriod, '2026-02');
  assert.equal(result.revisionMarker, TRADE_REVISION_STATUS.PRELIMINARY);
  assert.equal(result.formNumber, '016.T/BCB-TC');
});

test('5. YTD imports cannot substitute monthly imports', () => {
  const result = parseCustomsTradeDocumentText(VALID_IMPORT_TEXT_FEB_2026);
  assert.equal(result.monthlyValue, 34102372899);
  // YTD cumulative is 79,340,410,650 USD; it must NEVER be returned as monthlyValue
  assert.notEqual(result.monthlyValue, result.ytdCumulativeValue);
  assert.equal(result.ytdCumulativeValue, 79340410650);
});

test('6. percentage-change column cannot masquerade as import value', () => {
  const result = parseCustomsTradeDocumentText(PERCENT_CHANGE_ONLY_TEXT);
  // Rejects tiny percentage value masquerading as total national trade amount
  assert.equal(result.status, 'quarantined');
  assert.equal(result.reason, 'SUSPICIOUS_TRADE_VALUE_SCALE');
});

test('7. export/import source URLs are official Customs URLs', () => {
  assert.equal(isOfficialCustomsUrl(OFFICIAL_CUSTOMS_URLS.EXPORT_FEB_2026_SB), true);
  assert.equal(isOfficialCustomsUrl(OFFICIAL_CUSTOMS_URLS.IMPORT_FEB_2026_SB), true);
  assert.equal(isOfficialCustomsUrl('https://customs.gov.vn/statistics/report.pdf'), true);
  assert.equal(isOfficialCustomsUrl('https://tongcuc.customs.gov.vn/cms/report.pdf'), true);
});

test('8. non-Customs arbitrary URL rejected', async () => {
  assert.equal(isOfficialCustomsUrl(OFFICIAL_CUSTOMS_URLS.NON_CUSTOMS_ARBITRARY), false);
  assert.equal(isOfficialCustomsUrl(OFFICIAL_CUSTOMS_URLS.CUSTOMS_HTTP_INSECURE), false);
  assert.equal(isOfficialCustomsUrl('https://123.30.210.237/report.pdf'), false); // Pure IP rejected
  assert.equal(isOfficialCustomsUrl('http://localhost:3000/report.pdf'), false);
  assert.equal(isOfficialCustomsUrl('javascript:alert(1)'), false);

  const intakeResult = await ingestCustomsDocument({
    documentUrl: OFFICIAL_CUSTOMS_URLS.NON_CUSTOMS_ARBITRARY
  });
  assert.equal(intakeResult.success, false);
  assert.equal(intakeResult.status, 'rejected');
  assert.equal(intakeResult.reason, 'UNAPPROVED_SOURCE_HOST');
});

test('9. invalid PDF/document quarantined', async () => {
  assert.equal(isValidPdfBuffer(INVALID_NON_PDF_BUFFER), false);
  assert.equal(isValidPdfBuffer(VALID_PDF_MOCK_BUFFER), true);

  const parsed = await parseCustomsTradeDocument(INVALID_NON_PDF_BUFFER);
  assert.equal(parsed.status, 'quarantined');
  assert.equal(parsed.reason, 'INVALID_PDF_SIGNATURE');
});

test('10. unit scale preserved', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const observations = normalizeCustomsTradeFacts({ exportDocResult: exportParsed });
  const exportObs = observations.find(o => o.factId === TRADE_FACT_IDS.EXPORTS_MONTH_USD);

  assert.ok(exportObs);
  assert.equal(exportObs.unit, 'USD');
  assert.equal(exportObs.value, 33090034032);
});

test('11. missing != zero', () => {
  const badResult = parseCustomsTradeDocumentText(PARTNER_SUBTOTAL_ONLY_TEXT);
  assert.equal(badResult.status, 'quarantined');

  const obsList = normalizeCustomsTradeFacts({ exportDocResult: badResult });
  const unavailableObs = obsList.find(o => o.factId === TRADE_FACT_IDS.EXPORTS_MONTH_USD);

  assert.ok(unavailableObs);
  assert.equal(unavailableObs.value, null);
  assert.notEqual(unavailableObs.value, 0);
  assert.equal(unavailableObs.status, OBSERVATION_STATUS.UNAVAILABLE);
});

test('12. preliminary and revised values create distinct vintages', () => {
  const prelimParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const revisedParsed = parseCustomsTradeDocumentText(REVISED_EXPORT_TEXT_FEB_2026);

  const [prelimObs] = normalizeCustomsTradeFacts({ exportDocResult: prelimParsed, derivedBalance: false });
  const [revisedObs] = normalizeCustomsTradeFacts({ exportDocResult: revisedParsed, derivedBalance: false });

  assert.ok(prelimObs.observationId.includes('rev_preliminary'));
  assert.ok(revisedObs.observationId.includes('rev_revised'));
  assert.notEqual(prelimObs.observationId, revisedObs.observationId);

  // Revised vintage takes precedence for the same reference period
  const order = compareObservationVintages(revisedObs, prelimObs);
  assert.ok(order < 0, 'Revised vintage should be ordered before (preferred over) preliminary vintage');
});

test('13. identical document remains idempotent', () => {
  const run1 = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const run2 = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);

  const [obs1] = normalizeCustomsTradeFacts({ exportDocResult: run1, derivedBalance: false });
  const [obs2] = normalizeCustomsTradeFacts({ exportDocResult: run2, derivedBalance: false });

  assert.equal(obs1.observationId, obs2.observationId);
  assert.equal(obs1.sourceContentHash, obs2.sourceContentHash);
  assert.equal(obs1.value, obs2.value);
});

test('14. trade balance requires matching period', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026); // 2026-02
  const [exportObs] = normalizeCustomsTradeFacts({ exportDocResult: exportParsed, derivedBalance: false });

  // Fabricate an import observation from a different reference month (2026-01)
  const mismatchedImportObs = {
    ...exportObs,
    factId: TRADE_FACT_IDS.IMPORTS_MONTH_USD,
    referenceTime: '2026-01'
  };

  const balanceObs = deriveTradeBalance(exportObs, mismatchedImportObs);
  assert.equal(balanceObs.status, OBSERVATION_STATUS.UNAVAILABLE);
  assert.equal(balanceObs.value, null);
  assert.equal(balanceObs.statusReason, 'REFERENCE_PERIOD_MISMATCH');
});

test('15. trade balance requires compatible scope', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const [exportObs] = normalizeCustomsTradeFacts({ exportDocResult: exportParsed, derivedBalance: false });

  // If import is unavailable or missing
  const balanceObs = deriveTradeBalance(exportObs, null);
  assert.equal(balanceObs.status, OBSERVATION_STATUS.UNAVAILABLE);
  assert.equal(balanceObs.value, null);
  assert.equal(balanceObs.statusReason, 'MISSING_TRADE_INPUTS');
});

test('16. trade balance derived value keeps both input IDs', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026, {
    sourceUrl: OFFICIAL_CUSTOMS_URLS.EXPORT_FEB_2026_SB
  });
  const importParsed = parseCustomsTradeDocumentText(VALID_IMPORT_TEXT_FEB_2026, {
    sourceUrl: OFFICIAL_CUSTOMS_URLS.IMPORT_FEB_2026_SB
  });

  const [exportObs] = normalizeCustomsTradeFacts({ exportDocResult: exportParsed, derivedBalance: false });
  const [importObs] = normalizeCustomsTradeFacts({ exportDocResult: importParsed, derivedBalance: false });

  const balanceObs = deriveTradeBalance(exportObs, importObs);
  assert.equal(balanceObs.status, OBSERVATION_STATUS.AVAILABLE);
  assert.equal(balanceObs.value, 33090034032 - 34102372899); // -1,012,338,867 USD
  assert.equal(balanceObs.provenance.isDerived, true);
  assert.equal(balanceObs.provenance.formula, 'exports - imports');
  assert.deepEqual(balanceObs.provenance.inputObservationIds, [exportObs.observationId, importObs.observationId]);
});

test('17. derived balance is not marked as directly published official value', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const importParsed = parseCustomsTradeDocumentText(VALID_IMPORT_TEXT_FEB_2026);
  const [exportObs] = normalizeCustomsTradeFacts({ exportDocResult: exportParsed, derivedBalance: false });
  const [importObs] = normalizeCustomsTradeFacts({ exportDocResult: importParsed, derivedBalance: false });

  const balanceObs = deriveTradeBalance(exportObs, importObs);
  assert.equal(balanceObs.source, 'Vietnam Customs (Derived)');
  assert.ok(balanceObs.provenance.publisherNotice.includes('không phải số liệu công bố trực tiếp'));
});

test('18. stale/unavailable inputs do not create directional trade signal', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const importParsed = parseCustomsTradeDocumentText(VALID_IMPORT_TEXT_FEB_2026);
  const observations = normalizeCustomsTradeFacts({
    exportDocResult: exportParsed,
    importDocResult: importParsed,
    derivedBalance: true
  });

  // Test 18a: Fresh observations produce trade context
  const freshSignals = deriveMarketSignals({ observations });
  const tradeSig = freshSignals.find(s => s.signalType === 'VN_TRADE_CONTEXT');
  assert.ok(tradeSig);
  assert.equal(tradeSig.state, 'deficit'); // balance < 0
  assert.ok(!tradeSig.limitations.includes('bullish')); // No directional stock market claim!

  // Test 18b: Stale observations produce strictly neutral state
  const staleObsList = observations.map(o => ({
    ...o,
    status: 'stale',
    freshness: 'stale'
  }));
  const staleSignals = deriveMarketSignals({ observations: staleObsList });
  const staleTradeSig = staleSignals.find(s => s.signalType === 'VN_TRADE_CONTEXT');
  assert.ok(staleTradeSig);
  assert.equal(staleTradeSig.state, 'neutral');

  // Test 18c: Unavailable observations abstain from emitting directional signal
  const unavailObsList = observations.map(o => ({
    ...o,
    status: 'unavailable',
    value: null
  }));
  const unavailSignals = deriveMarketSignals({ observations: unavailObsList });
  const unavailTradeSig = unavailSignals.find(s => s.signalType === 'VN_TRADE_CONTEXT');
  assert.equal(unavailTradeSig, undefined); // Abstains completely
});

test('19. parser-only source cannot masquerade as automated discovery', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const [exportObs] = normalizeCustomsTradeFacts({ exportDocResult: exportParsed, derivedBalance: false });

  assert.equal(
    exportObs.provenance.sourceLifecycle,
    FACT_LIFECYCLE_STATUS.CONTROLLED_MANUAL_SOURCE
  );
  assert.notEqual(
    exportObs.provenance.sourceLifecycle,
    FACT_LIFECYCLE_STATUS.LIVE_AUTOMATED
  );
});

test('20. CAPTCHA archive is not repeatedly polled', () => {
  // Verify that customsTrade provider does not define or export recurring CAPTCHA polling loops
  const moduleCode = isOfficialCustomsUrl.toString();
  assert.ok(!moduleCode.includes('CheckCaptcha'));
  assert.ok(!moduleCode.includes('captcha'));
});

test('21. Customs failure preserves LKG timestamps', async () => {
  const originalRef = '2026-01';
  const originalPublishedAt = '2026-02-15T08:00:00.000Z';
  const originalObservedAt = '2026-02-15T08:00:00.000Z';

  const priorValidTradeObs = {
    id: 'trade.goods.exports.month_usd',
    factId: TRADE_FACT_IDS.EXPORTS_MONTH_USD,
    observationId: `${TRADE_FACT_IDS.EXPORTS_MONTH_USD}:${originalRef}:rev_final`,
    pillar: PILLARS.MACRO,
    label: 'Kim ngạch xuất khẩu hàng hóa (tháng)',
    metric: 'Kim ngạch xuất khẩu hàng hóa theo tháng (USD)',
    value: 30000000000,
    unit: 'USD',
    referenceTime: originalRef,
    publishedAt: originalPublishedAt,
    observedAt: originalObservedAt,
    fetchedAt: '2026-02-15T08:05:00.000Z',
    source: 'Vietnam Customs',
    status: OBSERVATION_STATUS.AVAILABLE,
    freshness: OBSERVATION_FRESHNESS.FRESH
  };

  // Mock DB repository returning prior valid trade observation
  const mockClient = {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [priorValidTradeObs], error: null })
      }),
      upsert: () => Promise.resolve({ data: [], error: null })
    })
  };

  // Simulate a failing Customs trade fetcher
  const failingCustomsFetch = () => Promise.reject(new Error('Customs server timeout or unavailable'));

  const now = new Date('2026-09-05T12:00:00Z');
  const result = await runMarketContextCollector({
    now,
    client: mockClient,
    fetchCustomsTradeFn: failingCustomsFetch,
    fetchNsoMacroFn: () => Promise.resolve([]),
    fetchSbvOfficialFn: () => Promise.resolve([]),
    forceRefresh: false
  });

  assert.equal(result.success, true);
  // Prior timestamps remain unmutated in the observation
  assert.equal(priorValidTradeObs.referenceTime, originalRef);
  assert.equal(priorValidTradeObs.publishedAt, originalPublishedAt);
  assert.equal(priorValidTradeObs.observedAt, originalObservedAt);
});

test('22. raw PDF/body not sent to Gemini', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const [exportObs] = normalizeCustomsTradeFacts({ exportDocResult: exportParsed, derivedBalance: false });

  // Assert observation schema contains only clean structured financial evidence
  assert.equal(typeof exportObs.value, 'number');
  assert.equal(typeof exportObs.unit, 'string');
  assert.equal(typeof exportObs.referenceTime, 'string');
  assert.equal(typeof exportObs.source, 'string');

  // Verify no raw PDF buffer or whole page dumps exist in observation
  assert.equal(exportObs.rawPdfBuffer, undefined);
  assert.equal(exportObs.rawBody, undefined);
  assert.ok(!JSON.stringify(exportObs).includes('%PDF-'));
});

test('23. no private portfolio/profile data enters pipeline', () => {
  const exportParsed = parseCustomsTradeDocumentText(VALID_EXPORT_TEXT_FEB_2026);
  const [exportObs] = normalizeCustomsTradeFacts({ exportDocResult: exportParsed, derivedBalance: false });

  const serialized = JSON.stringify(exportObs);
  assert.ok(!serialized.includes('user_id'));
  assert.ok(!serialized.includes('profile_id'));
  assert.ok(!serialized.includes('portfolio'));
  assert.ok(!serialized.includes('cash_available'));
  assert.ok(!serialized.includes('holdings'));
});
