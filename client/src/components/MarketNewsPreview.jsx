import React from 'react';
import { formatPublishedTime } from '../utils/formatting.js';
import { MagneticButton } from './MotionHelpers.jsx';

const CATEGORY_STYLES = {
  macro: { label: 'Vĩ mô', bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
  market: { label: 'Thị trường', bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
  company: { label: 'Doanh nghiệp', bg: '#faf5ff', color: '#6b21a8', border: '#e9d5ff' },
  global: { label: 'Quốc tế', bg: '#fff7ed', color: '#9a3412', border: '#fed7aa' },
  crypto: { label: 'Crypto', bg: '#fdf2f8', color: '#9d174d', border: '#fbcfe8' },
  gold: { label: 'Vàng', bg: '#fefce8', color: '#854d0e', border: '#fef08a' }
};

export function MarketNewsPreview({
  news = [],
  loading = false,
  error = null,
  onViewAll
}) {
  const displayItems = Array.isArray(news) ? news.slice(0, 5) : [];

  return (
    <div className="market-news-preview-panel">
      {/* Header */}
      <div className="market-news-header">
        <div>
          <h3 className="market-news-title">Tin tức đáng chú ý</h3>
          <p className="market-news-subtitle">Chọn lọc thị trường & doanh nghiệp</p>
        </div>
        {onViewAll && (
          <MagneticButton
            onClick={onViewAll}
            className="fintech-btn btn-secondary btn-sm market-news-view-all-btn"
          >
            Xem tất cả &rarr;
          </MagneticButton>
        )}
      </div>

      {/* Loading Skeleton */}
      {loading && displayItems.length === 0 && (
        <div className="market-news-skeleton-list" aria-label="Đang tải tin tức">
          {[1, 2, 3].map((i) => (
            <div key={i} className="market-news-skeleton-item">
              <div className="skeleton-shimmer" style={{ width: '60px', height: '18px', borderRadius: '4px', marginBottom: '8px' }} />
              <div className="skeleton-shimmer" style={{ width: '90%', height: '20px', borderRadius: '4px', marginBottom: '6px' }} />
              <div className="skeleton-shimmer" style={{ width: '100px', height: '14px', borderRadius: '4px' }} />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && displayItems.length === 0 && (
        <div className="fintech-banner banner-warning market-news-error" role="alert">
          <span>Không thể tải tin tức lúc này ({error}).</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && displayItems.length === 0 && (
        <div className="market-news-empty">
          <span>Chưa có tin tức mới. Nhấn xem tất cả để tải đầy đủ.</span>
        </div>
      )}

      {/* Curated Editorial News List */}
      {displayItems.length > 0 && (
        <div className="market-news-list">
          {displayItems.map((item) => {
            const cat = CATEGORY_STYLES[item.category] || {
              label: item.category || 'Tin tức',
              bg: '#f8fafc',
              color: '#475569',
              border: '#e2e8f0'
            };

            return (
              <article key={item.id || item.url} className="market-news-card-item">
                <div className="market-news-card-meta">
                  <span
                    className="market-news-cat-badge"
                    style={{
                      backgroundColor: cat.bg,
                      color: cat.color,
                      borderColor: cat.border
                    }}
                  >
                    {cat.label}
                  </span>
                  <span className="market-news-source-badge">{item.source || 'Tin tức'}</span>
                  <span className="market-news-time-badge">{formatPublishedTime(item.publishedAt)}</span>
                </div>

                <h4 className="market-news-headline">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="market-news-link"
                  >
                    {item.title}
                  </a>
                </h4>

                {item.summary && (
                  <p className="market-news-excerpt">
                    {item.summary}
                  </p>
                )}

                {Array.isArray(item.relatedAssets) && item.relatedAssets.length > 0 && (
                  <div className="market-news-asset-tags">
                    {item.relatedAssets.slice(0, 3).map((sym) => (
                      <span key={sym} className="market-news-asset-chip">{sym}</span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
