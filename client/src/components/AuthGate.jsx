import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, AUTH_INVALID_EVENT } from '../utils/api.js';
import { clearCachedAccessToken, supabase } from '../utils/supabase.js';
import { LegacyClaimModal } from './LegacyClaimModal.jsx';
import { LoginView } from './LoginView.jsx';
import { RegisterView } from './RegisterView.jsx';

export function AuthGate({ children }) {
  const [authState, setAuthState] = useState('LOADING'); // 'LOADING' | 'UNAUTHENTICATED' | 'AUTHENTICATED_NEEDS_PROFILE' | 'AUTHENTICATED_READY'
  const [authView, setAuthView] = useState('LOGIN'); // 'LOGIN' | 'REGISTER'
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [legacyClaimAvailable, setLegacyClaimAvailable] = useState(false);

  const bootstrapSequenceRef = useRef(0);

  const bootstrapProfile = useCallback(async (session) => {
    const currentSequence = ++bootstrapSequenceRef.current;
    if (!session?.user) {
      setUser(null);
      setProfile(null);
      setAuthState('UNAUTHENTICATED');
      return;
    }

    setUser(session.user);

    try {
      // 1. Check if profile already exists for this authenticated user
      const profileResponse = await apiFetch('/api/profile');

      if (currentSequence !== bootstrapSequenceRef.current) return;

      if (profileResponse.status === 200) {
        const payload = await profileResponse.json().catch(() => null);
        setProfile(payload?.data || null);
        setAuthState('AUTHENTICATED_READY');
        return;
      }

      if (profileResponse.status === 403) {
        // CASE B: Authenticated user has no profile -> check legacy claim status
        const statusResponse = await apiFetch('/api/auth/legacy-claim-status');
        if (currentSequence !== bootstrapSequenceRef.current) return;

        const statusPayload = await statusResponse.json().catch(() => null);
        const claimAvailable = Boolean(statusPayload?.data?.legacyClaimAvailable);

        if (claimAvailable) {
          // Unclaimed legacy profile exists -> present one-time claim modal
          setLegacyClaimAvailable(true);
          setAuthState('AUTHENTICATED_NEEDS_PROFILE');
          return;
        }

        // No unclaimed legacy profile -> initialize new empty profile
        const createResponse = await apiFetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (currentSequence !== bootstrapSequenceRef.current) return;

        if (createResponse.ok) {
          const createPayload = await createResponse.json().catch(() => null);
          setProfile(createPayload?.data || null);
          setAuthState('AUTHENTICATED_READY');
        } else {
          // If creation failed unexpectedly, prompt re-login
          setAuthState('UNAUTHENTICATED');
        }
        return;
      }

      if (profileResponse.status === 401) {
        setUser(null);
        setProfile(null);
        setAuthState('UNAUTHENTICATED');
        return;
      }

      // Any other unexpected error
      setAuthState('UNAUTHENTICATED');
    } catch {
      if (currentSequence === bootstrapSequenceRef.current) {
        setAuthState('UNAUTHENTICATED');
      }
    }
  }, []);

  const logout = useCallback(async () => {
    bootstrapSequenceRef.current++;
    clearCachedAccessToken();
    try {
      await supabase.auth.signOut();
    } catch {
      // Best-effort signout
    }
    setUser(null);
    setProfile(null);
    setLegacyClaimAvailable(false);
    setAuthState('UNAUTHENTICATED');
    setAuthView('LOGIN');
  }, []);

  // Handle global 401 AUTH_INVALID event from apiFetch
  useEffect(() => {
    const handleAuthInvalid = () => {
      logout();
    };
    window.addEventListener(AUTH_INVALID_EVENT, handleAuthInvalid);
    return () => window.removeEventListener(AUTH_INVALID_EVENT, handleAuthInvalid);
  }, [logout]);

  // Handle Supabase Auth state changes
  useEffect(() => {
    let mounted = true;

    // Initial session inspection
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
        setUser(null);
        setProfile(null);
        setLegacyClaimAvailable(false);
        setAuthState('UNAUTHENTICATED');
      } else if (event === 'SIGNED_IN') {
        bootstrapProfile(session);
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [bootstrapProfile]);

  // Loading state (no flicker)
  if (authState === 'LOADING') {
    return (
      <main className="auth-gate-shell" aria-live="polite">
        <div className="auth-session-loading">
          <span className="auth-session-loading-dot" aria-hidden="true" />
          <span>Đang tải phiên đăng nhập…</span>
        </div>
      </main>
    );
  }

  // Unauthenticated: Login or Register
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

  // Authenticated but needs profile claim
  if (authState === 'AUTHENTICATED_NEEDS_PROFILE' && legacyClaimAvailable) {
    return (
      <main className="auth-gate-shell">
        <LegacyClaimModal
          onSuccess={(claimedProfile) => {
            setProfile(claimedProfile);
            setLegacyClaimAvailable(false);
            setAuthState('AUTHENTICATED_READY');
          }}
          onLogout={logout}
        />
      </main>
    );
  }

  // Authenticated and ready: render application
  if (authState === 'AUTHENTICATED_READY') {
    return typeof children === 'function'
      ? children({ logout, user, profile })
      : children;
  }

  return null;
}
