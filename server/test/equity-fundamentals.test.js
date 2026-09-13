import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

import { createApp } from '../index.js';
import {
  buildFundamentalsResponse,
  createManualFundamentalFiling,
  FUNDAMENTALS_METRICS,
  getEquityFundamentals,
  ingestManualOfficialFundamentalFiling
} from '../src/equities/index.js';
import {
  clearFundamentalFilingMemory,
  fundamentalFactToRpc,
  fundamentalFilingToRpc,
  rowToFundamentalFiling
} from '../src/equities/fundamentalsRepository.js';
import {
  buildFundamentalsPeriodDisplay,
  formatFundamentalFact
} from '../../client/src/utils/fundamentalsDisplay.js';

const NOW = new Date('2026-09-13T03:00:00.000Z');
const FPT = Object.freeze({
  id: '34ad7d87-9065-4111-b38d-ebc92c4a74dd',
  symbol: 'FPT',
  name: 'FPT Corporation',
  assetType: 'stock',
  asset_type: 'stock',
  exchange: 'HOSE',
  marketCode: 'HOSE',
  market_code: 'HOSE',
  marketPolicy: 'VN_EXCHANGE',
  market_policy: 'VN_EXCHANGE',
  quoteCurrency: 'VND',
  fundamentalsCompanyType: 'INDUSTRIAL',
  fundamentals_company_type: 'INDUSTRIAL'
});

const METRIC_VALUES = Object.freeze({
  totalAssets: '248127000000000',
  totalLiabilities: '124000000000000',
  equity: '124127000000000',
  cashAndCashEquivalents: '27125000000000',
  netRevenue: '62500000000000',
  grossProfit: '24100000000000',
  profitBeforeTax: '11800000000000',
  netIncome: '10100000000000',
  parentShareholdersProfit: '9800000000000',
  operatingCashFlow: '0',
  investingCashFlow: '-5200000000000',
  financingCashFlow: '1800000000000'
});

function uuidFactory() {
  let next = 1;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}

function facts({ validationStatus = 'VERIFIED', overrides = {} } = {}) {
  return FUNDAMENTALS_METRICS.map((metricCode, index) => ({
    metricCode,
    sourceLineCode: String(100 + index),
    sourceLabel: `Official line ${metricCode}`,
    numericValue: METRIC_VALUES[metricCode],
    currencyCode: 'VND',
    unitScale: 1,
    sourcePage: index + 1,
    sourceSheet: null,
    sourceCell: null,
    valueKind: 'REPORTED',
    derivationFormula: null,
    confidence: 1,
    validationStatus,
    missingReason: null,
    ...(overrides[metricCode] || {})
  }));
}

function filingPayload(overrides = {}) {
  return {
    assetId: FPT.id,
    ticker: 'FPT',
    issuerLegalName: 'FPT Corporation',
    exchange: 'HOSE',
    companyType: 'INDUSTRIAL',
    sourceAuthority: 'HOSE',
    sourceUrl: 'https://www.hsx.vn/Modules/Cms/Web/ViewArticle/official-fpt-2025',
    sourceDisclosureId: 'FPT-2025-AFS',
    sourceTitle: 'Báo cáo tài chính hợp nhất năm 2025',
    publishedAt: '2026-03-30T02:00:00.000Z',
    sourceAvailableAt: '2026-03-30T02:05:00.000Z',
    fetchedAt: '2026-03-30T03:00:00.000Z',
    statementScope: 'CONSOLIDATED',
    auditStatus: 'AUDITED',
    accountingRegime: 'VAS',
    fiscalYear: 2025,
    fiscalQuarter: null,
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    periodKind: 'ANNUAL',
    revisionNumber: 1,
    supersedesFilingId: null,
    documentHash: 'a'.repeat(64),
    verificationStatus: 'VERIFIED',
    facts: facts(),
    ...overrides
  };
}

function companyAsset(companyType) {
  return {
    ...FPT,
    id: `${companyType === 'BANK' ? '1' : companyType === 'SECURITIES' ? '2' : '3'}4ad7d87-9065-4111-b38d-ebc92c4a74dd`,
    fundamentalsCompanyType: companyType,
    fundamentals_company_type: companyType
  };
}

async function start(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return server;
}

