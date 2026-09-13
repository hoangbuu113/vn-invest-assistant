import crypto from 'node:crypto';
import net from 'node:net';

export const FUNDAMENTALS_METHODOLOGY = 'vn-equity-fundamentals-v1a';

export const FUNDAMENTALS_AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  NOT_INGESTED: 'NOT_INGESTED',
  UNSUPPORTED_COMPANY_TYPE: 'UNSUPPORTED_COMPANY_TYPE',
  SOURCE_NOT_PROVISIONED: 'SOURCE_NOT_PROVISIONED'
});

export const FUNDAMENTALS_COMPANY_TYPES = Object.freeze([
  'INDUSTRIAL',
  'BANK',
  'SECURITIES',
  'INSURANCE'
]);

export const FUNDAMENTALS_SOURCE_AUTHORITIES = Object.freeze(['SSC', 'HOSE', 'HNX', 'ISSUER']);
export const FUNDAMENTALS_STATEMENT_SCOPES = Object.freeze(['CONSOLIDATED', 'SEPARATE']);
export const FUNDAMENTALS_AUDIT_STATUSES = Object.freeze(['UNAUDITED', 'REVIEWED', 'AUDITED']);
export const FUNDAMENTALS_PERIOD_KINDS = Object.freeze(['QUARTER', 'YTD', 'HALF_YEAR', 'ANNUAL', 'INSTANT']);
export const FUNDAMENTALS_VERIFICATION_STATUSES = Object.freeze(['VERIFIED', 'PENDING', 'REJECTED']);
export const FUNDAMENTALS_VALUE_KINDS = Object.freeze(['REPORTED', 'DERIVED']);

export const FUNDAMENTALS_METRICS = Object.freeze([
  'totalAssets',
  'totalLiabilities',
  'equity',
  'cashAndCashEquivalents',
  'netRevenue',
  'grossProfit',
  'profitBeforeTax',
  'netIncome',
  'parentShareholdersProfit',
  'operatingCashFlow',
  'investingCashFlow',
  'financingCashFlow'
]);

const METRIC_SET = new Set(FUNDAMENTALS_METRICS);
const UNIT_SCALES = new Set([1, 1_000, 1_000_000, 1_000_000_000]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const CURRENCY_PATTERN = /^[A-Z][A-Z0-9]{2,11}$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d{0,39})(?:\.\d{1,12})?$/;
const CELL_PATTERN = /^[A-Z]{1,4}[1-9]\d{0,6}$/;

function fundamentalsError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requiredString(value, field, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim()) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} is too long`);
  }
  return normalized;
}

function optionalString(value, field, maxLength = 500) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} must be a non-empty string when provided`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} is too long`);
  }
  return normalized;
}

function enumValue(value, allowed, field) {
  const normalized = requiredString(value, field, 64).toUpperCase();
  if (!allowed.includes(normalized)) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} must be one of: ${allowed.join(', ')}`);
  }
  return normalized;
}

