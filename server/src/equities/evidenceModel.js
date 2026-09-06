import crypto from 'node:crypto';

export const EQUITY_EVIDENCE_TYPES = Object.freeze({
  MARKET_PRICE: 'market_price',
  FUNDAMENTAL: 'fundamental',
  DISCLOSURE: 'disclosure'
});

export const EQUITY_EVIDENCE_STATUS = Object.freeze({
  AVAILABLE: 'available',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable'
});

export const EQUITY_EVIDENCE_FRESHNESS = Object.freeze({
  FRESH: 'fresh',
  DELAYED: 'delayed',
  STALE: 'stale'
});

export const EQUITY_EVIDENCE_METHODOLOGY = 'vn-equity-evidence-v1';

const PRIVATE_KEYS = new Set([
  'userid', 'user_id', 'profileid', 'profile_id', 'portfolio', 'holdings',
  'transactions', 'cash', 'email', 'password', 'token', 'authorization',
  'credential', 'secret', 'apikey', 'api_key'
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeIsoTimestamp(value, field, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new TypeError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) {
    throw new TypeError(`${field} must be an explicit timezone-aware timestamp`);
  }
  const parsed = Date.parse(value.trim());
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function sanitizePublicObject(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicObject);
  if (!value || typeof value !== 'object') return value;

  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key.toLowerCase())) continue;
    clean[key] = sanitizePublicObject(child);
  }
  return clean;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