test('filing contract preserves decimal strings, explicit zero, explicit missing, and official provenance', () => {
  const payload = filingPayload({
    facts: facts({
      overrides: {
        totalAssets: { numericValue: '1234567890123456789012345678.125' },
        grossProfit: { numericValue: null, missingReason: 'Not separately disclosed' }
      }
    })
  });
  const filing = createManualFundamentalFiling(payload, { asset: FPT, now: NOW, idFactory: uuidFactory() });
  const totalAssets = filing.facts.find((fact) => fact.metricCode === 'totalAssets');
  const operatingCashFlow = filing.facts.find((fact) => fact.metricCode === 'operatingCashFlow');
  const grossProfit = filing.facts.find((fact) => fact.metricCode === 'grossProfit');

  assert.equal(totalAssets.numericValue, '1234567890123456789012345678.125');
  assert.equal(operatingCashFlow.numericValue, '0');
  assert.equal(grossProfit.numericValue, null);
  assert.equal(grossProfit.missingReason, 'Not separately disclosed');
  assert.equal(filing.sourceAuthority, 'HOSE');
  assert.equal(filing.sourceUrl.startsWith('https://www.hsx.vn/'), true);
  assert.equal(filing.firstSeenAt, NOW.toISOString());
  assert.equal(filing.systemKnowableAt, NOW.toISOString());
  assert.match(filing.identityHash, /^[0-9a-f]{64}$/);
});

test('filing validation rejects unsafe identity, source, period, currency, unit, and numeric input', () => {
  const build = (change) => () => createManualFundamentalFiling(
    filingPayload(change),
    { asset: FPT, now: NOW, idFactory: uuidFactory() }
  );
  assert.throws(build({ ticker: 'HPG' }), (error) => error.code === 'FUNDAMENTALS_ASSET_IDENTITY_MISMATCH');
  assert.throws(build({ sourceUrl: 'https://example.com/not-hose' }), (error) => error.code === 'INVALID_OFFICIAL_SOURCE_URL');
  assert.throws(build({ periodStart: '2026-01-01', periodEnd: '2025-12-31' }), /periodStart cannot follow periodEnd/);
  assert.throws(build({ sourceAvailableAt: '2026-09-14T00:00:00.000Z' }), /sourceAvailableAt cannot be in the future/);
  assert.throws(build({ fetchedAt: '2026-03-30T02:01:00.000Z' }), /fetchedAt cannot precede sourceAvailableAt/);
  assert.throws(build({ facts: facts({ overrides: { totalAssets: { currencyCode: '$' } } }) }), /uppercase currency code/);
  assert.throws(build({ facts: facts({ overrides: { totalAssets: { unitScale: 100 } } }) }), /unitScale must be one of/);
  assert.throws(build({ facts: facts({ overrides: { totalAssets: { numericValue: '1e12' } } }) }), /plain decimal/);
  assert.throws(build({ facts: facts({ overrides: { totalAssets: { numericValue: 1.1 } } }) }), /must be supplied as a decimal string/);
  assert.throws(build({ facts: facts({ overrides: { totalAssets: { numericValue: null, missingReason: null } } }) }), /missingReason is required/);
});

test('canonical company-type gate supports industrial issuers and truthfully rejects financial issuers or unclassified stocks', () => {
  for (const companyType of ['BANK', 'SECURITIES', 'INSURANCE']) {
    assert.throws(
      () => createManualFundamentalFiling(
        filingPayload({ assetId: companyAsset(companyType).id, companyType }),
        { asset: companyAsset(companyType), now: NOW, idFactory: uuidFactory() }
      ),
      (error) => error.code === 'UNSUPPORTED_COMPANY_TYPE'
    );
    const response = buildFundamentalsResponse(companyAsset(companyType), [], { asOf: NOW });
    assert.equal(response.availability, 'UNSUPPORTED_COMPANY_TYPE');
    assert.equal(response.supportedCompanyType, false);
  }
  const unclassified = { ...FPT, fundamentalsCompanyType: null, fundamentals_company_type: null };
  assert.throws(
    () => createManualFundamentalFiling(filingPayload(), { asset: unclassified, now: NOW, idFactory: uuidFactory() }),
    (error) => error.code === 'UNSUPPORTED_COMPANY_TYPE'
  );
});

