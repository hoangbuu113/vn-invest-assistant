import React, { useState } from 'react';
import { setActiveAccessToken, supabase } from '../utils/supabase.js';
import { mapAuthErrorToVietnamese } from '../utils/authErrors.js';

export function RegisterView({ onSuccess, onToggleLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      setError('Vui lòng nhập địa chỉ email hợp lệ.');
      return;
    }
    if (!password || password.length < 8) {
      setError('Mật khẩu phải có độ dài tối thiểu từ 8 ký tự trở lên.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không trùng khớp.');
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password
      });

      if (signUpError) {
        setError(mapAuthErrorToVietnamese(signUpError));
        setLoading(false);
        return;
      }

      // Check if session was issued immediately or if email confirmation is required
      if (data?.session) {
        if (data.session.access_token) {
          setActiveAccessToken(data.session.access_token);
        }
        onSuccess?.(data.session);
        return;
      } else {
        // Confirmation required
        setNotice('Đã tạo tài khoản. Hãy kiểm tra email để xác nhận trước khi đăng nhập.');
        setLoading(false);
      }
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <span className="auth-brand-icon" aria-hidden="true">◆</span>
        <span className="auth-brand-name">VN Invest Assistant</span>
      </div>

      <h1 className="auth-title">Đăng ký tài khoản</h1>
      <p className="auth-subtitle">Tạo tài khoản mới để theo dõi tài sản và danh mục đầu tư.</p>

      {notice ? (
        <div className="auth-notice-banner" role="status">
          <p>{notice}</p>
          <button
            type="button"
            className="fintech-btn btn-secondary auth-switch-btn"
            onClick={onToggleLogin}
            style={{ marginTop: '1rem', width: '100%' }}
          >
            Quay lại Đăng nhập
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="auth-field">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
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
            <label htmlFor="register-password">Mật khẩu</label>
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              placeholder="Tối thiểu 8 ký tự"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="register-confirm-password">Xác nhận mật khẩu</label>
            <input
              id="register-confirm-password"
              type="password"
              autoComplete="new-password"
              placeholder="Nhập lại mật khẩu"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {loading ? 'Đang tạo tài khoản…' : 'Đăng ký'}
          </button>
        </form>
      )}

      {!notice ? (
        <div className="auth-footer">
          <span>Đã có tài khoản?</span>
          <button
            type="button"
            className="auth-link-button"
            onClick={onToggleLogin}
            disabled={loading}
          >
            Đăng nhập
          </button>
        </div>
      ) : null}
    </div>
  );
}