function isoTimestamp(value, field, { required = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (!required) return null;
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} is required`);
  }
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} must include an explicit timezone`);
  }
  const parsed = Date.parse(value.trim());
  if (!Number.isFinite(parsed)) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} must be a valid timestamp`);
  }
  return new Date(parsed).toISOString();
}

function isoDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} must use YYYY-MM-DD`);
  }
  const normalized = value.trim();
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${field} must be a valid calendar date`);
  }
  return normalized;
}

function normalizeDecimal(value) {
  if (value === null || value === undefined) return null;
  let raw;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'numericValue must be finite');
    }
    if (!Number.isSafeInteger(value)) {
      throw fundamentalsError(
        'INVALID_FUNDAMENTAL_FACT',
        'Fractional or unsafe numericValue must be supplied as a decimal string'
      );
    }
    raw = String(value);
  } else if (typeof value === 'string') {
    raw = value.trim();
  } else {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'numericValue must be a decimal string, number, or null');
  }
  if (!DECIMAL_PATTERN.test(raw)) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'numericValue must be a plain decimal with at most 40 integer and 12 fractional digits');
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [integerPart, fractionalPart] = unsigned.split('.');
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0';
  const normalizedFraction = fractionalPart?.replace(/0+$/, '') || '';
  const normalized = `${normalizedInteger}${normalizedFraction ? `.${normalizedFraction}` : ''}`;
  return negative && normalized !== '0' ? `-${normalized}` : normalized;
}

function normalizeSourceUrl(value, sourceAuthority) {
  const raw = requiredString(value, 'sourceUrl', 2_000);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw fundamentalsError('INVALID_OFFICIAL_SOURCE_URL', 'sourceUrl must be a valid URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw fundamentalsError('INVALID_OFFICIAL_SOURCE_URL', 'sourceUrl must be a credential-free HTTPS URL using the default port');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    !hostname || hostname === 'localhost' || hostname.endsWith('.local') ||
    net.isIP(hostname) !== 0
  ) {
    throw fundamentalsError('INVALID_OFFICIAL_SOURCE_URL', 'sourceUrl must use a public hostname');
  }
  const authorityHosts = {
    SSC: ['ssc.gov.vn'],
    HOSE: ['hsx.vn'],
    HNX: ['hnx.vn']
  };
  const expected = authorityHosts[sourceAuthority];
  if (expected && !expected.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw fundamentalsError(
      'INVALID_OFFICIAL_SOURCE_URL',
      `sourceUrl hostname does not match sourceAuthority ${sourceAuthority}`
    );
  }
  parsed.hash = '';
  return parsed.toString();
}

function normalizeFundamentalFact(input, { idFactory }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'Each fact must be an object');
  }
  const metricCode = requiredString(input.metricCode, 'metricCode', 64);
  if (!METRIC_SET.has(metricCode)) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', `Unsupported metricCode '${metricCode}'`);
  }
  const numericValue = normalizeDecimal(input.numericValue);
  const missingReason = optionalString(input.missingReason, 'missingReason', 200);
  if (numericValue === null && !missingReason) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'missingReason is required when numericValue is null');
  }
  if (numericValue !== null && missingReason) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'missingReason must be null when numericValue is present');
  }

  const currencyCode = requiredString(input.currencyCode, 'currencyCode', 12).toUpperCase();
  if (!CURRENCY_PATTERN.test(currencyCode)) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'currencyCode must be an uppercase currency code');
  }
  if (!Number.isInteger(input.unitScale) || !UNIT_SCALES.has(input.unitScale)) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'unitScale must be one of: 1, 1000, 1000000, 1000000000');
  }

  const valueKind = enumValue(input.valueKind, FUNDAMENTALS_VALUE_KINDS, 'valueKind');
  const derivationFormula = optionalString(input.derivationFormula, 'derivationFormula', 1_000);
  if (valueKind === 'DERIVED' && !derivationFormula) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'DERIVED facts require derivationFormula');
  }
  if (valueKind === 'REPORTED' && derivationFormula) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'REPORTED facts cannot carry derivationFormula');
  }

  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'confidence must be a number between 0 and 1');
  }
  const sourcePage = input.sourcePage === null || input.sourcePage === undefined
    ? null
    : input.sourcePage;
  if (sourcePage !== null && (!Number.isInteger(sourcePage) || sourcePage < 1)) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'sourcePage must be a positive integer when provided');
  }
  const sourceCell = optionalString(input.sourceCell, 'sourceCell', 32)?.toUpperCase() || null;
  if (sourceCell && !CELL_PATTERN.test(sourceCell)) {
    throw fundamentalsError('INVALID_FUNDAMENTAL_FACT', 'sourceCell must be an A1-style cell reference');
  }

  return Object.freeze({
    id: idFactory(),
    metricCode,
    sourceLineCode: optionalString(input.sourceLineCode, 'sourceLineCode', 100),
    sourceLabel: requiredString(input.sourceLabel, 'sourceLabel', 500),
    numericValue,
    currencyCode,
    unitScale: input.unitScale,
    sourcePage,
    sourceSheet: optionalString(input.sourceSheet, 'sourceSheet', 200),
    sourceCell,
    valueKind,
    derivationFormula,
    confidence: input.confidence,
    validationStatus: enumValue(input.validationStatus, FUNDAMENTALS_VERIFICATION_STATUSES, 'validationStatus'),
    missingReason
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function calculateFundamentalFilingIdentityHash(filing) {
  const identity = stableValue({
    assetId: filing.assetId,
    sourceAuthority: filing.sourceAuthority,
    sourceUrl: filing.sourceUrl,
    sourceDisclosureId: filing.sourceDisclosureId,
    publishedAt: filing.publishedAt,
    statementScope: filing.statementScope,
    auditStatus: filing.auditStatus,
    fiscalYear: filing.fiscalYear,
    fiscalQuarter: filing.fiscalQuarter,
    periodStart: filing.periodStart,
    periodEnd: filing.periodEnd,
    periodKind: filing.periodKind,
    revisionNumber: filing.revisionNumber,
    supersedesFilingId: filing.supersedesFilingId
  });
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function createManualFundamentalFiling(payload = {}, {
  asset,
  now = new Date(),
  idFactory = crypto.randomUUID
} = {}) {
  if (!asset || typeof asset !== 'object') {
    throw fundamentalsError('ASSET_NOT_FOUND', 'Asset does not exist', 404);
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw fundamentalsError('INVALID_TIME_CONTEXT', 'A valid ingestion time is required');
  }
  const assetType = asset.assetType ?? asset.asset_type;
  const marketPolicy = asset.marketPolicy ?? asset.market_policy;
  if (assetType !== 'stock' || marketPolicy !== 'VN_EXCHANGE') {
    throw fundamentalsError('UNSUPPORTED_COMPANY_TYPE', 'Fundamentals V1A supports Vietnam-listed stocks only', 422);
  }

  const assetId = requiredString(payload.assetId, 'assetId', 64);
  if (!UUID_PATTERN.test(assetId) || assetId !== asset.id) {
    throw fundamentalsError('FUNDAMENTALS_ASSET_IDENTITY_MISMATCH', 'assetId does not match the canonical asset', 400);
  }
  const ticker = requiredString(payload.ticker, 'ticker', 20).toUpperCase();
  if (ticker !== String(asset.symbol || '').toUpperCase()) {
    throw fundamentalsError('FUNDAMENTALS_ASSET_IDENTITY_MISMATCH', 'ticker does not match the canonical asset', 400);
  }
  const exchange = requiredString(payload.exchange, 'exchange', 20).toUpperCase();
  const canonicalExchange = String(asset.marketCode ?? asset.market_code ?? asset.exchange ?? '').toUpperCase();
  if (!canonicalExchange || exchange !== canonicalExchange) {
    throw fundamentalsError('FUNDAMENTALS_ASSET_IDENTITY_MISMATCH', 'exchange does not match the canonical asset', 400);
  }

  const requestedCompanyType = payload.companyType === undefined || payload.companyType === null
    ? null
    : enumValue(payload.companyType, FUNDAMENTALS_COMPANY_TYPES, 'companyType');
  const canonicalCompanyType = String(
    asset.fundamentalsCompanyType ?? asset.fundamentals_company_type ?? ''
  ).trim().toUpperCase() || null;
  if (canonicalCompanyType && requestedCompanyType && canonicalCompanyType !== requestedCompanyType) {
    throw fundamentalsError('FUNDAMENTALS_COMPANY_TYPE_MISMATCH', 'companyType does not match canonical asset metadata', 400);
  }
  const companyType = canonicalCompanyType;
  if (companyType !== 'INDUSTRIAL') {
    throw fundamentalsError(
      'UNSUPPORTED_COMPANY_TYPE',
      companyType
        ? `Fundamentals V1A does not support ${companyType} issuers`
        : 'The issuer company type has not been classified for Fundamentals V1A',
      422
    );
  }

  const sourceAuthority = enumValue(payload.sourceAuthority, FUNDAMENTALS_SOURCE_AUTHORITIES, 'sourceAuthority');
  const sourceUrl = normalizeSourceUrl(payload.sourceUrl, sourceAuthority);
  const publishedAt = isoTimestamp(payload.publishedAt, 'publishedAt');
  const sourceAvailableAt = isoTimestamp(payload.sourceAvailableAt, 'sourceAvailableAt');
  if (Date.parse(sourceAvailableAt) < Date.parse(publishedAt)) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'sourceAvailableAt cannot precede publishedAt');
  }
  if (Date.parse(sourceAvailableAt) > now.getTime()) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'sourceAvailableAt cannot be in the future');
  }
  const fetchedAt = isoTimestamp(payload.fetchedAt, 'fetchedAt', { required: false });
  const firstSeenAt = now.toISOString();
  if (fetchedAt && Date.parse(fetchedAt) > now.getTime()) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'fetchedAt cannot be in the future');
  }
  if (fetchedAt && Date.parse(fetchedAt) < Date.parse(sourceAvailableAt)) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'fetchedAt cannot precede sourceAvailableAt');
  }
  const systemKnowableAt = new Date(Math.max(Date.parse(firstSeenAt), Date.parse(sourceAvailableAt))).toISOString();

  const periodStart = isoDate(payload.periodStart, 'periodStart');
  const periodEnd = isoDate(payload.periodEnd, 'periodEnd');
  if (periodStart > periodEnd) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'periodStart cannot follow periodEnd');
  }
  if (!Number.isInteger(payload.fiscalYear) || payload.fiscalYear < 1900 || payload.fiscalYear > 2200) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'fiscalYear must be an integer between 1900 and 2200');
  }
  const periodKind = enumValue(payload.periodKind, FUNDAMENTALS_PERIOD_KINDS, 'periodKind');
  const fiscalQuarter = payload.fiscalQuarter === null || payload.fiscalQuarter === undefined
    ? null
    : payload.fiscalQuarter;
  if (fiscalQuarter !== null && (!Number.isInteger(fiscalQuarter) || fiscalQuarter < 1 || fiscalQuarter > 4)) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'fiscalQuarter must be between 1 and 4');
  }
  if (['QUARTER', 'YTD'].includes(periodKind) && fiscalQuarter === null) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', `${periodKind} filings require fiscalQuarter`);
  }

  if (!Number.isInteger(payload.revisionNumber) || payload.revisionNumber < 1) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'revisionNumber must be a positive integer');
  }
  const supersedesFilingId = optionalString(payload.supersedesFilingId, 'supersedesFilingId', 64);
  if (supersedesFilingId && !UUID_PATTERN.test(supersedesFilingId)) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'supersedesFilingId must be a UUID');
  }
  if (!supersedesFilingId && payload.revisionNumber !== 1) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_REVISION', 'An original filing must have revisionNumber 1');
  }
  if (supersedesFilingId && payload.revisionNumber === 1) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_REVISION', 'A corrected filing must have revisionNumber greater than 1');
  }

  const documentHash = optionalString(payload.documentHash, 'documentHash', 64)?.toLowerCase() || null;
  if (documentHash && !HASH_PATTERN.test(documentHash)) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'documentHash must be a SHA-256 hex digest');
  }
  if (!Array.isArray(payload.facts) || payload.facts.length === 0) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'At least one fundamental fact is required');
  }
  if (payload.facts.length > FUNDAMENTALS_METRICS.length) {
    throw fundamentalsError('INVALID_FUNDAMENTALS_FILING', 'Too many fundamental facts were supplied');
  }
  const facts = payload.facts.map((fact) => normalizeFundamentalFact(fact, { idFactory }));
  if (new Set(facts.map((fact) => fact.metricCode)).size !== facts.length) {
    throw fundamentalsError('DUPLICATE_FUNDAMENTAL_METRIC', 'A filing may contain each metricCode at most once');
  }

  const filing = {
    id: idFactory(),
    assetId,
    ticker,
    issuerLegalName: requiredString(payload.issuerLegalName, 'issuerLegalName', 500),
    exchange,
    companyType,
    sourceAuthority,
    sourceUrl,
    sourceDisclosureId: optionalString(payload.sourceDisclosureId, 'sourceDisclosureId', 200),
    sourceTitle: requiredString(payload.sourceTitle, 'sourceTitle', 1_000),
    publishedAt,
    sourceAvailableAt,
    fetchedAt,
    recordedAt: now.toISOString(),
    firstSeenAt,
    systemKnowableAt,
    statementScope: enumValue(payload.statementScope, FUNDAMENTALS_STATEMENT_SCOPES, 'statementScope'),
    auditStatus: enumValue(payload.auditStatus, FUNDAMENTALS_AUDIT_STATUSES, 'auditStatus'),
    accountingRegime: optionalString(payload.accountingRegime, 'accountingRegime', 200),
    fiscalYear: payload.fiscalYear,
    fiscalQuarter,
    periodStart,
    periodEnd,
    periodKind,
    revisionNumber: payload.revisionNumber,
    supersedesFilingId,
    documentHash,
    verificationStatus: enumValue(
      payload.verificationStatus,
      FUNDAMENTALS_VERIFICATION_STATUSES,
      'verificationStatus'
    ),
    methodologyVersion: FUNDAMENTALS_METHODOLOGY,
    facts
  };
  filing.identityHash = calculateFundamentalFilingIdentityHash(filing);
  return Object.freeze({ ...filing, facts: Object.freeze(facts) });
}

function newestFirst(left, right) {
  return right.periodEnd.localeCompare(left.periodEnd)
    || Number(right.statementScope === 'CONSOLIDATED') - Number(left.statementScope === 'CONSOLIDATED')
    || right.revisionNumber - left.revisionNumber
    || right.systemKnowableAt.localeCompare(left.systemKnowableAt)
    || right.id.localeCompare(left.id);
}

function projectPeriod(filing, supersededIds) {
  const verifiedFacts = (Array.isArray(filing.facts) ? filing.facts : [])
    .filter((fact) => fact.validationStatus === 'VERIFIED');
  const facts = Object.fromEntries(verifiedFacts.map((fact) => [fact.metricCode, {
    factId: fact.id,
    filingId: filing.id,
    metricCode: fact.metricCode,
    sourceLineCode: fact.sourceLineCode,
    sourceLabel: fact.sourceLabel,
    numericValue: fact.numericValue,
    currencyCode: fact.currencyCode,
    unitScale: fact.unitScale,
    sourcePage: fact.sourcePage,
    sourceSheet: fact.sourceSheet,
    sourceCell: fact.sourceCell,
    valueKind: fact.valueKind,
    derivationFormula: fact.derivationFormula,
    confidence: fact.confidence,
    validationStatus: fact.validationStatus,
    missingReason: fact.missingReason
  }]));
  const missingMetrics = FUNDAMENTALS_METRICS.filter(
    (metricCode) => !facts[metricCode] || facts[metricCode].numericValue === null
  );
  return Object.freeze({
    filingId: filing.id,
    filingIdentityHash: filing.identityHash,
    fiscalYear: filing.fiscalYear,
    fiscalQuarter: filing.fiscalQuarter,
    periodStart: filing.periodStart,
    periodEnd: filing.periodEnd,
    periodKind: filing.periodKind,
    statementScope: filing.statementScope,
    auditStatus: filing.auditStatus,
    accountingRegime: filing.accountingRegime,
    revisionNumber: filing.revisionNumber,
    supersedesFilingId: filing.supersedesFilingId,
    isSuperseded: supersededIds.has(filing.id),
    verificationStatus: filing.verificationStatus,
    publishedAt: filing.publishedAt,
    sourceAvailableAt: filing.sourceAvailableAt,
    fetchedAt: filing.fetchedAt,
    recordedAt: filing.recordedAt,
    firstSeenAt: filing.firstSeenAt,
    systemKnowableAt: filing.systemKnowableAt,
    methodologyVersion: filing.methodologyVersion,
    source: Object.freeze({
      authority: filing.sourceAuthority,
      url: filing.sourceUrl,
      disclosureId: filing.sourceDisclosureId,
      title: filing.sourceTitle,
      documentHash: filing.documentHash
    }),
    facts: Object.freeze(facts),
    missingMetrics: Object.freeze(missingMetrics)
  });
}

export function buildFundamentalsResponse(asset, filings = [], { asOf = new Date() } = {}) {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    throw fundamentalsError('INVALID_AS_OF', 'asOf must be a valid Date');
  }
  const eligibleEquity = (asset?.assetType ?? asset?.asset_type) === 'stock'
    && (asset?.marketPolicy ?? asset?.market_policy) === 'VN_EXCHANGE';
  const knownFilings = (Array.isArray(filings) ? filings : [])
    .filter((filing) => Date.parse(filing.systemKnowableAt) <= asOf.getTime())
    .sort(newestFirst);
  const companyType = String(
    asset?.fundamentalsCompanyType ?? asset?.fundamentals_company_type ?? ''
  ).trim().toUpperCase() || null;
  const base = {
    methodologyVersion: FUNDAMENTALS_METHODOLOGY,
    asset: {
      assetId: asset?.id || null,
      ticker: asset?.symbol || null,
      issuerLegalName: asset?.name || null,
      exchange: asset?.marketCode ?? asset?.market_code ?? asset?.exchange ?? null,
      companyType
    },
    supportedCompanyType: eligibleEquity && companyType === 'INDUSTRIAL',
    asOf: asOf.toISOString(),
    latestAnnual: null,
    latestQuarter: null,
    historicalPeriods: [],
    expectedMetrics: FUNDAMENTALS_METRICS,
    limitations: []
  };

  if (!eligibleEquity || companyType !== 'INDUSTRIAL') {
    return Object.freeze({
      ...base,
      availability: FUNDAMENTALS_AVAILABILITY.UNSUPPORTED_COMPANY_TYPE,
      reason: companyType
        ? `COMPANY_TYPE_${companyType}_UNSUPPORTED`
        : 'COMPANY_TYPE_NOT_CLASSIFIED',
      limitations: Object.freeze(['Fundamentals V1A supports industrial, non-financial Vietnam-listed issuers only.'])
    });
  }

  const verifiedFilings = knownFilings.filter((filing) => filing.verificationStatus === 'VERIFIED');
  const filingsById = new Map(knownFilings.map((filing) => [filing.id, filing]));
  const supersededIds = new Set();
  for (const filing of verifiedFilings) {
    const visited = new Set();
    let ancestorId = filing.supersedesFilingId;
    while (ancestorId && !visited.has(ancestorId)) {
      visited.add(ancestorId);
      supersededIds.add(ancestorId);
      ancestorId = filingsById.get(ancestorId)?.supersedesFilingId || null;
    }
  }
  const verified = verifiedFilings
    .map((filing) => projectPeriod(filing, supersededIds));
  if (verified.length === 0) {
    return Object.freeze({
      ...base,
      availability: FUNDAMENTALS_AVAILABILITY.NOT_INGESTED,
      reason: knownFilings.length > 0 ? 'NO_VERIFIED_FILINGS' : 'NO_FILINGS',
      limitations: Object.freeze(['No manually verified official filing has been ingested for this issuer.'])
    });
  }

  const active = verified.filter((period) => !period.isSuperseded);
  const latestAnnual = active.find((period) => period.periodKind === 'ANNUAL') || null;
  const latestQuarter = active.find((period) => ['QUARTER', 'YTD', 'HALF_YEAR'].includes(period.periodKind)) || null;
  const hasAnyVerifiedValue = active.some((period) => Object.values(period.facts).some(
    (fact) => fact.numericValue !== null
  ));
  const completeLatest = Boolean(
    latestAnnual && latestQuarter &&
    latestAnnual.missingMetrics.length === 0 && latestQuarter.missingMetrics.length === 0
  );
  return Object.freeze({
    ...base,
    availability: completeLatest ? FUNDAMENTALS_AVAILABILITY.AVAILABLE : FUNDAMENTALS_AVAILABILITY.PARTIAL,
    reason: completeLatest ? null : (hasAnyVerifiedValue ? 'VERIFIED_COVERAGE_PARTIAL' : 'VERIFIED_VALUES_MISSING'),
    latestAnnual,
    latestQuarter,
    historicalPeriods: Object.freeze(verified),
    limitations: Object.freeze([
      ...(completeLatest ? [] : ['Only explicitly verified reported facts are displayed; missing metrics remain unavailable.']),
      'Fundamentals V1A does not infer or fabricate missing values.'
    ])
  });
}

export function parseFundamentalsAsOf(value, fallback = new Date()) {
  if (value === null || value === undefined || value === '') return fallback;
  return new Date(isoTimestamp(value, 'asOf'));
}