test('annual and interim filings retain scope, audit status, provenance, and complete availability', async () => {
  clearFundamentalFilingMemory();
  const idFactory = uuidFactory();
  await ingestManualOfficialFundamentalFiling(filingPayload(), {
    client: null,
    now: new Date('2026-09-10T03:00:00.000Z'),
    getAssetByIdFn: async () => FPT,
    idFactory
  });
  await ingestManualOfficialFundamentalFiling(filingPayload({
    sourceUrl: 'https://www.hsx.vn/Modules/Cms/Web/ViewArticle/official-fpt-q2-2026',
    sourceDisclosureId: 'FPT-Q2-2026',
    sourceTitle: 'Báo cáo tài chính riêng quý 2 năm 2026',
    publishedAt: '2026-07-30T02:00:00.000Z',
    sourceAvailableAt: '2026-07-30T02:05:00.000Z',
    fetchedAt: '2026-07-30T03:00:00.000Z',
    statementScope: 'SEPARATE',
    auditStatus: 'UNAUDITED',
    fiscalYear: 2026,
    fiscalQuarter: 2,
    periodStart: '2026-04-01',
    periodEnd: '2026-06-30',
    periodKind: 'QUARTER',
    documentHash: 'b'.repeat(64)
  }), {
    client: null,
    now: new Date('2026-09-11T03:00:00.000Z'),
    getAssetByIdFn: async () => FPT,
    idFactory
  });

  const response = await getEquityFundamentals('fpt', {
    client: null,
    now: NOW,
    getAssetBySymbolFn: async () => FPT
  });
  assert.equal(response.availability, 'AVAILABLE');
  assert.equal(response.latestAnnual.periodKind, 'ANNUAL');
  assert.equal(response.latestAnnual.statementScope, 'CONSOLIDATED');
  assert.equal(response.latestAnnual.auditStatus, 'AUDITED');
  assert.equal(response.latestQuarter.periodKind, 'QUARTER');
  assert.equal(response.latestQuarter.statementScope, 'SEPARATE');
  assert.equal(response.latestQuarter.auditStatus, 'UNAUDITED');
  assert.equal(response.latestQuarter.source.authority, 'HOSE');
  assert.equal(response.latestQuarter.source.documentHash, 'b'.repeat(64));
  assert.equal(response.latestQuarter.facts.operatingCashFlow.numericValue, '0');
  assert.equal(response.latestQuarter.facts.operatingCashFlow.filingId, response.latestQuarter.filingId);
  assert.equal(response.historicalPeriods.length, 2);
});

test('corrections append an immutable revision and as-of reads do not see future-known corrections', async () => {
  clearFundamentalFilingMemory();
  const idFactory = uuidFactory();
  const original = await ingestManualOfficialFundamentalFiling(filingPayload(), {
    client: null,
    now: new Date('2026-09-10T03:00:00.000Z'),
    getAssetByIdFn: async () => FPT,
    idFactory
  });
  const correctedFacts = facts({ overrides: { netRevenue: { numericValue: '63000000000000' } } });
  const correction = await ingestManualOfficialFundamentalFiling(filingPayload({
    sourceUrl: 'https://www.hsx.vn/Modules/Cms/Web/ViewArticle/official-fpt-2025-corrected',
    sourceDisclosureId: 'FPT-2025-AFS-C1',
    sourceTitle: 'Báo cáo tài chính hợp nhất năm 2025 đính chính',
    publishedAt: '2026-09-11T01:00:00.000Z',
    sourceAvailableAt: '2026-09-11T01:05:00.000Z',
    fetchedAt: '2026-09-11T02:00:00.000Z',
    revisionNumber: 2,
    supersedesFilingId: original.filingId,
    documentHash: 'c'.repeat(64),
    facts: correctedFacts
  }), {
    client: null,
    now: new Date('2026-09-12T03:00:00.000Z'),
    getAssetByIdFn: async () => FPT,
    idFactory
  });

  const before = await getEquityFundamentals('FPT', {
    client: null,
    now: NOW,
    asOf: '2026-09-11T23:59:59.000Z',
    getAssetBySymbolFn: async () => FPT
  });
  const after = await getEquityFundamentals('FPT', {
    client: null,
    now: NOW,
    asOf: '2026-09-13T00:00:00.000Z',
    getAssetBySymbolFn: async () => FPT
  });
  assert.equal(before.latestAnnual.filingId, original.filingId);
  assert.equal(after.latestAnnual.filingId, correction.filingId);
  assert.equal(after.latestAnnual.facts.netRevenue.numericValue, '63000000000000');
  assert.equal(after.historicalPeriods.length, 2);
  assert.equal(after.historicalPeriods.find((period) => period.filingId === original.filingId).isSuperseded, true);
});