export function calculateEquityEvidenceHash(payload = {}) {
  const canonical = stableValue({
    assetId: payload.assetId || null,
    symbol: payload.symbol || null,
    exchange: payload.exchange || null,
    companyName: payload.companyName || null,
    evidenceType: payload.evidenceType || null,
    metric: payload.metric || null,
    numericValue: typeof payload.numericValue === 'number' && Number.isFinite(payload.numericValue)
      ? payload.numericValue
      : null,
    textValue: normalizeString(payload.textValue),
    unit: normalizeString(payload.unit),
    currency: normalizeString(payload.currency),
    referencePeriod: normalizeString(payload.referencePeriod),
    observedAt: payload.observedAt || null,
    publishedAt: payload.publishedAt || null,
    sourceAvailableAt: payload.sourceAvailableAt || null,
    sourceId: payload.sourceId || null,
    sourceName: payload.sourceName || null,
    sourceFamily: payload.sourceFamily || null,
    dependencyGroup: payload.dependencyGroup || null,
    authorityLevel: payload.authorityLevel || null,
    provenance: sanitizePublicObject(payload.provenance || {}),
    revisionMarker: payload.revisionMarker || null,
    methodologyVersion: payload.methodologyVersion || EQUITY_EVIDENCE_METHODOLOGY
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function buildEquityObservationId({ factId, referencePeriod, sourceContentHash }) {
  if (!normalizeString(factId)) throw new TypeError('factId is required');
  if (!normalizeString(sourceContentHash)) throw new TypeError('sourceContentHash is required');
  return `${factId}:${normalizeString(referencePeriod) || 'undated'}:h_${sourceContentHash.slice(0, 16)}`;
}

export function createEquityEvidence(payload = {}) {
  const assetId = normalizeString(payload.assetId);
  const symbol = normalizeString(payload.symbol)?.toUpperCase() || null;
  const exchange = normalizeString(payload.exchange)?.toUpperCase() || null;
  const companyName = normalizeString(payload.companyName);
  const evidenceType = payload.evidenceType;
  const metric = normalizeString(payload.metric)?.toLowerCase() || null;
  const status = Object.values(EQUITY_EVIDENCE_STATUS).includes(payload.status)
    ? payload.status
    : EQUITY_EVIDENCE_STATUS.AVAILABLE;

  if (!assetId || !symbol || !exchange || !companyName) {
    throw new TypeError('Equity evidence requires assetId, symbol, exchange, and companyName');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
    throw new TypeError('Equity evidence assetId must be a UUID');
  }
  if (!/^[A-Z0-9]{1,20}$/.test(symbol)) {
    throw new TypeError('Equity evidence symbol must be a canonical Vietnam ticker');
  }
  if (!Object.values(EQUITY_EVIDENCE_TYPES).includes(evidenceType)) {
    throw new TypeError('Equity evidence has an invalid evidenceType');
  }
  if (!metric || !/^[a-z][a-z0-9_]*$/.test(metric)) {
    throw new TypeError('Equity evidence metric must be a canonical lower-snake-case identifier');
  }

  const rawNumeric = payload.numericValue;
  const numericValue = typeof rawNumeric === 'number' && Number.isFinite(rawNumeric)
    ? rawNumeric
    : null;
  const textValue = normalizeString(payload.textValue);

  if (rawNumeric !== null && rawNumeric !== undefined && numericValue === null) {
    throw new TypeError('numericValue must be a finite JSON number when provided');
  }
  if (metric === 'close' && numericValue !== null && numericValue <= 0) {
    throw new TypeError('close must be greater than zero');
  }
  if (metric === 'volume' && numericValue !== null && numericValue < 0) {
    throw new TypeError('volume must be greater than or equal to zero');
  }
  if (status === EQUITY_EVIDENCE_STATUS.UNAVAILABLE && (numericValue !== null || textValue !== null)) {
    throw new TypeError('Unavailable equity evidence cannot carry a value');
  }
  if (status !== EQUITY_EVIDENCE_STATUS.UNAVAILABLE && numericValue === null && textValue === null) {
    throw new TypeError('Available equity evidence requires a numericValue or textValue');
  }

  const observedAt = normalizeIsoTimestamp(payload.observedAt, 'observedAt');
  const publishedAt = normalizeIsoTimestamp(payload.publishedAt, 'publishedAt');
  const fetchedAt = normalizeIsoTimestamp(payload.fetchedAt, 'fetchedAt', { required: true });
  const firstSeenAt = normalizeIsoTimestamp(payload.firstSeenAt || fetchedAt, 'firstSeenAt', { required: true });
  const sourceAvailableAt = normalizeIsoTimestamp(
    payload.sourceAvailableAt || publishedAt || observedAt,
    'sourceAvailableAt'
  );
  if (
    evidenceType === EQUITY_EVIDENCE_TYPES.MARKET_PRICE
    && status !== EQUITY_EVIDENCE_STATUS.UNAVAILABLE
    && !observedAt
  ) {
    throw new TypeError('Available market-price evidence requires observedAt');
  }
  const systemKnowableAt = new Date(Math.max(
    Date.parse(firstSeenAt),
    sourceAvailableAt ? Date.parse(sourceAvailableAt) : Number.NEGATIVE_INFINITY
  )).toISOString();
  const referencePeriod = normalizeString(payload.referencePeriod);
  const sourceId = normalizeString(payload.sourceId);
  const sourceName = normalizeString(payload.sourceName);
  const sourceFamily = normalizeString(payload.sourceFamily);
  const dependencyGroup = normalizeString(payload.dependencyGroup);
  const authorityLevel = normalizeString(payload.authorityLevel);

  if (!referencePeriod || !sourceId || !sourceName || !sourceFamily || !dependencyGroup || !authorityLevel) {
    throw new TypeError('Equity evidence requires referencePeriod and complete source provenance');
  }

  const expectedFactId = `vn.equity.${symbol.toLowerCase()}.${evidenceType}.${metric}`;
  const factId = normalizeString(payload.factId) || expectedFactId;
  if (factId !== expectedFactId) {
    throw new TypeError(`Equity evidence factId must equal '${expectedFactId}'`);
  }
  const methodologyVersion = normalizeString(payload.methodologyVersion) || EQUITY_EVIDENCE_METHODOLOGY;
  const computedSourceContentHash = calculateEquityEvidenceHash({
    ...payload,
    assetId,
    symbol,
    exchange,
    companyName,
    evidenceType,
    metric,
    numericValue,
    textValue,
    referencePeriod,
    observedAt,
    publishedAt,
    sourceAvailableAt,
    sourceId,
    sourceName,
    sourceFamily,
    dependencyGroup,
    authorityLevel,
    provenance: payload.provenance || {},
    methodologyVersion
  });
  const sourceContentHash = normalizeString(payload.sourceContentHash) || computedSourceContentHash;
  if (sourceContentHash !== computedSourceContentHash) {
    throw new TypeError('Equity evidence sourceContentHash does not match canonical content');
  }
  const expectedObservationId = buildEquityObservationId({
    factId,
    referencePeriod,
    sourceContentHash
  });
  const observationId = normalizeString(payload.observationId) || expectedObservationId;
  if (observationId !== expectedObservationId) {
    throw new TypeError('Equity evidence observationId does not match its canonical vintage');
  }

  return Object.freeze({
    assetId,
    symbol,
    exchange,
    companyName,
    evidenceType,
    metric,
    factId,
    observationId,
    numericValue,
    textValue,
    unit: normalizeString(payload.unit),
    currency: normalizeString(payload.currency)?.toUpperCase() || null,
    referencePeriod,
    observedAt,
    publishedAt,
    fetchedAt,
    firstSeenAt,
    sourceAvailableAt,
    systemKnowableAt,
    sourceId,
    sourceName,
    sourceFamily,
    dependencyGroup,
    authorityLevel,
    provenance: Object.freeze(sanitizePublicObject(payload.provenance || {})),
    status,
    freshness: Object.values(EQUITY_EVIDENCE_FRESHNESS).includes(payload.freshness)
      ? payload.freshness
      : EQUITY_EVIDENCE_FRESHNESS.DELAYED,
    statusReason: normalizeString(payload.statusReason),
    revisionMarker: normalizeString(payload.revisionMarker),
    sourceContentHash,
    methodologyVersion
  });
}

export function createUnavailableEquityEvidence(payload = {}) {
  return createEquityEvidence({
    ...payload,
    numericValue: null,
    textValue: null,
    status: EQUITY_EVIDENCE_STATUS.UNAVAILABLE,
    statusReason: normalizeString(payload.statusReason) || 'SOURCE_DATA_UNAVAILABLE'
  });
}

export function compareEquityEvidenceVintages(left, right) {
  const refCompare = (right?.referencePeriod || '').localeCompare(left?.referencePeriod || '');
  if (refCompare !== 0) return refCompare;

  for (const field of ['publishedAt', 'observedAt', 'systemKnowableAt', 'firstSeenAt']) {
    const leftMs = left?.[field] ? Date.parse(left[field]) : 0;
    const rightMs = right?.[field] ? Date.parse(right[field]) : 0;
    if (leftMs !== rightMs) return rightMs - leftMs;
  }
  return (right?.observationId || '').localeCompare(left?.observationId || '');
}

export function selectLatestEquityEvidence(evidence = []) {
  const latest = new Map();
  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (!item?.factId) continue;
    const current = latest.get(item.factId);
    if (!current || compareEquityEvidenceVintages(item, current) < 0) {
      latest.set(item.factId, item);
    }
  }
  return Array.from(latest.values()).sort((a, b) => a.factId.localeCompare(b.factId));
}

/**
 * Explicit adapter into the existing 01D observation replay contract. The
 * canonical equity object remains unchanged; aliases are added only here.
 */
export function toReplayCompatibleEquityObservation(item) {
  if (!item || typeof item !== 'object') return null;
  return Object.freeze({
    ...item,
    id: item.factId,
    pillar: 'market',
    label: `${item.companyName} ${item.metric}`,
    value: item.numericValue,
    referenceTime: item.referencePeriod,
    source: item.sourceId
  });
}
