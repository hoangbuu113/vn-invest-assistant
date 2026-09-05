/**
 * Freshness Policy Engine for Vietnam Context Data Fabric.
 *
 * Implements metric cadence-aware freshness rules:
 * - MONTHLY_MACRO (CPI): Valid through expected monthly publication cycle (~45 days from reference month end).
 * - QUARTERLY_MACRO (GDP): Valid through quarterly cadence (~105 days).
 * - DAILY_VN_EQUITY (VN-Index, VN30, HNX): Friday close remains valid through the weekend until next completed session (Monday 15:00 ICT + grace).
 * - DAILY_MONETARY (SBV Overnight Rate): Same daily session cadence.
 * - CURRENT_MARKET_FX (USD/VND, DXY, Brent, Gold Spot, US10Y): Shorter intraday/daily market freshness (~48 hours).
 *
 * Invariants:
 * 1. Cold DB reads dynamically re-evaluate freshness based on stored timestamps, policy, and current time.
 * 2. Stale is never frozen permanently into immutable DB quality records.
 * 3. Pure function: does not mutate observation identity or provenance.
 */

import { normalizeReferencePeriodKey } from './factModel.js';

export const CADENCE_POLICIES = Object.freeze({
  MONTHLY_MACRO: 'MONTHLY_MACRO',
  NSO_MONTHLY_RELEASE: 'NSO_MONTHLY_RELEASE',
  QUARTERLY_MACRO: 'QUARTERLY_MACRO',
  NSO_QUARTERLY_RELEASE: 'NSO_QUARTERLY_RELEASE',
  WEEKLY_MONETARY: 'WEEKLY_MONETARY',
  DAILY_VN_EQUITY: 'DAILY_VN_EQUITY',
  DAILY_MONETARY: 'DAILY_MONETARY',
  CURRENT_MARKET_FX: 'CURRENT_MARKET_FX',
  SBV_EFFECTIVE_FX: 'SBV_EFFECTIVE_FX',
  SBV_INTERBANK_LAGGED: 'SBV_INTERBANK_LAGGED',
  SBV_MONTHLY_LAGGED: 'SBV_MONTHLY_LAGGED'
});

export const FACT_POLICY_MAP = Object.freeze({
  'vn.macro.cpi.yoy': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'macro.cpi_yoy': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'vn.macro.core_cpi.yoy': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'macro.core_cpi_yoy': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'vn.macro.gdp.real.quarter_yoy': CADENCE_POLICIES.NSO_QUARTERLY_RELEASE,
  'macro.gdp_quarter_yoy': CADENCE_POLICIES.NSO_QUARTERLY_RELEASE,
  'vn.macro.gdp.growth_rate': CADENCE_POLICIES.NSO_QUARTERLY_RELEASE,
  'macro.gdp_growth': CADENCE_POLICIES.NSO_QUARTERLY_RELEASE,
  'vn.macro.iip.month_yoy': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'macro.iip_month_yoy': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'vn.macro.retail.nominal.month_yoy': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'macro.retail_nominal_month_yoy': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'vn.macro.fdi.disbursed.ytd_usd': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'macro.fdi_disbursed_ytd_usd': CADENCE_POLICIES.NSO_MONTHLY_RELEASE,
  'vn.monetary.fx.sbv_central.usd_vnd': CADENCE_POLICIES.SBV_EFFECTIVE_FX,
  'monetary.sbv_central_usd_vnd': CADENCE_POLICIES.SBV_EFFECTIVE_FX,
  'vn.monetary.rate.sbv_ref_rate': CADENCE_POLICIES.SBV_EFFECTIVE_FX,
  'vn.monetary.interbank.vnd.overnight.daily_avg_rate': CADENCE_POLICIES.SBV_INTERBANK_LAGGED,
  'monetary.vnd_overnight_daily_avg_rate': CADENCE_POLICIES.SBV_INTERBANK_LAGGED,
  'vn.monetary.credit.outstanding.ytd_growth': CADENCE_POLICIES.SBV_MONTHLY_LAGGED,
  'monetary.credit_ytd_growth': CADENCE_POLICIES.SBV_MONTHLY_LAGGED,
  'vn.monetary.money_supply.m2.level': CADENCE_POLICIES.SBV_MONTHLY_LAGGED,
  'monetary.m2_level': CADENCE_POLICIES.SBV_MONTHLY_LAGGED,
  'vn.monetary.rate.vnd_overnight': CADENCE_POLICIES.WEEKLY_MONETARY,
  'monetary.vnd_overnight_rate': CADENCE_POLICIES.WEEKLY_MONETARY,
  'vn.monetary.fx.usd_vnd': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'monetary.usd_vnd': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'vn.market.vnindex.close': CADENCE_POLICIES.DAILY_VN_EQUITY,
  'market.vnindex': CADENCE_POLICIES.DAILY_VN_EQUITY,
  'vn.market.vn30.close': CADENCE_POLICIES.DAILY_VN_EQUITY,
  'market.vn30': CADENCE_POLICIES.DAILY_VN_EQUITY,
  'vn.market.hnx.close': CADENCE_POLICIES.DAILY_VN_EQUITY,
  'market.hnx': CADENCE_POLICIES.DAILY_VN_EQUITY,
  'global.intermarket.dxy.quote': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'intermarket.dxy': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'global.intermarket.us10y.yield': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'intermarket.us10y': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'global.intermarket.brent.futures': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'intermarket.brent': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'global.intermarket.gold_futures.price': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'intermarket.gold_futures': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'global.intermarket.gold_spot.price': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'intermarket.gold_spot': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'global.intermarket.fx.usd_cny': CADENCE_POLICIES.CURRENT_MARKET_FX,
  'intermarket.usd_cny': CADENCE_POLICIES.CURRENT_MARKET_FX
});