test('duplicate filings and competing correction branches are rejected replay-safely', async () => {
  clearFundamentalFilingMemory();
  const idFactory = uuidFactory();
  const originalPayload = filingPayload();
  const original = await ingestManualOfficialFundamentalFiling(originalPayload, {
    client: null, now: NOW, getAssetByIdFn: async () => FPT, idFactory
  });
  await assert.rejects(
    ingestManualOfficialFundamentalFiling(originalPayload, {
      client: null, now: NOW, getAssetByIdFn: async () => FPT, idFactory: uuidFactory()
    }),
    (error) => error.code === 'DUPLICATE_FUNDAMENTALS_FILING' && error.status === 409
  );

  const correction = filingPayload({
    sourceUrl: 'https://www.hsx.vn/correction-1',
    sourceDisclosureId: 'FPT-C1',
    sourceTitle: 'Correction 1',
    revisionNumber: 2,
    supersedesFilingId: original.filingId,
    documentHash: 'd'.repeat(64)
  });
  await ingestManualOfficialFundamentalFiling(correction, {
    client: null, now: NOW, getAssetByIdFn: async () => FPT, idFactory
  });
  await assert.rejects(
    ingestManualOfficialFundamentalFiling({
      ...correction,
      sourceUrl: 'https://www.hsx.vn/correction-competing',
      sourceDisclosureId: 'FPT-C1-B',
      documentHash: 'e'.repeat(64)
    }, {
      client: null, now: NOW, getAssetByIdFn: async () => FPT, idFactory
    }),
    (error) => error.code === 'FUNDAMENTALS_REVISION_CONFLICT' && error.status === 409
  );
});

test('unverified filings and facts never become trusted numeric output', () => {
  const pendingFiling = createManualFundamentalFiling(filingPayload({ verificationStatus: 'PENDING' }), {
    asset: FPT, now: NOW, idFactory: uuidFactory()
  });
  const filingResponse = buildFundamentalsResponse(FPT, [pendingFiling], { asOf: NOW });
  assert.equal(filingResponse.availability, 'NOT_INGESTED');
  assert.equal(filingResponse.reason, 'NO_VERIFIED_FILINGS');
  assert.equal(JSON.stringify(filingResponse).includes(METRIC_VALUES.totalAssets), false);

  const pendingFactFiling = createManualFundamentalFiling(filingPayload({
    facts: facts({ validationStatus: 'PENDING' })
  }), { asset: FPT, now: NOW, idFactory: uuidFactory() });
  const factResponse = buildFundamentalsResponse(FPT, [pendingFactFiling], { asOf: NOW });
  assert.equal(factResponse.availability, 'PARTIAL');
  assert.equal(Object.keys(factResponse.latestAnnual.facts).length, 0);
  assert.equal(factResponse.latestAnnual.missingMetrics.length, FUNDAMENTALS_METRICS.length);
});

test('a pending correction cannot displace the last verified filing in the trusted projection', () => {
  const idFactory = uuidFactory();
  const original = createManualFundamentalFiling(filingPayload(), { asset: FPT, now: NOW, idFactory });
  const pending = createManualFundamentalFiling(filingPayload({
    sourceUrl: 'https://www.hsx.vn/pending-correction',
    sourceDisclosureId: 'FPT-PENDING-C1',
    sourceTitle: 'Pending correction',
    revisionNumber: 2,
    supersedesFilingId: original.id,
    documentHash: 'f'.repeat(64),
    verificationStatus: 'PENDING'
  }), { asset: FPT, now: NOW, idFactory });
  const response = buildFundamentalsResponse(FPT, [original, pending], { asOf: NOW });
  assert.equal(response.latestAnnual.filingId, original.id);
  assert.equal(response.latestAnnual.isSuperseded, false);
  assert.equal(JSON.stringify(response).includes('Pending correction'), false);
});

