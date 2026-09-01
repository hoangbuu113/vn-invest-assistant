export const TEST_OWNER_ACCESS_TOKEN = 'test-owner-token-with-high-entropy-placeholder';

export function ownerFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${TEST_OWNER_ACCESS_TOKEN}`
    }
  });
}
