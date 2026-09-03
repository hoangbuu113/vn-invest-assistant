import React, { useState } from 'react';
import { supabase } from '../utils/supabase.js';
import { mapAuthErrorToVietnamese } from '../utils/authErrors.js';

export { mapAuthErrorToVietnamese };

export function LoginView({ onSuccess, onToggleRegister }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('Vui lòng nhập đầy đủ email và mật khẩu.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password
      });

      if (signInError) {
        setError(mapAuthErrorToVietnamese(signInError));
        setLoading(false);
        return;
      }

      if (data?.session) {
        onSuccess?.(data.session);
      }
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <span className="auth-brand-icon" aria-hidden="true">◆</span>
        <span className="auth-brand-name">VN Invest Assistant</span>
      </div>

      <h1 className="auth-title">Đăng nhập</h1>
      <p className="auth-subtitle">Nhập thông tin tài khoản để truy cập danh mục đầu tư.</p>

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <div className="auth-field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="login-password">Mật khẩu</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        {error ? (
          <div className="auth-error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <button type="submit" className="fintech-btn btn-primary auth-submit-btn" disabled={loading}>
          {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>

      <div className="auth-footer">
        <span>Chưa có tài khoản?</span>
        <button
          type="button"
          className="auth-link-button"
          onClick={onToggleRegister}
          disabled={loading}
        >
          Đăng ký
        </button>
      </div>
    </div>
  );
}
