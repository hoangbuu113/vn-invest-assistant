import React, { useState, useEffect, useCallback } from 'react';
import {
  isWebPushSupported,
  getWebPushCapability,
  getExistingPushSubscription,
  enableWebPushNotifications,
  disableWebPushNotifications
} from '../utils/webPush.js';

/**
 * Feature 12D: DeviceAlertNotificationControl
 * Compact, mobile-friendly toggle for first-party Web Push notifications on current device.
 * Enforces:
 * - Read-only inspection on mount (zero mutation / zero permission prompt on load)
 * - Explicit user action for enable/disable
 * - Clear Vietnamese states ("Bật thông báo", "Tắt thông báo")
 * - iOS Home Screen guidance
 * - Preservation of in-app alert fallback
 */
export default function DeviceAlertNotificationControl() {
  const [supported, setSupported] = useState(false);
  const [capability, setCapability] = useState(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSessionVerified, setIsSessionVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [infoMsg, setInfoMsg] = useState(null);

  // Read-only state inspection on mount
  const checkStatus = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    const isSup = isWebPushSupported();
    setSupported(isSup);

    if (!isSup) {
      setLoading(false);
      return;
    }

    const cap = getWebPushCapability();
    setCapability(cap);

    try {
      const existingSub = await getExistingPushSubscription();
      setIsSubscribed(Boolean(existingSub));
      setIsSessionVerified(false);
    } catch (_err) {
      setIsSubscribed(false);
      setIsSessionVerified(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleEnable = async () => {
    setActionInProgress(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const result = await enableWebPushNotifications();
      if (result.enabled) {
        setIsSubscribed(true);
        setIsSessionVerified(true);
        setInfoMsg('Thông báo đã bật trên thiết bị này.');
        // Refresh capability for updated permission
        setCapability(getWebPushCapability());
      } else if (result.reason === 'PERMISSION_DENIED') {
        setErrorMsg('Thông báo đang bị chặn trong cài đặt trình duyệt.');
        setCapability(getWebPushCapability());
      }
    } catch (err) {
      if (err.message === 'IOS_REQUIRES_HOME_SCREEN') {
        setErrorMsg('Trên iPhone/iPad, hãy thêm VN Invest Assistant vào Màn hình chính rồi mở ứng dụng từ đó để bật thông báo.');
      } else if (err.message === 'VAPID_NOT_CONFIGURED') {
        setErrorMsg('Tính năng thông báo đẩy trên thiết bị chưa được kích hoạt trên hệ thống.');
      } else {
        setErrorMsg(err.message || 'Không thể bật thông báo trên thiết bị này');
      }
    } finally {
      setActionInProgress(false);
    }
  };

  const handleDisable = async () => {
    setActionInProgress(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      await disableWebPushNotifications();
      setIsSubscribed(false);
      setIsSessionVerified(false);
      setInfoMsg('Đã tắt thông báo trên thiết bị này.');
    } catch (err) {
      if (err.message === 'BROWSER_UNSUBSCRIBE_FAILED') {
        setErrorMsg('Đã xóa đăng ký trên hệ thống nhưng trình duyệt chưa hủy được cục bộ.');
      } else {
        setErrorMsg(err.message || 'Không thể tắt thông báo trên thiết bị');
      }
    } finally {
      setActionInProgress(false);
    }
  };

  return (
    <div
      style={{
        padding: '0.85rem 1.15rem',
        backgroundColor: 'var(--color-slate-50, #f8fafc)',
        borderRadius: '12px',
        border: '1px solid var(--color-slate-200, #e2e8f0)',
        marginBottom: '1.5rem'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <div style={{ flex: '1 1 280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
            <span style={{ fontSize: '1.1rem' }}>📲</span>
            <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--color-slate-800, #1e293b)' }}>
              Nhận cảnh báo trên thiết bị
            </span>
            {isSubscribed && (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  backgroundColor: 'rgba(22, 163, 74, 0.12)',
                  color: 'var(--color-gain-700, #15803d)',
                  padding: '0.15rem 0.45rem',
                  borderRadius: '6px'
                }}
              >
                Đang bật
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-slate-500, #64748b)', lineHeight: 1.45 }}>
            {isSubscribed
              ? (isSessionVerified
                  ? 'Thông báo đã bật trên thiết bị này.'
                  : 'Thông báo đang được bật trên trình duyệt này.')
              : 'Khi được hỗ trợ, VN Invest Assistant có thể gửi cảnh báo giá tới thiết bị này ngay cả khi bạn không mở trang.'}
          </p>
        </div>

        <div>
          {loading ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-400)' }}>Đang kiểm tra...</span>
          ) : !supported ? (
            <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>Không hỗ trợ Web Push</span>
          ) : isSubscribed ? (
            <button
              onClick={handleDisable}
              disabled={actionInProgress}
              className="fintech-button button-secondary"
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.82rem',
                color: 'var(--color-slate-600)'
              }}
            >
              {actionInProgress ? 'Đang xử lý...' : 'Tắt thông báo'}
            </button>
          ) : (
            <button
              onClick={handleEnable}
              disabled={actionInProgress || capability?.permission === 'denied'}
              className="fintech-button button-primary"
              style={{
                padding: '0.45rem 0.95rem',
                fontSize: '0.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              {actionInProgress ? 'Đang kết nối...' : 'Bật thông báo'}
            </button>
          )}
        </div>
      </div>

      {/* iOS Home Screen Notice */}
      {capability?.requiresIosHomeScreen && !isSubscribed && (
        <div
          style={{
            marginTop: '0.65rem',
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(217, 119, 6, 0.08)',
            border: '1px solid rgba(217, 119, 6, 0.2)',
            borderRadius: '8px',
            fontSize: '0.76rem',
            color: 'var(--color-amber-800, #92400e)'
          }}
        >
          📱 <strong>Trên iPhone/iPad:</strong> Hãy thêm VN Invest Assistant vào Màn hình chính rồi mở ứng dụng từ đó để bật thông báo.
        </div>
      )}

      {/* Browser Permission Denied Notice */}
      {capability?.permission === 'denied' && !isSubscribed && (
        <div
          style={{
            marginTop: '0.65rem',
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(220, 38, 38, 0.2)',
            borderRadius: '8px',
            fontSize: '0.76rem',
            color: 'var(--color-loss-700, #b91c1c)'
          }}
        >
          ⚠️ Thông báo đang bị chặn trong cài đặt trình duyệt. Vui lòng mở quyền thông báo trong cài đặt trang web để sử dụng.
        </div>
      )}

      {/* Error Message */}
      {errorMsg && (
        <div
          style={{
            marginTop: '0.65rem',
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(220, 38, 38, 0.2)',
            borderRadius: '8px',
            fontSize: '0.76rem',
            color: 'var(--color-loss-700, #b91c1c)'
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Success / Info Message */}
      {infoMsg && (
        <div
          style={{
            marginTop: '0.65rem',
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(22, 163, 74, 0.08)',
            border: '1px solid rgba(22, 163, 74, 0.2)',
            borderRadius: '8px',
            fontSize: '0.76rem',
            color: 'var(--color-gain-700, #15803d)'
          }}
        >
          ✓ {infoMsg}
        </div>
      )}
    </div>
  );
}
