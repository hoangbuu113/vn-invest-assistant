import React, { useCallback, useEffect, useState } from 'react';
import {
  apiFetch,
  clearOwnerAccessToken,
  getOwnerAccessToken,
  setOwnerAccessToken
} from '../utils/api.js';

async function verifyOwnerToken() {
  const response = await apiFetch('/api/owner/session', { cache: 'no-store' });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null);
  return payload?.status === 'ok' && payload?.data?.unlocked === true;
}

export function OwnerGate({ children }) {
  const [state, setState] = useState(() => getOwnerAccessToken() ? 'checkingStored' : 'locked');
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');

  const lock = useCallback(() => {
    clearOwnerAccessToken();
    setTokenInput('');
    setError('');
    setState('locked');
  }, []);

  useEffect(() => {
    if (state !== 'checkingStored') return undefined;
    let active = true;
    verifyOwnerToken()
      .then((valid) => {
        if (!active) return;
        if (valid) setState('unlocked');
        else lock();
      })
      .catch(() => {
        if (active) lock();
      });
    return () => {
      active = false;
    };
  }, [lock, state]);

  const unlock = async (event) => {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate) {
      setError('Vui lòng nhập khóa truy cập của chủ sở hữu.');
      return;
    }

    setError('');
    setState('checking');
    setOwnerAccessToken(candidate);
    try {
      if (await verifyOwnerToken()) {
        setTokenInput('');
        setState('unlocked');
        return;
      }
      clearOwnerAccessToken();
      setState('locked');
      setError('Khóa truy cập không hợp lệ.');
    } catch {
      clearOwnerAccessToken();
      setState('locked');
      setError('Không thể xác minh quyền truy cập lúc này.');
    }
  };

  if (state === 'unlocked') {
    return typeof children === 'function' ? children({ lock }) : children;
  }

  const isChecking = state === 'checking' || state === 'checkingStored';

  return (
    <main className="owner-gate-shell">
      <section className="owner-gate-card" aria-labelledby="owner-gate-title">
        <div className="owner-gate-mark" aria-hidden="true">◆</div>
        <p className="owner-gate-eyebrow">VN Invest Assistant</p>
        <h1 id="owner-gate-title">Mở khóa không gian đầu tư cá nhân</h1>
        <p className="owner-gate-copy">
          Dữ liệu danh mục được bảo vệ. Khóa chỉ được giữ trong phiên trình duyệt hiện tại.
        </p>
        <form onSubmit={unlock} className="owner-gate-form">
          <label htmlFor="owner-access-token">Khóa truy cập chủ sở hữu</label>
          <input
            id="owner-access-token"
            name="owner-access-token"
            type="password"
            autoComplete="current-password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            disabled={isChecking}
          />
          {error ? <p className="owner-gate-error" role="alert">{error}</p> : null}
          <button className="fintech-btn btn-primary" type="submit" disabled={isChecking}>
            {isChecking ? 'Đang xác minh…' : 'Mở khóa'}
          </button>
        </form>
      </section>
    </main>
  );
}