function parseObservationTimestamp(obs) {
  if (!obs) return null;
  // Source time semantics: Use actual publishedAt or observedAt, never substitute fetchedAt as source time
  const raw = obs.publishedAt || obs.observedAt;
  if (raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  if (obs.referenceTime) {
    const refKey = normalizeReferencePeriodKey(obs.referenceTime);
    const ms = Date.parse(refKey);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function getVietnamDayOfWeek(d) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' }).format(d);
}

/**
 * Evaluates the runtime freshness of an observation based on its cadence policy and current time.
 * Pure function: does not mutate the observation.
 */
export function evaluateObservationFreshness(obs, now = new Date()) {
  if (!obs || obs.value === null || obs.status === 'unavailable') {
    return { freshness: 'delayed', isStale: false, status: 'unavailable', reason: 'NO_VALUE' };
  }

  const factId = obs.factId || obs.id;
  const policy = FACT_POLICY_MAP[factId] || CADENCE_POLICIES.CURRENT_MARKET_FX;
  const nowMs = now.getTime();
  const obsTimeMs = parseObservationTimestamp(obs);

  switch (policy) {
    case CADENCE_POLICIES.MONTHLY_MACRO:
    case CADENCE_POLICIES.NSO_MONTHLY_RELEASE: {
      if (typeof obs.referenceTime === 'string' && /^\d{4}-\d{2}$/.test(obs.referenceTime)) {
        const [yearStr, monthStr] = obs.referenceTime.split('-');
        const refYear = Number(yearStr);
        const refMonth = Number(monthStr); // 1-12
        const refEndMs = new Date(Date.UTC(refYear, refMonth, 0, 23, 59, 59)).getTime();
        const ageFromRefEndDays = (nowMs - refEndMs) / (24 * 3600 * 1000);
        if (ageFromRefEndDays > 45) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'MONTHLY_CADENCE_EXPIRED' };
        }
        return { freshness: 'fresh', isStale: false, status: 'available', policy };
      }
      if (typeof obs.referenceTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obs.referenceTime)) {
        const refKey = normalizeReferencePeriodKey(obs.referenceTime);
        const refMs = Date.parse(refKey);
        if (Number.isFinite(refMs)) {
          const ageDays = (nowMs - refMs) / (24 * 3600 * 1000);
          if (ageDays > 45) {
            return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'MONTHLY_CADENCE_EXPIRED' };
          }
          return { freshness: 'fresh', isStale: false, status: 'available', policy };
        }
      }
      if (obsTimeMs) {
        const ageDays = (nowMs - obsTimeMs) / (24 * 3600 * 1000);
        if (ageDays > 45) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'MONTHLY_AGE_EXCEEDED' };
        }
      }
      return { freshness: 'fresh', isStale: false, status: 'available', policy };
    }

    case CADENCE_POLICIES.QUARTERLY_MACRO:
    case CADENCE_POLICIES.NSO_QUARTERLY_RELEASE: {
      if (typeof obs.referenceTime === 'string' && /^(\d{4})-Q([1-4])$/i.test(obs.referenceTime)) {
        const refKey = normalizeReferencePeriodKey(obs.referenceTime);
        const refEndMs = Date.parse(refKey);
        if (Number.isFinite(refEndMs)) {
          const ageDays = (nowMs - refEndMs) / (24 * 3600 * 1000);
          if (ageDays > 105) {
            return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'QUARTERLY_CADENCE_EXPIRED' };
          }
          return { freshness: 'fresh', isStale: false, status: 'available', policy };
        }
      }
      if (obsTimeMs) {
        const ageDays = (nowMs - obsTimeMs) / (24 * 3600 * 1000);
        if (ageDays > 105) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'QUARTERLY_AGE_EXCEEDED' };
        }
      }
      return { freshness: 'fresh', isStale: false, status: 'available', policy };
    }

    case CADENCE_POLICIES.SBV_EFFECTIVE_FX: {
      const sessionDateStr = typeof obs.referenceTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obs.referenceTime)
        ? obs.referenceTime
        : (obsTimeMs ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(obsTimeMs)) : null);

      if (sessionDateStr) {
        const [y, m, d] = sessionDateStr.split('-').map(Number);
        const effectiveEndUtc = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
        // Grace period: 48 hours from end of effective date
        const deadlineMs = effectiveEndUtc.getTime() + (48 * 3600 * 1000);
        if (nowMs > deadlineMs) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'SBV_FX_CADENCE_EXPIRED' };
        }
        return { freshness: 'fresh', isStale: false, status: 'available', policy };
      }

      if (obsTimeMs) {
        const ageHours = (nowMs - obsTimeMs) / (3600 * 1000);
        if (ageHours > 48) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'SBV_FX_AGE_EXCEEDED' };
        }
      }
      return { freshness: 'fresh', isStale: false, status: 'available', policy };
    }

    case CADENCE_POLICIES.SBV_INTERBANK_LAGGED: {
      const sessionDateStr = typeof obs.referenceTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obs.referenceTime)
        ? obs.referenceTime
        : (obsTimeMs ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(obsTimeMs)) : null);

      if (sessionDateStr) {
        const [y, m, d] = sessionDateStr.split('-').map(Number);
        const sessionDateUtc = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
        // Grace period: 72 hours from end of reference date
        const deadlineMs = sessionDateUtc.getTime() + (72 * 3600 * 1000);
        if (nowMs > deadlineMs) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'SBV_INTERBANK_CADENCE_EXPIRED' };
        }
        return { freshness: 'fresh', isStale: false, status: 'available', policy };
      }

      if (obsTimeMs) {
        const ageHours = (nowMs - obsTimeMs) / (3600 * 1000);
        if (ageHours > 72) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'SBV_INTERBANK_AGE_EXCEEDED' };
        }
      }
      return { freshness: 'fresh', isStale: false, status: 'available', policy };
    }

    case CADENCE_POLICIES.SBV_MONTHLY_LAGGED: {
      if (typeof obs.referenceTime === 'string' && /^\d{4}-\d{2}$/.test(obs.referenceTime)) {
        const [yearStr, monthStr] = obs.referenceTime.split('-');
        const refYear = Number(yearStr);
        const refMonth = Number(monthStr);
        const refEndMs = new Date(Date.UTC(refYear, refMonth, 0, 23, 59, 59)).getTime();
        const ageDays = (nowMs - refEndMs) / (24 * 3600 * 1000);
        if (ageDays > 90) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'SBV_MONTHLY_CADENCE_EXPIRED' };
        }
        return { freshness: 'fresh', isStale: false, status: 'available', policy };
      }
      if (obsTimeMs) {
        const ageDays = (nowMs - obsTimeMs) / (24 * 3600 * 1000);
        if (ageDays > 90) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'SBV_MONTHLY_AGE_EXCEEDED' };
        }
      }
      return { freshness: 'fresh', isStale: false, status: 'available', policy };
    }

    case CADENCE_POLICIES.WEEKLY_MONETARY: {
      const refWeekStr = typeof obs.referenceTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obs.referenceTime)
        ? obs.referenceTime
        : (obsTimeMs ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(obsTimeMs)) : null);

      if (refWeekStr) {
        const [y, m, d] = refWeekStr.split('-').map(Number);
        const weekStartUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
        const deadlineMs = weekStartUtc.getTime() + (14 * 24 * 3600 * 1000);
        if (nowMs > deadlineMs) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'WEEKLY_CADENCE_EXPIRED' };
        }
        return { freshness: 'fresh', isStale: false, status: 'available', policy };
      }

      if (obsTimeMs) {
        const ageHours = (nowMs - obsTimeMs) / (3600 * 1000);
        if (ageHours > (14 * 24)) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'WEEKLY_AGE_EXCEEDED' };
        }
      }
      return { freshness: 'fresh', isStale: false, status: 'available', policy };
    }

    case CADENCE_POLICIES.DAILY_VN_EQUITY:
    case CADENCE_POLICIES.DAILY_MONETARY: {
      const sessionDateStr = typeof obs.referenceTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obs.referenceTime)
        ? obs.referenceTime
        : (obsTimeMs ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(obsTimeMs)) : null);

      if (sessionDateStr) {
        const [y, m, d] = sessionDateStr.split('-').map(Number);
        const sessionDateUtc = new Date(Date.UTC(y, m - 1, d, 8, 0, 0)); // 15:00 ICT is 08:00 UTC
        const sessionDayOfWeek = getVietnamDayOfWeek(sessionDateUtc);

        let daysUntilNextSession = 1;
        if (sessionDayOfWeek === 'Fri') {
          daysUntilNextSession = 3;
        } else if (sessionDayOfWeek === 'Sat') {
          daysUntilNextSession = 2;
        } else if (sessionDayOfWeek === 'Sun') {
          daysUntilNextSession = 1;
        }

        const nextSessionExpectedMs = sessionDateUtc.getTime() + (daysUntilNextSession * 24 * 3600 * 1000);
        // Grace period: 4 hours after next session close (19:00 ICT = 12:00 UTC)
        const deadlineMs = nextSessionExpectedMs + (4 * 3600 * 1000);

        if (nowMs > deadlineMs) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'NEXT_SESSION_PASSED' };
        }
        return { freshness: 'fresh', isStale: false, status: 'available', policy };
      }

      if (obsTimeMs) {
        const ageHours = (nowMs - obsTimeMs) / (3600 * 1000);
        if (ageHours > 72) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'DAILY_AGE_EXCEEDED' };
        }
      }
      return { freshness: 'fresh', isStale: false, status: 'available', policy };
    }

    case CADENCE_POLICIES.CURRENT_MARKET_FX:
    default: {
      if (obsTimeMs) {
        const ageHours = (nowMs - obsTimeMs) / (3600 * 1000);
        if (ageHours > 48) {
          return { freshness: 'stale', isStale: true, status: 'stale', policy, reason: 'MARKET_AGE_EXCEEDED' };
        }
      }
      return { freshness: 'fresh', isStale: false, status: 'available', policy };
    }
  }
}

/**
 * Applies runtime freshness evaluation dynamically to an observation.
 * Returns a cloned observation with updated `freshness` and `status` ('available' or 'stale').
 * Invariant: Preserves intrinsic `qualityStatus`, `observationId`, and `provenance`.
 */
export function applyRuntimeFreshness(obs, now = new Date()) {
  if (!obs || typeof obs !== 'object') return obs;
  const evalResult = evaluateObservationFreshness(obs, now);

  const updatedStatus = obs.status === 'unavailable'
    ? 'unavailable'
    : (evalResult.isStale ? 'stale' : 'available');

  return {
    ...obs,
    freshness: evalResult.freshness,
    status: updatedStatus
  };
}
