import React from 'react';
import { buildPortfolioOnboardingViewModel } from '../utils/portfolioOnboarding.js';

export function PortfolioOnboardingGuide({
  cashAvailable = 0,
  holdingsCount = 0,
  onOpenCashModal,
  onOpenOpeningPositionModal,
  onOpenTransactionModal
}) {
  const model = buildPortfolioOnboardingViewModel({ cashAvailable, holdingsCount });

  if (!model.shouldRender) {
    return null;
  }

  const handleAction = (actionId) => {
    switch (actionId) {
      case 'deposit':
      case 'cash_manage':
        if (onOpenCashModal) onOpenCashModal();
        break;
      case 'opening_position':
        if (onOpenOpeningPositionModal) onOpenOpeningPositionModal();
        break;
      case 'buy':
        if (onOpenTransactionModal) onOpenTransactionModal();
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="portfolio-onboarding-card"
      style={{
        padding: '1.5rem',
        borderRadius: '16px',
        backgroundColor: 'var(--color-surface, #ffffff)',
        border: '1px solid var(--border-default, #e2e8f0)',
        boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.05)',
        margin: '1rem 0'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
        <span
          className="fintech-badge badge-neutral"
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '4px 8px'
          }}
        >
          {model.badge}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'var(--color-slate-900, #0f172a)',
              margin: '0 0 0.5rem 0',
              lineHeight: 1.3
            }}
          >
            {model.title}
          </h3>
          <p
            style={{
              fontSize: '0.9rem',
              color: 'var(--color-slate-600, #475569)',
              margin: 0,
              maxWidth: '640px',
              lineHeight: 1.5
            }}
          >
            {model.description}
          </p>
        </div>

        {model.formattedCash && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              padding: '0.6rem 1rem',
              backgroundColor: 'rgba(37, 99, 235, 0.06)',
              border: '1px solid rgba(37, 99, 235, 0.18)',
              borderRadius: '12px',
              minWidth: '160px'
            }}
          >
            <span style={{ fontSize: '0.75rem', color: 'var(--color-brand-600, #2563eb)', fontWeight: 600 }}>
              Số dư tiền mặt
            </span>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-brand-700, #1d4ed8)' }}>
              {model.formattedCash}
            </span>
          </div>
        )}
      </div>

      {/* Action Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
          marginTop: '1.25rem'
        }}
      >
        {model.primaryActions.map((action) => (
          <div
            key={action.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '1rem',
              borderRadius: '12px',
              backgroundColor: action.variant === 'primary' ? 'rgba(37, 99, 235, 0.03)' : 'var(--color-slate-50, #f8fafc)',
              border: `1px solid ${action.variant === 'primary' ? 'rgba(37, 99, 235, 0.2)' : 'var(--border-default, #e2e8f0)'}`,
              gap: '10px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--color-slate-900, #0f172a)', fontSize: '0.92rem', marginBottom: '4px' }}>
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-slate-500, #64748b)', margin: 0, lineHeight: 1.45 }}>
                {action.helper}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleAction(action.id)}
              className={`fintech-btn ${action.variant === 'primary' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '0.5rem 0.75rem',
                fontSize: '0.85rem'
              }}
            >
              {action.label}
            </button>
          </div>
        ))}
      </div>

      {model.secondaryAction && (
        <div style={{ marginTop: '0.85rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => handleAction(model.secondaryAction.id)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-slate-500, #64748b)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '4px 8px'
            }}
          >
            {model.secondaryAction.label} →
          </button>
        </div>
      )}
    </div>
  );
}

export default PortfolioOnboardingGuide;

