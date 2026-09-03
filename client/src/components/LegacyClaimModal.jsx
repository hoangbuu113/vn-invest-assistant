import React, { useState } from 'react';
import { apiFetch } from '../utils/api.js';

export function LegacyClaimModal({ onSuccess, onLogout }) {
  const [legacyToken, setLegacyToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleClaim = async (event) => {
    event.preventDefault();
    const token = legacyToken.trim();
    if (!token) {
      setError('Vui lòng nhập khóa truy cập cũ để tiếp tục.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await apiFetch('/api/auth/claim-legacy-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legacyOwnerToken: token })
      });

      // Clear token from state immediately
      setLegacyToken('');

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 403) {
          setError('Khóa truy cập cũ không đúng.');
        } else if (response.status === 409) {
          setError('Tài khoản này đã có hồ sơ đầu tư.');
        } else if (response.status === 410) {
          setError('Dữ liệu phiên bản cũ đã được liên kết hoặc không còn khả dụng.');
        } else {
          setError(result?.message || 'Không thể khôi phục dữ liệu lúc này. Vui lòng thử lại sau.');
        }
        setLoading(false);
        return;
      }

      if (result?.status === 'ok' && result?.data?.claimed) {
        onSuccess?.(result.data.profile);
      } else {
        setError('Phản hồi không hợp lệ từ máy chủ.');
      }
    } catch {
      setLegacyToken('');
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-backdrop">
      <div className="auth-card legacy-claim-card" role="dialog" aria-labelledby="legacy-claim-title">
        <div className="auth-brand">
          <span className="auth-brand-icon" aria-hidden="true">◆</span>
          <span className="auth-brand-name">VN Invest Assistant</span>
        </div>

        <h1 id="legacy-claim-title" className="auth-title">Khôi phục dữ liệu hiện tại</h1>
        <p className="auth-subtitle">
          VN Invest Assistant phát hiện dữ liệu danh mục từ phiên bản cũ. Bạn có thể liên kết dữ liệu này với tài khoản mới.
        </p>
        <p className="auth-instruction">
          Nhập khóa chủ sở hữu cũ một lần để liên kết dữ liệu hiện tại với tài khoản này.
        </p>

        <form onSubmit={handleClaim} className="auth-form" noValidate>
          <div className="auth-field">
            <label htmlFor="legacy-token-input">Khóa truy cập cũ</label>
            <input
              id="legacy-token-input"
              type="password"
              autoComplete="off"
              placeholder="Nhập khóa bảo mật cũ của bạn"
              value={legacyToken}
              onChange={(e) => setLegacyToken(e.target.value)}
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
            {loading ? 'Đang liên kết dữ liệu…' : 'Khôi phục dữ liệu'}
          </button>
        </form>

        <div className="auth-footer" style={{ marginTop: '1.5rem', justifyContent: 'center' }}>
          <button
            type="button"
            className="auth-link-button"
            onClick={onLogout}
            disabled={loading}
          >
            Đăng xuất khỏi tài khoản này
          </button>
        </div>
      </div>
    </div>
  );
}
