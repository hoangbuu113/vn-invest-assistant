process.env.NODE_ENV = 'test';

function makeTestJwt(userId = 'test-user-id-00000000-0000-0000-0000-000000000001') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, email: 'test@example.com' })).toString('base64url');
  return `${header}.${payload}.test_signature`;
}

export const TEST_OWNER_ACCESS_TOKEN = makeTestJwt();

export function ownerFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${TEST_OWNER_ACCESS_TOKEN}`
    }
  });
}
