/**
 * Timestamp validation and ISO-8601 UTC normalization.
 */

const ALPHA_VANTAGE_TIME_REGEX = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE_INDICATOR_REGEX = /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC|EST|EDT|CST|CDT|MST|MDT|PST|PDT)$/i;

/**
 * Validates and normalizes an article publication timestamp into an ISO-8601 UTC string.
 * Rejects missing, invalid, date-only, and timezone-ambiguous timestamps.
 * @param {string|number|Date} rawTime
 * @returns {string|null} ISO-8601 UTC string or null if rejected
 */
export function normalizePublishedAt(rawTime) {
  if (!rawTime && rawTime !== 0) {
    return null;
  }

  // Alpha Vantage compact UTC format e.g. 20260828T191032
  if (typeof rawTime === 'string') {
    const avMatch = rawTime.trim().match(ALPHA_VANTAGE_TIME_REGEX);
    if (avMatch) {
      const [_, year, month, day, hour, min, sec] = avMatch;
      const seconds = sec || '00';
      const isoStr = `${year}-${month}-${day}T${hour}:${min}:${seconds}Z`;
      const d = new Date(isoStr);
      if (!isNaN(d.getTime())) {
        return d.toISOString();
      }
    }
  }

  const str = String(rawTime).trim();

  // Reject date-only without time
  if (DATE_ONLY_REGEX.test(str)) {
    return null;
  }

  // If string has 'T' (ISO format), ensure it has a timezone indicator (Z or offset)
  if (str.includes('T')) {
    if (!TIMEZONE_INDICATOR_REGEX.test(str)) {
      return null;
    }
  } else {
    // If it's a date-time string without 'T' (like RFC 2822 or custom), check for explicit timezone
    if (!TIMEZONE_INDICATOR_REGEX.test(str)) {
      return null;
    }
  }

  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) {
      return null;
    }
    return d.toISOString();
  } catch {
    return null;
  }
}

