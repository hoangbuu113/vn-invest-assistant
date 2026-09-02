import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, OWNER_SESSION_INVALID_EVENT } from '../utils/api.js';

async function hasValidOwnerSession() {
  const response = await apiFetch('/api/owner/session', { cache: 'no-store' });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null);
  return payload?.status === 'ok' && payload?.data?.unlocked === true;
}

export function OwnerGate({ children }) {
  const [state, setState] = useState('checking');
  const [credentialInput, setCredentialInput] = useState('');
  const [error, setError] = useState('');

  const lock = useCallback(() => {
    setCredentialInput('');
    setError('');
    setState('locked');
  }, []);

  useEffect(() => {
    const handleInvalidSession = () => lock();
    window.addEventListener(OWNER_SESSION_INVALID_EVENT, handleInvalidSession);
    return () => window.removeEventListener(OWNER_SESSION_INVALID_EVENT, handleInvalidSession);
  }, [lock]);

  useEffect(() => {
    let active = true;
    hasValidOwnerSession()
      .then((valid) => {
        if (!active) return;
        setState(valid ? 'unlocked' : 'locked');
      })
      .catch(() => {
        if (active) setState('locked');
      });
    return () => {
      active = false;
    };
  }, []);

  const unlock = async (event) => {
    event.preventDefault();
    const candidate = credentialInput.trim();
    if (!candidate) {
      setError('Vui lòng nhập khóa truy cập của chủ sở hữu.');
      return;
    }

    setError('');
    setState('authorizing');
    try {
      const response = await apiFetch('/api/owner/session', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerCredential: candidate })
      });
      if (!response.ok) {
        setCredentialInput('');
        setState('locked');
        setError(response.status === 403
          ? 'Khóa truy cập không hợp lệ.'
          : 'Không thể xác minh quyền truy cập lúc này.');
        return;
      }
      setCredentialInput('');
      setState('unlocked');
    } catch {
      setCredentialInput('');
      setState('locked');
      setError('Không thể xác minh quyền truy cập lúc này.');
    }
  };

  const logout = useCallback(async () => {
    try {
      const response = await apiFetch('/api/owner/session', {
        method: 'DELETE',
        cache: 'no-store'
      });
      if (!response.ok) return;
      lock();
    } catch {
      // Keep the current view when the server could not invalidate the HttpOnly session.
    }
  }, [lock]);

  if (state === 'unlocked') {
    return typeof children === 'function' ? children({ logout }) : children;
  }

  if (state === 'checking') {
    return (
      <main className="owner-session-loading" aria-live="polite">
        <span className="owner-session-loading-dot" aria-hidden="true" />
        <span>Đang kiểm tra phiên bảo mật…</span>
      </main>
    );
  }

  const isAuthorizing = state === 'authorizing';

  return (
    <main className="owner-gate-shell">
      <section className="owner-gate-card" aria-labelledby="owner-gate-title">
        <div className="owner-gate-mark" aria-hidden="true">◆</div>
        <p className="owner-gate-eyebrow">VN Invest Assistant</p>
        <h1 id="owner-gate-title">Xác thực thiết bị</h1>
        <p className="owner-gate-copy">
          Nhập khóa chủ sở hữu một lần. Thiết bị này sẽ được ghi nhớ trong 30 ngày.
        </p>
        <form onSubmit={unlock} className="owner-gate-form">
          <label htmlFor="owner-access-token">Khóa truy cập chủ sở hữu</label>
          <input
            id="owner-access-token"
            name="owner-access-token"
            type="password"
            autoComplete="current-password"
            value={credentialInput}
            onChange={(event) => setCredentialInput(event.target.value)}
            disabled={isAuthorizing}
          />
          {error ? <p className="owner-gate-error" role="alert">{error}</p> : null}
          <button className="fintech-btn btn-primary" type="submit" disabled={isAuthorizing}>
            {isAuthorizing ? 'Đang xác minh…' : 'Xác thực thiết bị'}
          </button>
        </form>
      </section>
    </main>
  );
}
