import { createHash, timingSafeEqual } from 'node:crypto';

export const PRIVATE_API_PREFIXES = Object.freeze([
  '/api/owner',
  '/api/profile',
  '/api/holdings',
  '/api/positions',
  '/api/transactions',
  '/api/cash',
  '/api/news/personalized',
  '/api/opportunities',
  '/api/investment-brief',
  '/api/portfolio',
  '/api/watchlist',
  '/api/alerts'
]);

export const MIN_OWNER_ACCESS_TOKEN_LENGTH = 32;
export const MIN_ALERT_SCHEDULER_TOKEN_LENGTH = 32;

export function isPrivateApiPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  return PRIVATE_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function tokenDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function ownerTokensMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !candidate || !expected) {
    return false;
  }
  return timingSafeEqual(tokenDigest(candidate), tokenDigest(expected));
}

export function readBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/i.exec(headerValue.trim());
  return match ? match[1] : null;
}

function authFailure(res, status, code, message) {
  res.set('Cache-Control', 'no-store');
  if (status === 401) res.set('WWW-Authenticate', 'Bearer');
  return res.status(status).json({
    status: 'error',
    code,
    message
  });
}

export function createOwnerAuthMiddleware({ ownerAccessToken } = {}) {
  const configuredToken = typeof ownerAccessToken === 'string' && ownerAccessToken.length >= MIN_OWNER_ACCESS_TOKEN_LENGTH
    ? ownerAccessToken
    : null;

  return function requireOwner(req, res, next) {
    if (!isPrivateApiPath(req.path)) return next();

    if (!configuredToken) {
      return authFailure(
        res,
        503,
        'OWNER_AUTH_NOT_CONFIGURED',
        'Private API access is unavailable'
      );
    }

    const candidate = readBearerToken(req.get('authorization'));
    if (!candidate) {
      return authFailure(res, 401, 'OWNER_AUTH_REQUIRED', 'Owner authentication is required');
    }

    if (!ownerTokensMatch(candidate, configuredToken)) {
      return authFailure(res, 403, 'OWNER_AUTH_INVALID', 'Owner authentication failed');
    }

    return next();
  };
}

export function createAlertSchedulerAuthMiddleware({ alertSchedulerToken } = {}) {
  const configuredToken = typeof alertSchedulerToken === 'string' &&
    alertSchedulerToken.length >= MIN_ALERT_SCHEDULER_TOKEN_LENGTH
    ? alertSchedulerToken
    : null;

  return function requireAlertScheduler(req, res, next) {
    if (!configuredToken) {
      return authFailure(
        res,
        503,
        'ALERT_SCHEDULER_NOT_CONFIGURED',
        'Background alert evaluation is unavailable'
      );
    }

    const candidate = readBearerToken(req.get('authorization'));
    if (!candidate) {
      return authFailure(
        res,
        401,
        'ALERT_SCHEDULER_AUTH_REQUIRED',
        'Alert scheduler authentication is required'
      );
    }

    if (!ownerTokensMatch(candidate, configuredToken)) {
      return authFailure(
        res,
        403,
        'ALERT_SCHEDULER_AUTH_INVALID',
        'Alert scheduler authentication failed'
      );
    }

    return next();
  };
}