test('database row mapping recomputes replay authority and preserves numeric text', () => {
  const filing = rowToFundamentalFiling({
    id: '00000000-0000-4000-8000-000000000099', filing_identity_hash: 'a'.repeat(64),
    asset_id: FPT.id, ticker: 'FPT', issuer_legal_name: FPT.name, exchange: 'HOSE', company_type: 'INDUSTRIAL',
    source_authority: 'HOSE', source_url: 'https://www.hsx.vn/a', source_disclosure_id: null, source_title: 'A',
    published_at: '2026-03-30T02:00:00.000Z', source_available_at: '2026-09-11T02:00:00.000Z',
    fetched_at: null, recorded_at: '2026-09-10T02:00:00.000Z', first_seen_at: '2026-09-10T02:00:00.000Z',
    system_knowable_at: '2000-01-01T00:00:00.000Z', statement_scope: 'CONSOLIDATED', audit_status: 'AUDITED',
    accounting_regime: 'VAS', fiscal_year: 2025, fiscal_quarter: null, period_start: '2025-01-01',
    period_end: '2025-12-31', period_kind: 'ANNUAL', revision_number: 1, supersedes_filing_id: null,
    document_hash: null, verification_status: 'VERIFIED', methodology_version: 'vn-equity-fundamentals-v1a',
    facts: [{ id: '00000000-0000-4000-8000-000000000100', filing_id: '00000000-0000-4000-8000-000000000099', metric_code: 'totalAssets', source_line_code: '100', source_label: 'Assets', numeric_value: '12345678901234567890.25', currency_code: 'VND', unit_scale: 1, source_page: 1, source_sheet: null, source_cell: null, value_kind: 'REPORTED', derivation_formula: null, confidence: '1', validation_status: 'VERIFIED', missing_reason: null }]
  });
  assert.equal(filing.systemKnowableAt, '2026-09-11T02:00:00.000Z');
  assert.equal(filing.facts[0].numericValue, '12345678901234567890.25');
});

