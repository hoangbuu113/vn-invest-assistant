import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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
export const OWNER_SESSION_COOKIE_NAME = 'vn_invest_owner_session';
export const OWNER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const OWNER_SESSION_VERSION = 1;
const OWNER_SESSION_SUBJECT = 'owner';
const OWNER_SESSION_SIGNING_CONTEXT = 'vn-invest-owner-session-v1';

export function isPrivateApiPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  return PRIVATE_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function tokenDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeBuffersMatch(left, right) {
  return Buffer.isBuffer(left) &&
    Buffer.isBuffer(right) &&
    left.length === right.length &&
    timingSafeEqual(left, right);
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

export function readCookie(headerValue, cookieName = OWNER_SESSION_COOKIE_NAME) {
  if (typeof headerValue !== 'string' || !headerValue || typeof cookieName !== 'string' || !cookieName) {
    return null;
  }

  for (const part of headerValue.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
    const value = part.slice(separator + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function sessionSigningKey(ownerAccessToken) {
  return createHash('sha256')
    .update(OWNER_SESSION_SIGNING_CONTEXT, 'utf8')
    .update('\0', 'utf8')
    .update(ownerAccessToken, 'utf8')
    .digest();
}

function signSessionPayload(encodedPayload, signingKey) {
  return createHmac('sha256', signingKey).update(encodedPayload, 'utf8').digest('base64url');
}

function parseSessionPayload(token, signingKey) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const expectedSignature = Buffer.from(signSessionPayload(parts[0], signingKey), 'utf8');
  const suppliedSignature = Buffer.from(parts[1], 'utf8');
  if (!safeBuffersMatch(suppliedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function createOwnerSessionManager({
  ownerAccessToken,
  ttlMs = OWNER_SESSION_TTL_MS,
  now = () => Date.now(),
  randomId = () => randomBytes(18).toString('base64url')
} = {}) {
  const configuredToken = typeof ownerAccessToken === 'string' && ownerAccessToken.length >= MIN_OWNER_ACCESS_TOKEN_LENGTH
    ? ownerAccessToken
    : null;
  const configuredTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : OWNER_SESSION_TTL_MS;
  const signingKey = configuredToken ? sessionSigningKey(configuredToken) : null;
  const revokedSessions = new Map();

  function currentTimeMs() {
    const value = now();
    return Number.isFinite(value) ? Math.floor(value) : Date.now();
  }

  function discardExpiredRevocations(currentSeconds) {
    for (const [sessionId, expiresAt] of revokedSessions) {
      if (expiresAt <= currentSeconds) revokedSessions.delete(sessionId);
    }
  }

  function verify(token) {
    if (!signingKey) return null;
    const payload = parseSessionPayload(token, signingKey);
    const currentSeconds = Math.floor(currentTimeMs() / 1000);
    discardExpiredRevocations(currentSeconds);
    if (
      payload?.v !== OWNER_SESSION_VERSION ||
      payload?.sub !== OWNER_SESSION_SUBJECT ||
      typeof payload?.jti !== 'string' ||
      !payload.jti ||
      !Number.isInteger(payload?.iat) ||
      !Number.isInteger(payload?.exp) ||
      payload.iat > currentSeconds + 60 ||
      payload.exp <= currentSeconds ||
      payload.exp <= payload.iat ||
      revokedSessions.has(payload.jti)
    ) {
      return null;
    }
    return Object.freeze({
      id: payload.jti,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString()
    });
  }

  function issue() {
    if (!signingKey) return null;
    const currentMs = currentTimeMs();
    const issuedAtSeconds = Math.floor(currentMs / 1000);
    const expiresAtSeconds = Math.floor((currentMs + configuredTtlMs) / 1000);
    const sessionId = randomId();
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Owner session identifier generation failed');
    const payload = {
      v: OWNER_SESSION_VERSION,
      sub: OWNER_SESSION_SUBJECT,
      jti: sessionId,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return Object.freeze({
      token: `${encodedPayload}.${signSessionPayload(encodedPayload, signingKey)}`,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
    });
  }

  function revoke(token) {
    if (!signingKey) return false;
    const payload = parseSessionPayload(token, signingKey);
    const currentSeconds = Math.floor(currentTimeMs() / 1000);
    if (
      payload?.v !== OWNER_SESSION_VERSION ||
      payload?.sub !== OWNER_SESSION_SUBJECT ||
      typeof payload?.jti !== 'string' ||
      !Number.isInteger(payload?.exp) ||
      payload.exp <= currentSeconds
    ) {
      return false;
    }
    discardExpiredRevocations(currentSeconds);
    revokedSessions.set(payload.jti, payload.exp);
    return true;
  }

  return Object.freeze({
    configured: Boolean(configuredToken),
    authenticateOwnerCredential(candidate) {
      return ownerTokensMatch(candidate, configuredToken);
    },
    issue,
    revoke,
    verify
  });
}

export function serializeOwnerSessionCookie(token, {
  maxAgeMs = OWNER_SESSION_TTL_MS,
  secure = true
} = {}) {
  if (typeof token !== 'string' || !token) throw new TypeError('Owner session token is required');
  const maxAgeSeconds = Math.max(1, Math.floor(maxAgeMs / 1000));
  return [
    `${OWNER_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}

export function clearOwnerSessionCookie({ secure = true } = {}) {
  return [
    `${OWNER_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : [])
  ].join('; ');
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

export function createOwnerAuthMiddleware({ ownerAccessToken, ownerSessionManager } = {}) {
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
    if (candidate) {
      if (!ownerTokensMatch(candidate, configuredToken)) {
        return authFailure(res, 403, 'OWNER_AUTH_INVALID', 'Owner authentication failed');
      }
      req.ownerAuth = Object.freeze({ method: 'bearer', session: null });
      res.set('Cache-Control', 'private, no-store');
      res.vary('Authorization');
      return next();
    }

    const sessionToken = readCookie(req.get('cookie'));
    const session = ownerSessionManager?.verify(sessionToken);
    if (!session) {
      return authFailure(res, 401, 'OWNER_AUTH_REQUIRED', 'Owner authentication is required');
    }

    req.ownerAuth = Object.freeze({ method: 'session', session, sessionToken });
    res.set('Cache-Control', 'private, no-store');
    res.vary('Cookie');
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
