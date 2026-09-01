/**
 * Feature 12: Price Alerts Evaluation Engine
 * Pure deterministic evaluation functions for one-shot price alerts against delayed market snapshots.
 */

export const ALLOWED_ALERT_DIRECTIONS = ['above', 'below'];
export const ALLOWED_ALERT_STATUSES = ['active', 'triggered'];

export const ALERT_DIRECTION_LABELS = {
  above: 'Giá đạt hoặc vượt',
  below: 'Giá giảm xuống hoặc thấp hơn'
};

export const ALERT_STATUS_LABELS = {
  active: 'Đang hoạt động',
  triggered: 'Đã kích hoạt'
};

export function isStaleAlertSnapshot(snapshot) {
  return snapshot?.freshness === 'stale' || snapshot?.cacheStatus === 'stale';
}

/**
 * Validates if direction is a supported alert condition ('above' | 'below').
 */
export function isValidAlertDirection(direction) {
  return typeof direction === 'string' && ALLOWED_ALERT_DIRECTIONS.includes(direction.trim().toLowerCase());
}

/**
 * Normalizes an alert condition into Vietnamese descriptive label.
 */
export function formatAlertCondition(direction) {
  if (!direction) return 'Không xác định';
  return ALERT_DIRECTION_LABELS[direction.trim().toLowerCase()] || direction;
}

/**
 * Evaluates a single alert against a market snapshot.
 *
 * Invariants:
 * 1. Alerts are strictly ONE-SHOT: already-triggered alerts are not re-triggered.
 * 2. Usable market price follows standard market validation: finite, positive number > 0.
 * 3. Unavailable price leaves alert in 'active' state without fake triggering or 0-comparison.
 * 4. 'above' triggers iff validPrice >= targetPrice.
 * 5. 'below' triggers iff validPrice <= targetPrice.
 * 6. triggered_at records evaluation timestamp.
 *
 * @param {Object} alert - Alert record
 * @param {Object} snapshot - Delayed market snapshot { price, updatedAt, ... }
 * @param {Object} options - { now: Date }
 * @returns {Object} Evaluation outcome { alert, triggered, evaluated, status, evaluatedPrice, evaluatedAt, reason }
 */
export function evaluateSingleAlert(alert, snapshot, options = {}) {
  if (!alert || typeof alert !== 'object') {
    throw new TypeError('Alert object is required for evaluation');
  }

  const now = options.now instanceof Date && !isNaN(options.now.getTime())
    ? options.now
    : new Date();
  const nowIso = now.toISOString();

  // If already triggered, preserve state without re-evaluating
  if (alert.status === 'triggered') {
    return {
      alert,
      triggered: false,
      evaluated: false,
      status: 'triggered',
      evaluatedPrice: alert.last_evaluated_price !== undefined ? alert.last_evaluated_price : null,
      evaluatedAt: alert.last_evaluated_at || null,
      reason: 'already_triggered'
    };
  }

  const targetPrice = typeof alert.target_price === 'number'
    ? alert.target_price
    : Number(alert.target_price);

  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    return {
      alert,
      triggered: false,
      evaluated: false,
      status: 'invalid_target',
      evaluatedPrice: null,
      evaluatedAt: null,
      reason: 'invalid_target_price'
    };
  }

  // Validate market snapshot price
  const validPrice = snapshot && typeof snapshot === 'object' && typeof snapshot.price === 'number' && Number.isFinite(snapshot.price) && snapshot.price > 0
    ? snapshot.price
    : null;

  // A stale last-good observation remains useful for display, but it must never
  // produce a new one-shot trigger because the threshold crossing time is unknown.
  if (validPrice !== null && isStaleAlertSnapshot(snapshot)) {
    return {
      alert,
      triggered: false,
      evaluated: false,
      status: 'stale',
      evaluatedPrice: validPrice,
      evaluatedAt: nowIso,
      reason: 'market_price_stale'
    };
  }

  // Unavailable price -> remains active, no fake trigger
  if (validPrice === null) {
    return {
      alert,
      triggered: false,
      evaluated: false,
      status: 'unavailable',
      evaluatedPrice: null,
      evaluatedAt: nowIso,
      reason: 'market_price_unavailable'
    };
  }

  const direction = (alert.direction || '').trim().toLowerCase();
  let shouldTrigger = false;

  if (direction === 'above') {
    shouldTrigger = validPrice >= targetPrice;
  } else if (direction === 'below') {
    shouldTrigger = validPrice <= targetPrice;
  } else {
    return {
      alert,
      triggered: false,
      evaluated: false,
      status: 'invalid_direction',
      evaluatedPrice: validPrice,
      evaluatedAt: nowIso,
      reason: `unsupported_direction_${direction}`
    };
  }

  if (shouldTrigger) {
    const updatedAlert = {
      ...alert,
      status: 'triggered',
      last_evaluated_price: validPrice,
      last_evaluated_at: nowIso,
      triggered_at: nowIso
    };

    return {
      alert: updatedAlert,
      triggered: true,
      evaluated: true,
      status: 'triggered',
      evaluatedPrice: validPrice,
      evaluatedAt: nowIso,
      reason: null
    };
  }

  // Evaluated but condition not yet met
  const updatedAlert = {
    ...alert,
    status: 'active',
    last_evaluated_price: validPrice,
    last_evaluated_at: nowIso
  };

  return {
    alert: updatedAlert,
    triggered: false,
    evaluated: true,
    status: 'active',
    evaluatedPrice: validPrice,
    evaluatedAt: nowIso,
    reason: null
  };
}

/**
 * Evaluates a list of alerts against a map of market snapshots by symbol.
 * Provides failure isolation across assets.
 *
 * @param {Array<Object>} alerts - Array of alert records
 * @param {Object} marketSnapshotsMap - Map of { [symbol]: snapshot }
 * @param {Object} options - { now: Date }
 * @returns {Object} Summary { evaluatedCount, triggeredCount, unavailableCount, results, updatedAlerts }
 */
export function evaluateAlertsBatch(alerts, marketSnapshotsMap = {}, options = {}) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return {
      evaluatedCount: 0,
      triggeredCount: 0,
      unavailableCount: 0,
      staleCount: 0,
      results: [],
      updatedAlerts: []
    };
  }

  let evaluatedCount = 0;
  let triggeredCount = 0;
  let unavailableCount = 0;
  let staleCount = 0;

  const results = [];
  const updatedAlerts = [];

  for (const alert of alerts) {
    const sym = alert.asset?.symbol || alert.symbol;
    const snapshot = sym ? marketSnapshotsMap[sym] : null;

    const outcome = evaluateSingleAlert(alert, snapshot, options);
    results.push(outcome);
    updatedAlerts.push(outcome.alert);

    if (outcome.evaluated) {
      evaluatedCount++;
    }
    if (outcome.triggered) {
      triggeredCount++;
    }
    if (['unavailable', 'stale'].includes(outcome.status) && alert.status === 'active') {
      unavailableCount++;
    }
    if (outcome.status === 'stale' && alert.status === 'active') {
      staleCount++;
    }
  }

  return {
    evaluatedCount,
    triggeredCount,
    unavailableCount,
    staleCount,
    results,
    updatedAlerts
  };
}