test('admin route fails closed and authorized manual ingestion is readable without calling a provider', async () => {
  clearFundamentalFilingMemory();
  const adminToken = 'f'.repeat(40);
  let assetReads = 0;
  const app = createApp({
    fundamentalsAdminToken: adminToken,
    supabaseAuthClient: null,
    getAssetByIdFn: async () => { assetReads += 1; return FPT; },
    getAssetBySymbolFn: async () => { assetReads += 1; return FPT; }
  });
  const server = await start(app);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(filingPayload()) };
    assert.equal((await fetch(`${url}/api/admin/equities/fundamentals/filings`, options)).status, 401);
    assert.equal((await fetch(`${url}/api/admin/equities/fundamentals/filings`, {
      ...options, headers: { ...options.headers, authorization: 'Bearer ordinary-user-token' }
    })).status, 403);
    assert.equal(assetReads, 0);

    const created = await fetch(`${url}/api/admin/equities/fundamentals/filings`, {
      ...options, headers: { ...options.headers, authorization: `Bearer ${adminToken}` }
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.data.ticker, 'FPT');
    assert.equal(created.headers.get('cache-control'), 'private, no-store');

    const read = await fetch(`${url}/api/equities/FPT/fundamentals`);
    assert.equal(read.status, 200);
    const body = await read.json();
    assert.equal(body.data.availability, 'PARTIAL');
    assert.equal(body.data.latestAnnual.facts.operatingCashFlow.numericValue, '0');
    assert.equal(assetReads, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const unconfigured = await start(createApp({ fundamentalsAdminToken: '', supabaseAuthClient: null }));
  try {
    const response = await fetch(`http://127.0.0.1:${unconfigured.address().port}/api/admin/equities/fundamentals/filings`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'FUNDAMENTALS_ADMIN_NOT_CONFIGURED');
  } finally {
    await new Promise((resolve) => unconfigured.close(resolve));
  }

  const noDurableStorage = await start(createApp({
    fundamentalsAdminToken: adminToken,
    fundamentalsClient: undefined,
    getAssetByIdFn: async () => FPT
  }));
  try {
    const response = await fetch(`http://127.0.0.1:${noDurableStorage.address().port}/api/admin/equities/fundamentals/filings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(filingPayload())
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'FUNDAMENTALS_STORAGE_UNAVAILABLE');
  } finally {
    await new Promise((resolve) => noDurableStorage.close(resolve));
  }
});

test('frontend shows only verified values, uses a dash for missing data, and retains source-scale provenance', async () => {
  assert.equal(formatFundamentalFact({ validationStatus: 'VERIFIED', numericValue: '0', unitScale: 1, currencyCode: 'VND' }), '0 VND');
  assert.equal(formatFundamentalFact({ validationStatus: 'VERIFIED', numericValue: null, unitScale: 1, currencyCode: 'VND' }), '—');
  assert.equal(formatFundamentalFact({ validationStatus: 'PENDING', numericValue: '99', unitScale: 1, currencyCode: 'VND' }), '—');
  assert.equal(formatFundamentalFact({ validationStatus: 'VERIFIED', numericValue: '1234567.89', unitScale: 1_000_000, currencyCode: 'VND' }), '1.234.567,89 triệu VND');

  const period = createManualFundamentalFiling(filingPayload(), { asset: FPT, now: NOW, idFactory: uuidFactory() });
  const response = buildFundamentalsResponse(FPT, [period], { asOf: NOW });
  const display = buildFundamentalsPeriodDisplay(response.latestAnnual);
  assert.equal(display.metrics.length, 7);
  assert.equal(display.periodLabel, 'Năm 2025');
  assert.equal(display.scopeLabel, 'Hợp nhất');
  assert.equal(display.metrics[0].sourceLocation, 'mã dòng 104 · trang 5');
  assert.equal(display.source.url.startsWith('https://www.hsx.vn/'), true);

  const component = await readFile(new URL('../../client/src/components/EquityFundamentalsSection.jsx', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../client/src/App.jsx', import.meta.url), 'utf8');
  assert.match(component, /\/api\/equities\/\$\{encodeURIComponent\(asset\.symbol\)\}\/fundamentals/);
  assert.match(component, /Đã xác minh/);
  assert.match(component, /Xem nguồn chính thức/);
  assert.match(component, /target="_blank" rel="noreferrer noopener"/);
  assert.match(app, /<EquityFundamentalsSection asset=\{assetDetail\} \/>/);
});

test('migration and schema make storage immutable, decimal-safe, service-only, and transactionally revision-aware', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/20260913000000_create_verified_equity_fundamentals.sql', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  for (const sql of [migration, schema]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.vn_equity_fundamental_filings/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.vn_equity_fundamental_facts/);
    assert.match(sql, /numeric_value NUMERIC\(52, 12\)/);
    assert.match(sql, /system_knowable_at = GREATEST\(first_seen_at, source_available_at\)/);
    assert.match(sql, /uq_vn_equity_fundamental_filings_superseded_once/);
    assert.match(sql, /FOR UPDATE/);
    assert.match(sql, /REVOKE ALL ON public\.vn_equity_fundamental_filings FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(sql, /REVOKE ALL ON public\.vn_equity_fundamental_facts FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.insert_vn_equity_fundamental_filing\(JSONB, JSONB\)/);
    assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE).*vn_equity_fundamental_(?:filings|facts).*service_role/);
  }
});

test('actual migration executes and its RPCs preserve decimal text while direct service-role mutation is denied', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE TABLE public.assets (id UUID PRIMARY KEY, symbol TEXT NOT NULL);
      INSERT INTO public.assets (id, symbol) VALUES ('${FPT.id}', 'FPT');
    `);
    const migration = await readFile(new URL('../../supabase/migrations/20260913000000_create_verified_equity_fundamentals.sql', import.meta.url), 'utf8');
    await db.exec(migration);

    const filing = createManualFundamentalFiling(filingPayload(), {
      asset: FPT, now: NOW, idFactory: uuidFactory()
    });
    await db.exec('SET ROLE service_role');
    const inserted = await db.query(
      'SELECT public.insert_vn_equity_fundamental_filing($1::jsonb, $2::jsonb) AS id',
      [JSON.stringify(fundamentalFilingToRpc(filing)), JSON.stringify(filing.facts.map(fundamentalFactToRpc))]
    );
    assert.equal(inserted.rows[0].id, filing.id);

    const read = await db.query(
      'SELECT public.read_vn_equity_fundamental_filings($1::uuid) AS result',
      [FPT.id]
    );
    assert.equal(read.rows[0].result.length, 1);
    assert.equal(read.rows[0].result[0].facts.find((fact) => fact.metric_code === 'operatingCashFlow').numeric_value, '0');
    assert.equal(read.rows[0].result[0].facts.find((fact) => fact.metric_code === 'totalAssets').numeric_value, METRIC_VALUES.totalAssets);

    await assert.rejects(
      db.exec(`UPDATE public.vn_equity_fundamental_filings SET source_title = 'mutated' WHERE id = '${filing.id}'`),
      /permission denied/i
    );
    await assert.rejects(
      db.query(
        'SELECT public.insert_vn_equity_fundamental_filing($1::jsonb, $2::jsonb)',
        [JSON.stringify(fundamentalFilingToRpc(filing)), JSON.stringify(filing.facts.map(fundamentalFactToRpc))]
      ),
      /duplicate key/i
    );
    await db.exec('RESET ROLE');
  } finally {
    await db.close();
  }
});
