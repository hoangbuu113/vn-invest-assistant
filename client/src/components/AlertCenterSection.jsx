import React, { useState, useEffect, useCallback } from 'react';
import { TiltCard } from './MotionHelpers.jsx';
import { formatNativeAmount } from '../utils/formatting.js';
import { apiFetch } from '../utils/api.js';

export default function AlertCenterSection({
  onSelectAsset,
  onBackToAssets
}) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'active' | 'triggered'
  const [actionError, setActionError] = useState(null);
  const [evalSummary, setEvalSummary] = useState(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const res = await apiFetch('/api/alerts');
      const json = await res.json();
      if (res.ok && json.status === 'ok') {
        setAlerts(json.data || []);
      } else {
        throw new Error(json.message || 'Không thể tải danh sách cảnh báo');
      }
    } catch (err) {
      setActionError(err.message || 'Lỗi kết nối khi tải cảnh báo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleEvaluate = async () => {
    setEvaluating(true);
    setActionError(null);
    setEvalSummary(null);
    try {
      const res = await apiFetch('/api/alerts/evaluate', {
        method: 'POST'
      });
      const json = await res.json();
      if (res.ok && json.status === 'ok') {
        setAlerts(json.data?.alerts || []);
        const triggered = json.data?.triggeredCount || 0;
        const evaluated = json.data?.evaluatedCount || 0;
        const unavailable = json.data?.unavailableCount || 0;
        setEvalSummary({
          message: `Đã kiểm tra ${evaluated} cảnh báo: ${triggered} cảnh báo mới đạt điều kiện${unavailable > 0 ? `, ${unavailable} mã chưa có dữ liệu giá` : ''}.`,
          triggered
        });
      } else {
        throw new Error(json.message || 'Không thể kiểm tra cảnh báo');
      }
    } catch (err) {
      setActionError(err.message || 'Lỗi khi kiểm tra cảnh báo');
    } finally {
      setEvaluating(false);
    }
  };

  const handleDelete = async (alertId) => {
    try {
      const res = await apiFetch(`/api/alerts/${alertId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json.status === 'ok') {
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      } else {
        throw new Error(json.message || 'Không thể xóa cảnh báo');
      }
    } catch (err) {
      setActionError(err.message || 'Lỗi khi xóa cảnh báo');
    }
  };

  const handleReactivate = async (alertId) => {
    try {
      const res = await apiFetch(`/api/alerts/${alertId}/reactivate`, {
        method: 'POST'
      });
      const json = await res.json();
      if (res.ok && json.status === 'ok') {
        setAlerts((prev) => prev.map((a) => (a.id === alertId ? json.data : a)));
      } else {
        throw new Error(json.message || 'Không thể đặt lại cảnh báo');
      }
    } catch (err) {
      setActionError(err.message || 'Lỗi khi đặt lại cảnh báo');
    }
  };

  const activeAlerts = alerts.filter((a) => a.status === 'active');
  const triggeredAlerts = alerts.filter((a) => a.status === 'triggered');

  const displayedAlerts =
    filterTab === 'active'
      ? activeAlerts
      : filterTab === 'triggered'
      ? triggeredAlerts
      : alerts;

  return (
    <div style={{ animation: 'fadeIn 0.25s ease-out' }}>
      {/* Top Header Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🔔</span>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 900,
                color: 'var(--color-slate-900)',
                margin: 0,
                letterSpacing: '-0.02em'
              }}
            >
              Cảnh báo giá
            </h1>
          </div>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--color-slate-500)' }}>
            Theo dõi ngưỡng giá mục tiêu dựa trên dữ liệu giá thị trường.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {onBackToAssets && (
            <button
              onClick={onBackToAssets}
              className="fintech-button button-secondary"
              style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
            >
              ← Quay lại
            </button>
          )}

          <button
            onClick={handleEvaluate}
            disabled={evaluating || loading || alerts.length === 0}
            className="fintech-button button-primary"
            style={{
              padding: '0.55rem 1.15rem',
              fontSize: '0.88rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem'
            }}
          >
            {evaluating ? 'Đang kiểm tra...' : '⚡ Kiểm tra cảnh báo'}
          </button>
        </div>
      </div>

      {/* Honest V1 Limitation Banner */}
      <div
        style={{
          padding: '0.75rem 1rem',
          backgroundColor: 'rgba(30, 41, 59, 0.03)',
          borderRadius: '12px',
          border: '1px solid var(--color-slate-200, #e2e8f0)',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.65rem',
          fontSize: '0.8rem',
          color: 'var(--color-slate-600)'
        }}
      >
        <span style={{ fontSize: '1rem', lineHeight: 1 }}>ⓘ</span>
        <div>
          Cảnh báo chỉ kích hoạt một lần và được kiểm tra khi bạn làm mới dữ liệu trong ứng dụng. Phiên bản hiện tại chưa gửi thông báo nền.
        </div>
      </div>

      {/* Status Notifications */}
      {evalSummary && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: evalSummary.triggered > 0 ? 'rgba(217, 119, 6, 0.1)' : 'rgba(22, 163, 74, 0.1)',
            color: evalSummary.triggered > 0 ? 'var(--color-amber-700, #b45309)' : 'var(--color-gain-700, #15803d)',
            borderRadius: '10px',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            border: evalSummary.triggered > 0 ? '1px solid rgba(217, 119, 6, 0.3)' : '1px solid rgba(22, 163, 74, 0.3)'
          }}
        >
          <span>{evalSummary.triggered > 0 ? '🔔' : '✓'}</span>
          <span>{evalSummary.message}</span>
        </div>
      )}

      {actionError && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            color: 'var(--color-loss-700, #b91c1c)',
            borderRadius: '10px',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
            border: '1px solid rgba(220, 38, 38, 0.2)'
          }}
        >
          {actionError}
        </div>
      )}

      {/* Summary KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}
      >
        <TiltCard className="fintech-card" style={{ padding: '1.15rem' }} tiltMax={1}>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontWeight: 600 }}>TỔNG CẢNH BÁO</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--color-slate-900)', marginTop: '0.2rem' }}>
            {alerts.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '0.2rem' }}>
            Toàn bộ cảnh báo đã lưu
          </div>
        </TiltCard>

        <TiltCard className="fintech-card" style={{ padding: '1.15rem' }} tiltMax={1}>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontWeight: 600 }}>ĐANG HOẠT ĐỘNG</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--color-gain-600, #16a34a)', marginTop: '0.2rem' }}>
            {activeAlerts.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '0.2rem' }}>
            Đang chờ điều kiện
          </div>
        </TiltCard>

        <TiltCard className="fintech-card" style={{ padding: '1.15rem' }} tiltMax={1}>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontWeight: 600 }}>ĐÃ KÍCH HOẠT</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--color-amber-600, #d97706)', marginTop: '0.2rem' }}>
            {triggeredAlerts.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '0.2rem' }}>
            Đã đạt mức giá mục tiêu
          </div>
        </TiltCard>
      </div>

      {/* Tabs Filter (Simplified without repeating counts) */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--color-slate-200, #e2e8f0)',
          paddingBottom: '0.75rem',
          marginBottom: '1.5rem'
        }}
      >
        <button
          onClick={() => setFilterTab('all')}
          style={{
            padding: '0.4rem 0.85rem',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: filterTab === 'all' ? 'var(--color-slate-900)' : 'transparent',
            color: filterTab === 'all' ? '#ffffff' : 'var(--color-slate-600)',
            fontWeight: 700,
            fontSize: '0.82rem',
            cursor: 'pointer'
          }}
        >
          Tất cả
        </button>

        <button
          onClick={() => setFilterTab('active')}
          style={{
            padding: '0.4rem 0.85rem',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: filterTab === 'active' ? 'var(--color-gain-600, #16a34a)' : 'transparent',
            color: filterTab === 'active' ? '#ffffff' : 'var(--color-slate-600)',
            fontWeight: 700,
            fontSize: '0.82rem',
            cursor: 'pointer'
          }}
        >
          Đang hoạt động
        </button>

        <button
          onClick={() => setFilterTab('triggered')}
          style={{
            padding: '0.4rem 0.85rem',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: filterTab === 'triggered' ? 'var(--color-amber-600, #d97706)' : 'transparent',
            color: filterTab === 'triggered' ? '#ffffff' : 'var(--color-slate-600)',
            fontWeight: 700,
            fontSize: '0.82rem',
            cursor: 'pointer'
          }}
        >
          Đã kích hoạt
        </button>
      </div>

      {/* Content List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-slate-400)' }}>
          Đang tải danh sách cảnh báo...
        </div>
      ) : displayedAlerts.length === 0 ? (
        <TiltCard className="fintech-card" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔕</div>
          <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-slate-800)', fontSize: '1.1rem', fontWeight: 800 }}>
            {filterTab === 'all'
              ? 'Chưa có cảnh báo giá nào'
              : filterTab === 'active'
              ? 'Không có cảnh báo nào đang chờ kích hoạt'
              : 'Chưa có cảnh báo nào đạt điều kiện'}
          </h3>
          <p style={{ margin: '0 auto 1.25rem auto', maxWidth: '380px', fontSize: '0.85rem', color: 'var(--color-slate-500)' }}>
            Bạn có thể đặt cảnh báo giá trực tiếp từ trang chi tiết tài sản hoặc danh sách theo dõi.
          </p>
          {onBackToAssets && (
            <button
              onClick={onBackToAssets}
              className="fintech-button button-primary"
              style={{ padding: '0.6rem 1.25rem', fontSize: '0.85rem' }}
            >
              Xem danh sách tài sản
            </button>
          )}
        </TiltCard>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {displayedAlerts.map((alert) => {
            const isTriggered = alert.status === 'triggered';
            const sym = alert.asset?.symbol || 'UNKNOWN';
            const name = alert.asset?.name || sym;
            const hasEvaluatedPrice = typeof alert.last_evaluated_price === 'number' && Number.isFinite(alert.last_evaluated_price) && alert.last_evaluated_price > 0;

            return (
              <TiltCard
                key={alert.id}
                className="fintech-card"
                style={{
                  padding: '1.25rem',
                  border: isTriggered ? '1px solid rgba(217, 119, 6, 0.35)' : '1px solid var(--color-slate-200, #e2e8f0)',
                  backgroundColor: isTriggered ? 'rgba(254, 243, 199, 0.25)' : 'var(--color-surface, #ffffff)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem'
                }}
                tiltMax={1.5}
              >
                {/* Top: Asset & Status */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.65rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span
                          style={{
                            fontSize: '1.15rem',
                            fontWeight: 900,
                            color: 'var(--color-slate-900)',
                            letterSpacing: '-0.01em'
                          }}
                        >
                          {sym}
                        </span>
                        {alert.asset?.exchange && (
                          <span className="fintech-badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                            {alert.asset.exchange}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--color-slate-500)',
                          maxWidth: '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={name}
                      >
                        {name}
                      </div>
                    </div>

                    <span
                      className={`fintech-badge ${isTriggered ? 'badge-warning' : 'badge-neutral'}`}
                      style={{
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        backgroundColor: isTriggered ? 'rgba(217, 119, 6, 0.12)' : 'rgba(22, 163, 74, 0.1)',
                        color: isTriggered ? 'var(--color-amber-700, #b45309)' : 'var(--color-gain-700, #15803d)',
                        border: isTriggered ? '1px solid rgba(217, 119, 6, 0.3)' : '1px solid rgba(22, 163, 74, 0.25)'
                      }}
                    >
                      {isTriggered ? '✓ Đã đạt điều kiện' : 'Đang hoạt động'}
                    </span>
                  </div>

                  {/* Condition Details */}
                  <div
                    style={{
                      padding: '0.75rem',
                      borderRadius: '10px',
                      backgroundColor: 'var(--color-slate-50, #f8fafc)',
                      border: '1px solid var(--color-slate-200, #e2e8f0)',
                      marginBottom: '0.75rem'
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginBottom: '0.2rem' }}>
                      ĐIỀU KIỆN CẢNH BÁO
                    </div>
                    <div
                      style={{
                        fontSize: '0.95rem',
                        fontWeight: 800,
                        color: alert.direction === 'above' ? 'var(--color-gain-700, #15803d)' : 'var(--color-loss-700, #b91c1c)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                      }}
                    >
                      <span>{alert.direction === 'above' ? '▲ Giá đạt hoặc vượt' : '▼ Giá giảm xuống hoặc thấp hơn'}</span>
                      <span style={{ color: 'var(--color-slate-900)' }}>
                        {formatNativeAmount(alert.target_price, alert.asset?.quote_currency || alert.asset?.quoteCurrency || 'VND')}
                      </span>
                    </div>

                    {/* Price Evaluation Details */}
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--color-slate-600)',
                        marginTop: '0.45rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        borderTop: '1px dashed var(--color-slate-200, #e2e8f0)',
                        paddingTop: '0.35rem'
                      }}
                    >
                      <span>{isTriggered ? 'Giá khi kích hoạt:' : 'Giá khi kiểm tra:'}</span>
                      <strong style={{ color: hasEvaluatedPrice ? 'var(--color-slate-800)' : 'var(--color-slate-400)' }}>
                        {hasEvaluatedPrice ? formatNativeAmount(alert.last_evaluated_price, alert.asset?.quote_currency || alert.asset?.quoteCurrency || 'VND') : 'Chưa có dữ liệu giá'}
                      </strong>
                    </div>
                  </div>

                  {/* Timestamp details */}
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-slate-400)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <div>Tạo lúc: {new Date(alert.created_at).toLocaleString('vi-VN')}</div>
                    {isTriggered && alert.triggered_at && (
                      <div style={{ color: 'var(--color-amber-700, #b45309)', fontWeight: 600 }}>
                        Kích hoạt: {new Date(alert.triggered_at).toLocaleString('vi-VN')}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid var(--color-slate-100, #f1f5f9)',
                    paddingTop: '0.65rem',
                    marginTop: '0.25rem'
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {onSelectAsset && (
                      <button
                        type="button"
                        onClick={() => onSelectAsset(sym)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-indigo-600, #4f46e5)',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: '0.2rem 0.4rem'
                        }}
                      >
                        Xem tài sản →
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {isTriggered && (
                      <button
                        type="button"
                        onClick={() => handleReactivate(alert.id)}
                        className="fintech-button button-secondary"
                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                        title="Kích hoạt lại cảnh báo này"
                      >
                        Đặt lại
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDelete(alert.id)}
                      style={{
                        background: 'none',
                        border: '1px solid var(--color-slate-200, #e2e8f0)',
                        borderRadius: '6px',
                        color: 'var(--color-loss-600, #dc2626)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: '0.35rem 0.65rem'
                      }}
                      title="Xóa cảnh báo này"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              </TiltCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
