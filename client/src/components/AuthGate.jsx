import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, AUTH_INVALID_EVENT } from '../utils/api.js';
import { clearCachedAccessToken, setActiveAccessToken, supabase } from '../utils/supabase.js';
import { LoginView } from './LoginView.jsx';
import { RegisterView } from './RegisterView.jsx';

/**
 * Auth Gate State Machine:
 * - 'CHECKING_SESSION': Initial mount checking localStorage
 * - 'UNAUTHENTICATED': No active session, displays Login or Register view
 * - 'BOOTSTRAPPING_PROFILE': Session acquired, loading profile data from backend
 * - 'AUTHENTICATED_READY': User and profile loaded, displays dashboard
 * - 'BOOTSTRAP_ERROR': Session valid but backend profile request failed/timed out; user can retry or sign out
 */
export function AuthGate({ children }) {
  const [authState, setAuthState] = useState('CHECKING_SESSION');
  const [authView, setAuthView] = useState('LOGIN'); // 'LOGIN' | 'REGISTER'
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [bootstrapError, setBootstrapError] = useState(null);

  const authStateRef = useRef(authState);
  authStateRef.current = authState;

  const activeSessionRef = useRef(null);
  const activeBootstrapTokenRef = useRef(null);
  const bootstrapSequenceRef = useRef(0);

  const logout = useCallback(async () => {
    bootstrapSequenceRef.current++;
    activeSessionRef.current = null;
    activeBootstrapTokenRef.current = null;
    clearCachedAccessToken();
    try {
      await supabase.auth.signOut();
    } catch {
      // Best-effort signout
    }
    setUser(null);
    setProfile(null);
    setBootstrapError(null);
    setAuthState('UNAUTHENTICATED');
    setAuthView('LOGIN');
  }, []);

  const bootstrapProfile = useCallback(async (session, isRetry = false) => {
    if (!session?.user) {
      activeSessionRef.current = null;
      activeBootstrapTokenRef.current = null;
      setUser(null);
      setProfile(null);
      setAuthState('UNAUTHENTICATED');
      return;
    }

    const token = session.access_token;
    // Deduplication: If already bootstrapping or ready for this exact token, ignore duplicate invocation
    if (
      !isRetry &&
      activeBootstrapTokenRef.current === token &&
      (authStateRef.current === 'BOOTSTRAPPING_PROFILE' || authStateRef.current === 'AUTHENTICATED_READY')
    ) {
      return;
    }

    activeBootstrapTokenRef.current = token;
    activeSessionRef.current = session;
    const currentSequence = ++bootstrapSequenceRef.current;

    if (token) {
      setActiveAccessToken(token);
    }

    setUser(session.user);
    setBootstrapError(null);
    setAuthState('BOOTSTRAPPING_PROFILE');

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 15000);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      // 1. Check if profile already exists for this authenticated user
      const profileResponse = await apiFetch('/api/profile', {
        headers,
        signal: abortController.signal
      });

      clearTimeout(timeoutId);
      if (currentSequence !== bootstrapSequenceRef.current) return;

      if (profileResponse.status === 200) {
        const payload = await profileResponse.json().catch(() => null);
        setProfile(payload?.data || null);
        setAuthState('AUTHENTICATED_READY');
        return;
      }

      if (profileResponse.status === 403) {
        // Authenticated user has no profile -> initialize new empty isolated profile
        const createResponse = await apiFetch('/api/profile', {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
          signal: abortController.signal
        });
        if (currentSequence !== bootstrapSequenceRef.current) return;

        if (createResponse.ok) {
          const createPayload = await createResponse.json().catch(() => null);
          setProfile(createPayload?.data || null);
          setAuthState('AUTHENTICATED_READY');
        } else {
          setBootstrapError('Không thể khởi tạo hồ sơ đầu tư mới. Vui lòng thử lại.');
          setAuthState('BOOTSTRAP_ERROR');
        }
        return;
      }

      if (profileResponse.status === 401) {
        // Explicitly rejected by backend auth -> genuine invalid token
        activeSessionRef.current = null;
        activeBootstrapTokenRef.current = null;
        clearCachedAccessToken();
        setUser(null);
        setProfile(null);
        setAuthState('UNAUTHENTICATED');
        return;
      }

      // Any other HTTP status (e.g. 500, 502, 503, 504) -> server temporarily unavailable
      setBootstrapError(`Máy chủ dữ liệu chưa sẵn sàng (mã ${profileResponse.status}). Vui lòng thử lại.`);
      setAuthState('BOOTSTRAP_ERROR');
    } catch (err) {
      clearTimeout(timeoutId);
      if (currentSequence !== bootstrapSequenceRef.current) return;

      const isTimeout = err?.name === 'AbortError';
      setBootstrapError(
        isTimeout
          ? 'Quá thời gian kết nối đến máy chủ dữ liệu tài khoản (có thể do máy chủ đang khởi động). Vui lòng thử lại.'
          : 'Không thể kết nối đến máy chủ dữ liệu tài khoản. Vui lòng kiểm tra kết nối và thử lại.'
      );
      setAuthState('BOOTSTRAP_ERROR');
    }
  }, []);

  useEffect(() => {
    const handleAuthInvalid = () => {
      logout();
    };
    window.addEventListener(AUTH_INVALID_EVENT, handleAuthInvalid);
    return () => window.removeEventListener(AUTH_INVALID_EVENT, handleAuthInvalid);
  }, [logout]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session) {
        bootstrapProfile(session);
      } else {
        setAuthState('UNAUTHENTICATED');
      }
    }).catch(() => {
      if (mounted) setAuthState('UNAUTHENTICATED');
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !session) {
        activeSessionRef.current = null;
        activeBootstrapTokenRef.current = null;
        clearCachedAccessToken();
        setUser(null);
        setProfile(null);
        setAuthState('UNAUTHENTICATED');
      } else if (event === 'SIGNED_IN') {
        bootstrapProfile(session);
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user);
        if (session.access_token) {
          setActiveAccessToken(session.access_token);
        }
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [bootstrapProfile]);

  if (authState === 'CHECKING_SESSION' || authState === 'LOADING') {
    return (
      <main className="auth-gate-shell">
        <div className="auth-session-loading" role="status" aria-live="polite">
          <span className="auth-session-loading-dot" aria-hidden="true" />
          <span>Đang tải phiên đăng nhập…</span>
        </div>
      </main>
    );
  }

  if (authState === 'BOOTSTRAPPING_PROFILE') {
    return (
      <main className="auth-gate-shell">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="auth-brand" style={{ justifyContent: 'center' }}>
            <span className="auth-brand-icon" aria-hidden="true">◆</span>
            <span className="auth-brand-name">VN Invest Assistant</span>
          </div>
          <div role="status" aria-live="polite">
            <div className="auth-session-loading" style={{ margin: '24px 0 12px' }}>
              <span className="auth-session-loading-dot" aria-hidden="true" />
              <span style={{ fontSize: '1rem', color: 'var(--color-slate-800)' }}>Đăng nhập thành công</span>
            </div>
            <p className="auth-subtitle" style={{ margin: '0 0 8px' }}>
              Đang tải dữ liệu tài khoản và danh mục đầu tư…
            </p>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', margin: 0 }}>
              Hệ thống có thể mất vài giây để kết nối máy chủ dữ liệu.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (authState === 'BOOTSTRAP_ERROR') {
    return (
      <main className="auth-gate-shell">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="auth-brand" style={{ justifyContent: 'center' }}>
            <span className="auth-brand-icon" aria-hidden="true">◆</span>
            <span className="auth-brand-name">VN Invest Assistant</span>
          </div>
          <div role="alert" aria-live="assertive">
            <h2 className="auth-title" style={{ fontSize: '1.25rem', marginBottom: '8px' }}>
              Kết nối máy chủ chậm
            </h2>
            <p className="auth-subtitle" style={{ marginBottom: '20px' }}>
              {bootstrapError || 'Không thể kết nối đến máy chủ dữ liệu tài khoản. Phiên đăng nhập của bạn đã được bảo lưu.'}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              type="button"
              className="fintech-btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => activeSessionRef.current && bootstrapProfile(activeSessionRef.current, true)}
            >
              Thử lại kết nối
            </button>
            <button
              type="button"
              className="fintech-btn btn-secondary"
              style={{ width: '100%' }}
              onClick={logout}
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (authState === 'UNAUTHENTICATED') {
    return (
      <main className="auth-gate-shell">
        {authView === 'LOGIN' ? (
          <LoginView
            onSuccess={(session) => bootstrapProfile(session)}
            onToggleRegister={() => setAuthView('REGISTER')}
          />
        ) : (
          <RegisterView
            onSuccess={(session) => bootstrapProfile(session)}
            onToggleLogin={() => setAuthView('LOGIN')}
          />
        )}
      </main>
    );
  }

  if (authState === 'AUTHENTICATED_READY') {
    return typeof children === 'function'
      ? children({ logout, user, profile })
      : children;
  }

  return null;
}
