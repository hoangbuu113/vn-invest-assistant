import React from 'react';
import { formatPublishedTime } from '../utils/formatting.js';
import { MagneticButton } from './MotionHelpers.jsx';

const CATEGORY_LABELS = {
  macro: 'Vĩ mô',
  market: 'Thị trường',
  company: 'Doanh nghiệp',
  global: 'Quốc tế',
  crypto: 'Crypto',
  gold: 'Vàng'
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
            const catLabel = CATEGORY_LABELS[item.category] || item.category || 'Tin tức';
            const catClass = item.category ? `news-cat-${item.category}` : 'news-cat-default';

            return (
              <article key={item.id || item.url} className="market-news-card-item">
                <div className="market-news-card-meta">
                  <span className={`market-news-cat-badge ${catClass}`}>
                    {catLabel}
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
                    {item.relatedAssets.slice(0, 3).map((asset, idx) => {
                      const tagLabel = typeof asset === 'string'
                        ? asset
                        : (asset?.symbol || asset?.assetId || asset?.name || '');
                      if (!tagLabel) return null;
                      return (
                        <span key={asset?.assetId || tagLabel || idx} className="market-news-asset-chip">
                          {tagLabel}
                        </span>
                      );
                    })}
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
