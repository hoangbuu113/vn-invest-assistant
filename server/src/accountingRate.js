import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  getCoinGeckoCurrentUsdtVndObservation,
  getCoinGeckoHistoricalUsdtVndObservations
} from './providers/coingecko.js';

export const USDT_VND_ACCOUNTING_PROVENANCE = 'COINGECKO_USDT_VND';
export const CURRENT_ACCOUNTING_RATE_MAX_AGE_MS = 10 * 60 * 1000;
export const HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS = 60 * 60 * 1000;
const HISTORICAL_QUERY_PADDING_MS = 2 * 60 * 60 * 1000;
const ACCOUNTING_PRICE_ABSOLUTE_TOLERANCE_VND = 0.05;
const ACCOUNTING_RATE_QUOTE_VERSION = 1;
const ACCOUNTING_RATE_QUOTE_PROVIDER = 'CoinGecko';
const ACCOUNTING_RATE_QUOTE_SECRET_MIN_BYTES = 32;
const ACCOUNTING_RATE_QUOTE_PROOF_MAX_LENGTH = 4096;

function normalizeCurrency(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isCoinGeckoAccountingRateEnabled(
  value = process.env.COINGECKO_ACCOUNTING_RATE_ENABLED
) {
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function positiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function canonicalPositiveDecimal(value) {
  const number = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  return Number.isFinite(number) && number > 0 ? String(number) : null;
}

function canonicalTimestamp(value) {
  return normalizeDate(value)?.toISOString() ?? null;
}

export function isAccountingRateQuoteSecretConfigured(
  value = process.env.ACCOUNTING_RATE_QUOTE_SECRET
) {
  return typeof value === 'string'
    && Buffer.byteLength(value.trim(), 'utf8') >= ACCOUNTING_RATE_QUOTE_SECRET_MIN_BYTES;
}

function canonicalizeAccountingRateQuoteClaims(input) {
  if (input?.version !== ACCOUNTING_RATE_QUOTE_VERSION) return null;
  if (input?.provider !== ACCOUNTING_RATE_QUOTE_PROVIDER) return null;
  if (input?.provenance !== USDT_VND_ACCOUNTING_PROVENANCE) return null;
  if (input?.baseCurrency !== 'USDT' || input?.quoteCurrency !== 'VND') return null;

  const rate = canonicalPositiveDecimal(input?.rate);
  const observedAt = canonicalTimestamp(input?.observedAt);
  const issuedAt = canonicalTimestamp(input?.issuedAt);
  const mode = input?.mode === 'CURRENT' || input?.mode === 'HISTORICAL'
    ? input.mode
    : null;
  const requestedExecutedAt = input?.requestedExecutedAt === null
    ? null
    : canonicalTimestamp(input?.requestedExecutedAt);

  if (!rate || !observedAt || !issuedAt || !mode) return null;
  if (mode === 'CURRENT' && requestedExecutedAt !== null) return null;
  if (mode === 'HISTORICAL' && requestedExecutedAt === null) return null;

  return {
    version: ACCOUNTING_RATE_QUOTE_VERSION,
    provider: ACCOUNTING_RATE_QUOTE_PROVIDER,
    provenance: USDT_VND_ACCOUNTING_PROVENANCE,
    baseCurrency: 'USDT',
    quoteCurrency: 'VND',
    rate,
    observedAt,
    mode,
    requestedExecutedAt,
    issuedAt
  };
}

function accountingRateQuoteSignature(encodedClaims, secret) {
  return createHmac('sha256', secret).update(encodedClaims, 'utf8').digest();
}

/**
 * Issues a compact, canonical HMAC proof for an available direct CoinGecko
 * USDT/VND observation. Decimal claims are signed as canonical strings.
 */
export function issueAccountingRateQuoteProof(result, {
  secret = process.env.ACCOUNTING_RATE_QUOTE_SECRET,
  now = new Date()
} = {}) {
  if (!isAccountingRateQuoteSecretConfigured(secret) || result?.availability !== 'available') {
    return null;
  }

  const claims = canonicalizeAccountingRateQuoteClaims({
    version: ACCOUNTING_RATE_QUOTE_VERSION,
    provider: result.provider,
    provenance: result.provenance,
    baseCurrency: result.baseCurrency,
    quoteCurrency: result.quoteCurrency,
    rate: result.rate,
    observedAt: result.observedAt,
    mode: result.mode,
    requestedExecutedAt: result.mode === 'HISTORICAL' ? result.requestedAt : null,
    issuedAt: now
  });
  if (!claims) return null;

  const encodedClaims = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signature = accountingRateQuoteSignature(encodedClaims, secret).toString('base64url');
  return `${encodedClaims}.${signature}`;
}

export function attachAccountingRateQuoteProof(result, options = {}) {
  if (result?.availability !== 'available') {
    return { ...result, quoteProof: null };
  }

  if (!isCoinGeckoAccountingRateEnabled(options.enabled)) {
    return {
      ...result,
      availability: 'unavailable',
      rate: null,
      provenance: null,
      quoteProof: null,
      reason: 'PROVIDER_NOT_ENABLED'
    };
  }

  const quoteProof = issueAccountingRateQuoteProof(result, options);
  if (!quoteProof) {
    return {
      ...result,
      availability: 'unavailable',
      rate: null,
      provenance: null,
      quoteProof: null,
      reason: 'QUOTE_PROOF_UNAVAILABLE'
    };
  }

  return { ...result, quoteProof };
}

export function verifyAccountingRateQuoteProof(quoteProof, {
  secret = process.env.ACCOUNTING_RATE_QUOTE_SECRET
} = {}) {
  if (!isAccountingRateQuoteSecretConfigured(secret)) {
    return { valid: false, reason: 'QUOTE_SECRET_NOT_CONFIGURED', claims: null };
  }
  if (
    typeof quoteProof !== 'string'
    || quoteProof.length === 0
    || quoteProof.length > ACCOUNTING_RATE_QUOTE_PROOF_MAX_LENGTH
  ) {
    return { valid: false, reason: 'QUOTE_PROOF_REQUIRED', claims: null };
  }

  const parts = quoteProof.split('.');
  if (
    parts.length !== 2
    || !parts[0]
    || !parts[1]
    || !/^[A-Za-z0-9_-]+$/.test(parts[0])
    || !/^[A-Za-z0-9_-]+$/.test(parts[1])
  ) {
    return { valid: false, reason: 'QUOTE_PROOF_MALFORMED', claims: null };
  }

  try {
    const suppliedSignature = Buffer.from(parts[1], 'base64url');
    const expectedSignature = accountingRateQuoteSignature(parts[0], secret);
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return { valid: false, reason: 'QUOTE_PROOF_SIGNATURE_INVALID', claims: null };
    }

    const serializedClaims = Buffer.from(parts[0], 'base64url').toString('utf8');
    const parsedClaims = JSON.parse(serializedClaims);
    const claims = canonicalizeAccountingRateQuoteClaims(parsedClaims);
    if (!claims || JSON.stringify(claims) !== serializedClaims) {
      return { valid: false, reason: 'QUOTE_PROOF_CLAIMS_INVALID', claims: null };
    }

    return { valid: true, reason: null, claims };
  } catch {
    return { valid: false, reason: 'QUOTE_PROOF_MALFORMED', claims: null };
  }
}

/**
 * Validates the client-carried fields for the server-authoritative CoinGecko
 * provenance before an RPC write. The feature flag is intentionally enforced
 * here as well as on the read-only resolver endpoint.
 */
export function validateCoinGeckoAccountingRateWrite({
  price,
  executionUnitPrice,
  priceCurrency,
  settlementMode,
  fxRateToVnd,
  fxProvenance,
  fxObservedAt,
  executedAt,
  quoteProof
} = {}, {
  enabled,
  secret = process.env.ACCOUNTING_RATE_QUOTE_SECRET,
  now = new Date(),
  allowExpiredCurrentObservation = false
} = {}) {
  const errors = [];

  if (!isCoinGeckoAccountingRateEnabled(enabled)) {
    errors.push('COINGECKO_USDT_VND provenance is unavailable while automatic accounting rates are disabled');
  }
  if (normalizeCurrency(priceCurrency) !== 'USDT') {
    errors.push('COINGECKO_USDT_VND provenance requires priceCurrency USDT');
  }
  if (typeof settlementMode !== 'string' || settlementMode.trim().toUpperCase() !== 'EXTERNAL_SETTLEMENT') {
    errors.push('COINGECKO_USDT_VND provenance requires EXTERNAL_SETTLEMENT');
  }

  const executionPrice = positiveFiniteNumber(executionUnitPrice);
  const rate = positiveFiniteNumber(fxRateToVnd);
  const accountingPrice = positiveFiniteNumber(price);
  if (executionPrice === null || rate === null || accountingPrice === null) {
    errors.push('COINGECKO_USDT_VND provenance requires positive executionUnitPrice, fxRateToVnd, and price');
  } else {
    const expectedAccountingPrice = executionPrice * rate;
    const difference = Math.abs(accountingPrice - expectedAccountingPrice);
    if (difference > ACCOUNTING_PRICE_ABSOLUTE_TOLERANCE_VND) {
      errors.push('price must match executionUnitPrice multiplied by fxRateToVnd for COINGECKO_USDT_VND provenance');
    }
  }

  if (!normalizeDate(fxObservedAt)) {
    errors.push('COINGECKO_USDT_VND provenance requires a valid provider fxObservedAt timestamp');
  }

  if (!isAccountingRateQuoteSecretConfigured(secret)) {
    errors.push('automatic accounting quote signing is not configured');
    return errors;
  }

  const verification = verifyAccountingRateQuoteProof(quoteProof, { secret });
  if (!verification.valid) {
    errors.push(`quoteProof is invalid: ${verification.reason}`);
    return errors;
  }

  const { claims } = verification;
  const submittedRate = canonicalPositiveDecimal(fxRateToVnd);
  const submittedObservedAt = canonicalTimestamp(fxObservedAt);
  const submittedExecutedAt = executedAt === undefined || executedAt === null
    ? null
    : canonicalTimestamp(executedAt);
  const nowDate = normalizeDate(now);

  if (claims.provenance !== fxProvenance) {
    errors.push('quoteProof provenance does not match submitted fxProvenance');
  }
  if (claims.rate !== submittedRate) {
    errors.push('quoteProof rate does not match submitted fxRateToVnd');
  }
  if (claims.observedAt !== submittedObservedAt) {
    errors.push('quoteProof observedAt does not match submitted fxObservedAt');
  }
  if (!nowDate) {
    errors.push('automatic accounting quote verification time is invalid');
    return errors;
  }

  const observedMs = Date.parse(claims.observedAt);
  const issuedMs = Date.parse(claims.issuedAt);
  if (issuedMs > nowDate.getTime()) {
    errors.push('quoteProof issuedAt cannot be in the future');
  }

  if (claims.mode === 'CURRENT') {
    if (submittedExecutedAt !== null) {
      errors.push('CURRENT quoteProof cannot be used with an explicit executedAt');
    }
    const ageMs = nowDate.getTime() - observedMs;
    if (
      ageMs < 0
      || (ageMs > CURRENT_ACCOUNTING_RATE_MAX_AGE_MS && allowExpiredCurrentObservation !== true)
    ) {
      errors.push('CURRENT quoteProof observation is stale or invalid');
    }
  } else if (claims.mode === 'HISTORICAL') {
    if (submittedExecutedAt === null || claims.requestedExecutedAt !== submittedExecutedAt) {
      errors.push('HISTORICAL quoteProof does not match submitted executedAt');
    } else {
      const deltaMs = Math.abs(observedMs - Date.parse(submittedExecutedAt));
      if (deltaMs > HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS) {
        errors.push('HISTORICAL quoteProof observation is more than 60 minutes from executedAt');
      }
    }
  }

  return errors;
}

function resultBase({
  baseCurrency,
  quoteCurrency,
  requestedAt,
  mode,
  availability = 'unavailable',
  rate = null,
  observedAt = null,
  observationDeltaMs = null,
  reason = null,
  includeProvider = true
}) {
  return {
    availability,
    baseCurrency,
    quoteCurrency,
    rate,
    provider: includeProvider ? 'CoinGecko' : null,
    provenance: includeProvider ? USDT_VND_ACCOUNTING_PROVENANCE : null,
    observedAt,
    requestedAt,
    observationDeltaMs,
    mode,
    reason
  };
}

function safeProviderReason(error) {
  return [
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_TIMEOUT',
    'MALFORMED_PROVIDER_RESPONSE',
    'PROVIDER_ACCESS_DENIED',
    'HISTORICAL_DATA_UNAVAILABLE'
  ].includes(error?.code)
    ? error.code
    : 'PROVIDER_UNAVAILABLE';
}

/**
 * Resolves one governed direct provider-output accounting rate. This resolver
 * never mutates Portfolio state and never derives USDT through USD.
 */
export async function getAccountingRate({
  baseCurrency,
  quoteCurrency,
  at
} = {}, options = {}) {
  const base = normalizeCurrency(baseCurrency);
  const quote = normalizeCurrency(quoteCurrency);
  const now = normalizeDate(options.now ?? new Date());
  const requestedDate = at === undefined || at === null
    ? now
    : normalizeDate(at);
  const mode = at === undefined || at === null ? 'CURRENT' : 'HISTORICAL';
  const requestedAt = requestedDate?.toISOString() ?? null;

  if (!now || !requestedDate) {
    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      reason: 'INVALID_REQUEST_TIME',
      includeProvider: false
    });
  }

  if (base !== 'USDT' || quote !== 'VND') {
    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      reason: 'PAIR_UNSUPPORTED',
      includeProvider: false
    });
  }

  if (!isCoinGeckoAccountingRateEnabled(options.enabled)) {
    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      reason: 'PROVIDER_NOT_ENABLED'
    });
  }

  const getCurrentObservationFn = options.getCurrentObservationFn
    || getCoinGeckoCurrentUsdtVndObservation;
  const getHistoricalObservationsFn = options.getHistoricalObservationsFn
    || getCoinGeckoHistoricalUsdtVndObservations;

  try {
    if (mode === 'CURRENT') {
      const observation = await getCurrentObservationFn({
        fetchFn: options.fetchFn,
        apiKey: options.apiKey
      });
      const observationRate = typeof observation?.rate === 'number'
        && Number.isFinite(observation.rate)
        && observation.rate > 0
        ? observation.rate
        : null;
      const observedMs = Date.parse(observation?.observedAt);
      if (observationRate === null || !Number.isFinite(observedMs)) {
        return resultBase({
          baseCurrency: base,
          quoteCurrency: quote,
          requestedAt,
          mode,
          reason: observationRate === null
            ? 'MALFORMED_PROVIDER_RESPONSE'
            : 'OBSERVATION_TIMESTAMP_INVALID'
        });
      }

      const ageMs = now.getTime() - observedMs;
      if (ageMs < 0) {
        return resultBase({
          baseCurrency: base,
          quoteCurrency: quote,
          requestedAt,
          mode,
          observedAt: observation.observedAt,
          observationDeltaMs: Math.abs(ageMs),
          reason: 'OBSERVATION_TIMESTAMP_INVALID'
        });
      }
      if (ageMs > CURRENT_ACCOUNTING_RATE_MAX_AGE_MS) {
        return resultBase({
          baseCurrency: base,
          quoteCurrency: quote,
          requestedAt,
          mode,
          availability: 'stale',
          observedAt: observation.observedAt,
          observationDeltaMs: ageMs,
          reason: 'OBSERVATION_STALE'
        });
      }

      return resultBase({
        baseCurrency: base,
        quoteCurrency: quote,
        requestedAt,
        mode,
        availability: 'available',
        rate: observationRate,
        observedAt: observation.observedAt,
        observationDeltaMs: ageMs
      });
    }

    const requestedMs = requestedDate.getTime();
    const observations = await getHistoricalObservationsFn({
      fromMs: requestedMs - HISTORICAL_QUERY_PADDING_MS,
      toMs: requestedMs + HISTORICAL_QUERY_PADDING_MS
    }, {
      fetchFn: options.fetchFn,
      apiKey: options.apiKey
    });

    const nearest = observations
      .map((observation) => ({
        ...observation,
        observedMs: Date.parse(observation?.observedAt)
      }))
      .filter((observation) => (
        typeof observation.rate === 'number'
        && Number.isFinite(observation.rate)
        && observation.rate > 0
        && Number.isFinite(observation.observedMs)
      ))
      .sort((left, right) => {
        const leftDelta = Math.abs(left.observedMs - requestedMs);
        const rightDelta = Math.abs(right.observedMs - requestedMs);
        return leftDelta - rightDelta || left.observedMs - right.observedMs;
      })[0];

    if (!nearest) {
      return resultBase({
        baseCurrency: base,
        quoteCurrency: quote,
        requestedAt,
        mode,
        reason: 'NO_HISTORICAL_OBSERVATION'
      });
    }

    const deltaMs = Math.abs(nearest.observedMs - requestedMs);
    if (deltaMs > HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS) {
      return resultBase({
        baseCurrency: base,
        quoteCurrency: quote,
        requestedAt,
        mode,
        observedAt: nearest.observedAt,
        observationDeltaMs: deltaMs,
        reason: 'OBSERVATION_TOO_DISTANT'
      });
    }

    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      availability: 'available',
      rate: nearest.rate,
      observedAt: nearest.observedAt,
      observationDeltaMs: deltaMs
    });
  } catch (error) {
    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      reason: safeProviderReason(error)
    });
  }
}
