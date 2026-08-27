import React, { useState, useEffect, useCallback } from 'react';

const CATEGORY_STYLES = {
  market: { label: 'Thị trường', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  company: { label: 'Doanh nghiệp', bg: '#faf5ff', color: '#7c3aed', border: '#e9d5ff' },
  macro: { label: 'Vĩ mô', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  global: { label: 'Quốc tế', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' }
};

function formatPublishedTime(isoString) {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch {
    return isoString;
  }
}

const ASSET_TYPE_LABELS = {
  stock: 'Cổ phiếu',
  etf: 'ETF',
  fund: 'Quỹ đầu tư',
  gold: 'Vàng',
  deposit: 'Tiền gửi',
  bank_deposit: 'Tiền gửi',
  bond: 'Trái phiếu'
};

function formatAssetType(assetType) {
  if (!assetType) return 'N/A';
  return ASSET_TYPE_LABELS[String(assetType).toLowerCase()] || assetType;
}

function App() {
  const [activeTab, setActiveTab] = useState('news'); // 'news' | 'assets' | 'profile'

  // Profile state
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Form states
  const [cashAvailable, setCashAvailable] = useState('');
  const [riskTolerance, setRiskTolerance] = useState('moderate');
  const [investmentHorizon, setInvestmentHorizon] = useState('medium');

  // Assets state
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selected asset detail state
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [assetDetail, setAssetDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // Market snapshot state
  const [marketData, setMarketData] = useState(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketError, setMarketError] = useState(null);

  // News feed state
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [newsError, setNewsError] = useState(null);

  // Fetch investor profile data
  const fetchProfile = useCallback((isInitial = false) => {
    if (isInitial) {
      setProfileLoading(true);
    }
    setProfileError(null);

    fetch('/api/profile')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setProfile(json.data);
          setCashAvailable(json.data.cash_available !== undefined ? String(json.data.cash_available) : '0');
          setRiskTolerance(json.data.risk_tolerance || 'moderate');
          setInvestmentHorizon(json.data.investment_horizon || 'medium');
        } else {
          throw new Error(json.message || 'Không thể tải hồ sơ đầu tư');
        }
      })
      .catch((err) => {
        setProfileError(err.message || 'Không thể tải hồ sơ đầu tư');
      })
      .finally(() => {
        setProfileLoading(false);
      });
  }, []);

  // Fetch profile on initial mount
  useEffect(() => {
    fetchProfile(true);
  }, [fetchProfile]);

  // Handle saving profile changes
  const handleSaveProfile = (e) => {
    if (e && e.preventDefault) e.preventDefault();

    const numericCash = Number(cashAvailable);
    if (cashAvailable === '' || isNaN(numericCash) || !isFinite(numericCash) || numericCash < 0) {
      setProfileError('Tiền sẵn sàng đầu tư phải là số hợp lệ không âm.');
      setProfileSuccess(false);
      return;
    }

    setProfileSaving(true);
    setProfileError(null);
    setProfileSuccess(false);

    fetch('/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cash_available: numericCash,
        risk_tolerance: riskTolerance,
        investment_horizon: investmentHorizon
      })
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((json) => {
            const errMsg = json.errors ? json.errors.join(', ') : json.message || `HTTP ${res.status}`;
            throw new Error(errMsg);
          });
        }
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setProfile(json.data);
          setCashAvailable(String(json.data.cash_available));
          setRiskTolerance(json.data.risk_tolerance);
          setInvestmentHorizon(json.data.investment_horizon);
          setProfileSuccess(true);
        } else {
          throw new Error(json.message || 'Không thể lưu hồ sơ đầu tư');
        }
      })
      .catch((err) => {
        setProfileError(err.message || 'Không thể lưu thay đổi hồ sơ đầu tư');
      })
      .finally(() => {
        setProfileSaving(false);
      });
  };

  // Load all assets on mount
  useEffect(() => {
    fetch('/api/assets')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setAssets(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải danh sách tài sản');
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Không thể kết nối đến máy chủ');
        setLoading(false);
      });
  }, []);

  // Fetch news data
  const fetchNews = useCallback((isInitial = false) => {
    if (isInitial) {
      setNewsLoading(true);
    } else {
      setNewsRefreshing(true);
    }
    setNewsError(null);

    fetch('/api/news')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setNews(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải tin tức');
        }
      })
      .catch((err) => {
        setNewsError(err.message || 'Không thể tải nguồn tin tức');
      })
      .finally(() => {
        setNewsLoading(false);
        setNewsRefreshing(false);
      });
  }, []);

  // Fetch news on initial mount
  useEffect(() => {
    fetchNews(true);
  }, [fetchNews]);

  const fetchMarketData = useCallback((symbol, isInitial = false) => {
    if (!symbol) return;

    if (isInitial) {
      setMarketLoading(true);
      setMarketData(null);
    } else {
      setIsRefreshing(true);
    }
    setMarketError(null);

    fetch(`/api/market/${encodeURIComponent(symbol)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setMarketData(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải dữ liệu giá thị trường');
        }
        setMarketLoading(false);
        setIsRefreshing(false);
      })
      .catch((err) => {
        setMarketError(err.message || 'Dữ liệu giá thị trường không khả dụng');
        setMarketLoading(false);
        setIsRefreshing(false);
      });
  }, []);

  // Automatic 5-minute refresh timer for market snapshot
  useEffect(() => {
    if (!selectedSymbol) return;

    const intervalId = setInterval(() => {
      fetchMarketData(selectedSymbol, false);
    }, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [selectedSymbol, fetchMarketData]);

  const handleSelectAsset = (symbol) => {
    setSelectedSymbol(symbol);
    setDetailLoading(true);
    setDetailError(null);
    setAssetDetail(null);

    fetch(`/api/assets/${encodeURIComponent(symbol)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setAssetDetail(json.data);
        } else {
          throw new Error(json.message || `Không thể tải thông tin chi tiết cho ${symbol}`);
        }
        setDetailLoading(false);
      })
      .catch((err) => {
        setDetailError(err.message || `Không thể tải thông tin chi tiết cho ${symbol}`);
        setDetailLoading(false);
      });

    fetchMarketData(symbol, true);
  };

  const handleBackToList = () => {
    setSelectedSymbol(null);
    setAssetDetail(null);
    setDetailError(null);
    setMarketData(null);
    setMarketError(null);
    setIsRefreshing(false);
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      backgroundColor: '#f8fafc',
      minHeight: '100vh',
      color: '#0f172a'
    }}>
      {/* Top Application Shell Header */}
      <header style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div style={{
          maxWidth: '920px',
          margin: '0 auto',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>📈</span>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>
                VN Invest Assistant
              </h1>
            </div>
          </div>

          {/* Compact Segmented Navigation */}
          <nav style={{
            display: 'flex',
            backgroundColor: '#f1f5f9',
            padding: '3px',
            borderRadius: '6px',
            gap: '2px'
          }}>
            <button
              onClick={() => setActiveTab('news')}
              style={{
                padding: '6px 14px',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'news' ? 600 : 500,
                backgroundColor: activeTab === 'news' ? '#ffffff' : 'transparent',
                color: activeTab === 'news' ? '#0f172a' : '#64748b',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                boxShadow: activeTab === 'news' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              Tin tức
            </button>
            <button
              onClick={() => setActiveTab('assets')}
              style={{
                padding: '6px 14px',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'assets' ? 600 : 500,
                backgroundColor: activeTab === 'assets' ? '#ffffff' : 'transparent',
                color: activeTab === 'assets' ? '#0f172a' : '#64748b',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                boxShadow: activeTab === 'assets' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              Tài sản
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              style={{
                padding: '6px 14px',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'profile' ? 600 : 500,
                backgroundColor: activeTab === 'profile' ? '#ffffff' : 'transparent',
                color: activeTab === 'profile' ? '#0f172a' : '#64748b',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                boxShadow: activeTab === 'profile' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              Hồ sơ đầu tư
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: '920px', margin: '0 auto', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>

        {/* TAB 1: NEWS FEED */}
        {activeTab === 'news' && (
          <section>
            {/* News Section Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '1rem',
              gap: '1rem'
            }}>
              <div>
                <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                  Tin tức thị trường
                </h2>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                  Cập nhật tin tức tài chính, doanh nghiệp và vĩ mô mới nhất · <span style={{ color: '#94a3b8' }}>Nguồn: CafeF</span>
                </p>
              </div>

              {/* Compact Refresh Button */}
              <button
                onClick={() => fetchNews(false)}
                disabled={newsRefreshing || newsLoading}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  backgroundColor: '#ffffff',
                  color: newsRefreshing || newsLoading ? '#94a3b8' : '#334155',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  cursor: newsRefreshing || newsLoading ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  whiteSpace: 'nowrap'
                }}
              >
                <span>{newsRefreshing ? '⟳' : '↻'}</span>
                <span>{newsRefreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
              </button>
            </div>

            {/* Loading State */}
            {newsLoading && (
              <div style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '3rem 2rem',
                textAlign: 'center',
                color: '#64748b'
              }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
                <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500 }}>Đang tải tin tức mới nhất từ CafeF...</p>
              </div>
            )}

            {/* Fatal Error State */}
            {newsError && !newsLoading && news.length === 0 && (
              <div style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                padding: '1.25rem 1.5rem',
                color: '#991b1b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <strong style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Không thể tải tin tức</strong>
                  <span style={{ fontSize: '0.85rem' }}>{newsError}</span>
                </div>
                <button
                  onClick={() => fetchNews(true)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    backgroundColor: '#991b1b',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Thử lại
                </button>
              </div>
            )}

            {/* Non-fatal Refresh Error Banner */}
            {newsError && news.length > 0 && (
              <div style={{
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '6px',
                padding: '0.6rem 1rem',
                marginBottom: '1rem',
                fontSize: '0.82rem',
                color: '#92400e'
              }}>
                Không thể làm mới nguồn tin ({newsError}). Đang hiển thị các tin tức trước đó.
              </div>
            )}

            {/* Empty State */}
            {!newsLoading && !newsError && news.length === 0 && (
              <div style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '3rem 2rem',
                textAlign: 'center',
                color: '#64748b'
              }}>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>Hiện chưa có tin tức nào.</p>
              </div>
            )}

            {/* News Articles List */}
            {!newsLoading && news.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {news.map((item) => {
                  const cat = CATEGORY_STYLES[item.category] || { label: item.category, bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
                  return (
                    <article
                      key={item.id || item.url}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '1rem 1.25rem',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        transition: 'border-color 0.15s ease'
                      }}
                    >
                      {/* Meta Row: Category Badge + Timestamp */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: cat.bg,
                          color: cat.color,
                          border: `1px solid ${cat.border}`,
                          letterSpacing: '0.02em',
                          textTransform: 'uppercase'
                        }}>
                          {cat.label}
                        </span>

                        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                          {formatPublishedTime(item.publishedAt)}
                        </span>
                      </div>

                      {/* Headline Link */}
                      <h3 style={{ margin: '0 0 0.4rem 0', fontSize: '1.02rem', lineHeight: '1.45', fontWeight: 600 }}>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: '#0f172a',
                            textDecoration: 'none'
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.color = '#2563eb')}
                          onMouseOut={(e) => (e.currentTarget.style.color = '#0f172a')}
                        >
                          {item.title}
                        </a>
                      </h3>

                      {/* Summary */}
                      {item.summary && (
                        <p style={{
                          margin: '0 0 0.6rem 0',
                          fontSize: '0.88rem',
                          color: '#475569',
                          lineHeight: '1.55'
                        }}>
                          {item.summary}
                        </p>
                      )}

                      {/* Footer Row: Attribution + Read Original Link */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          CafeF
                        </span>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 500,
                            color: '#2563eb',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseOut={(e) => (e.currentTarget.style.textDecoration = 'none')}
                        >
                          Đọc bài gốc ↗
                        </a>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: ASSET BROWSER */}
        {activeTab === 'assets' && (
          <section>
            {/* Detail View */}
            {selectedSymbol ? (
              <div>
                <button
                  onClick={handleBackToList}
                  style={{
                    padding: '6px 12px',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    backgroundColor: '#ffffff',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  &larr; Quay lại danh sách
                </button>

                {detailLoading && <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Đang tải thông tin chi tiết cho {selectedSymbol}...</p>}

                {detailError && (
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '1rem', borderRadius: '6px', marginBottom: '1rem' }}>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}><strong>Lỗi:</strong> {detailError}</p>
                  </div>
                )}

                {assetDetail && (
                  <div style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '1.25rem 1.5rem',
                    marginBottom: '1rem'
                  }}>
                    <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem', color: '#0f172a' }}>
                      {assetDetail.symbol} <span style={{ color: '#64748b', fontWeight: 400 }}>· {assetDetail.name}</span>
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.88rem' }}>
                      <div><span style={{ color: '#64748b' }}>Mã:</span> <strong>{assetDetail.symbol}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Loại tài sản:</span> <strong>{formatAssetType(assetDetail.asset_type)}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Sàn:</span> <strong>{assetDetail.exchange || 'N/A'}</strong></div>
                      <div><span style={{ color: '#64748b' }}>ID:</span> <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{assetDetail.id}</span></div>
                    </div>
                  </div>
                )}

                {/* Market Snapshot Card */}
                <div style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '1.25rem 1.5rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a', fontWeight: 600 }}>Giá thị trường</h3>
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Dữ liệu thị trường có độ trễ (~15 phút)</span>
                    </div>
                    <button
                      onClick={() => fetchMarketData(selectedSymbol, false)}
                      disabled={isRefreshing || marketLoading}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        backgroundColor: '#ffffff',
                        color: isRefreshing || marketLoading ? '#94a3b8' : '#334155',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        cursor: isRefreshing || marketLoading ? 'default' : 'pointer'
                      }}
                    >
                      {isRefreshing ? 'Đang làm mới...' : 'Làm mới'}
                    </button>
                  </div>

                  {marketLoading && <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Đang tải dữ liệu giá thị trường...</p>}

                  {marketError && (
                    <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                      Thông báo: Không thể tải dữ liệu giá thị trường ({marketError}).
                    </div>
                  )}

                  {marketData && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '1rem' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>
                          {marketData.price !== null ? marketData.price.toLocaleString() : 'N/A'} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#64748b' }}>{marketData.currency}</span>
                        </span>
                        <span style={{
                          fontSize: '0.95rem',
                          fontWeight: 600,
                          color: (marketData.change || 0) >= 0 ? '#16a34a' : '#dc2626'
                        }}>
                          {marketData.change !== null ? (marketData.change > 0 ? `+${marketData.change.toLocaleString()}` : marketData.change.toLocaleString()) : 'N/A'}{' '}
                          ({marketData.changePercent !== null ? (marketData.changePercent > 0 ? `+${marketData.changePercent}%` : `${marketData.changePercent}%`) : 'N/A'})
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
                        <div><span style={{ color: '#64748b' }}>Cao nhất trong ngày:</span> <strong>{marketData.dayHigh !== null ? marketData.dayHigh.toLocaleString() : 'N/A'}</strong></div>
                        <div><span style={{ color: '#64748b' }}>Thấp nhất trong ngày:</span> <strong>{marketData.dayLow !== null ? marketData.dayLow.toLocaleString() : 'N/A'}</strong></div>
                        <div><span style={{ color: '#64748b' }}>Khối lượng:</span> <strong>{marketData.volume !== null ? marketData.volume.toLocaleString() : 'N/A'}</strong></div>
                        <div><span style={{ color: '#64748b' }}>Cập nhật lúc:</span> <span style={{ color: '#64748b' }}>{formatPublishedTime(marketData.updatedAt)}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Asset List View */
              <div>
                <div style={{ marginBottom: '1rem' }}>
                  <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                    Danh sách tài sản
                  </h2>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                    Danh sách tài sản đang theo dõi ({assets.length} mã)
                  </p>
                </div>

                {loading && <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Đang tải danh sách tài sản...</p>}

                {error && (
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '1rem', borderRadius: '6px', marginBottom: '1rem' }}>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}><strong>Lỗi tải danh sách tài sản:</strong> {error}</p>
                  </div>
                )}

                {!loading && !error && assets.length === 0 && (
                  <p style={{ color: '#64748b' }}>Không tìm thấy tài sản nào trong cơ sở dữ liệu.</p>
                )}

                {!loading && !error && assets.length > 0 && (
                  <div style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    overflow: 'hidden'
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <th style={{ padding: '10px 16px', fontWeight: 600 }}>Mã</th>
                          <th style={{ padding: '10px 16px', fontWeight: 600 }}>Tên</th>
                          <th style={{ padding: '10px 16px', fontWeight: 600 }}>Loại tài sản</th>
                          <th style={{ padding: '10px 16px', fontWeight: 600 }}>Sàn</th>
                          <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assets.map((asset) => (
                          <tr
                            key={asset.id || asset.symbol}
                            style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                            onClick={() => handleSelectAsset(asset.symbol)}
                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
                          >
                            <td style={{ padding: '10px 16px', fontWeight: 700, color: '#0f172a' }}>
                              {asset.symbol}
                            </td>
                            <td style={{ padding: '10px 16px', color: '#334155' }}>
                              {asset.name}
                            </td>
                            <td style={{ padding: '10px 16px', color: '#64748b' }}>
                              {formatAssetType(asset.asset_type)}
                            </td>
                            <td style={{ padding: '10px 16px', color: '#64748b' }}>
                              {asset.exchange || 'N/A'}
                            </td>
                            <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectAsset(asset.symbol);
                                }}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '0.8rem',
                                  fontWeight: 500,
                                  backgroundColor: '#ffffff',
                                  color: '#2563eb',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                Xem
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: INVESTOR PROFILE */}
        {activeTab === 'profile' && (
          <section>
            <div style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                Hồ sơ đầu tư
              </h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                Quản lý số tiền sẵn sàng đầu tư, mức chấp nhận rủi ro và thời gian đầu tư của bạn
              </p>
            </div>

            {/* Loading State */}
            {profileLoading && (
              <div style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '3rem 2rem',
                textAlign: 'center',
                color: '#64748b'
              }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
                <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500 }}>Đang tải hồ sơ đầu tư...</p>
              </div>
            )}

            {/* Fatal Fetch Error State */}
            {profileError && !profile && !profileLoading && (
              <div style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                padding: '1.25rem 1.5rem',
                color: '#991b1b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem'
              }}>
                <div>
                  <strong style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Không thể tải hồ sơ đầu tư</strong>
                  <span style={{ fontSize: '0.85rem' }}>{profileError}</span>
                </div>
                <button
                  onClick={() => fetchProfile(true)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    backgroundColor: '#991b1b',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Thử lại
                </button>
              </div>
            )}

            {/* Success Banner */}
            {profileSuccess && (
              <div style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '6px',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                fontSize: '0.88rem',
                color: '#15803d',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span>✓</span>
                <span>Đã lưu hồ sơ đầu tư thành công!</span>
              </div>
            )}

            {/* Save Error Banner */}
            {profileError && profile && (
              <div style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                fontSize: '0.88rem',
                color: '#991b1b'
              }}>
                {profileError}
              </div>
            )}

            {/* Profile Form Card */}
            {!profileLoading && (
              <div style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '1.5rem',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
              }}>
                <form onSubmit={handleSaveProfile}>
                  {/* Field 1: Available Cash */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                      Tiền sẵn sàng đầu tư
                    </label>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.82rem', color: '#64748b' }}>
                      Số tiền bạn hiện có thể sử dụng để đầu tư (tính theo VNĐ).
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <input
                        type="number"
                        min="0"
                        step="100000"
                        value={cashAvailable}
                        onChange={(e) => {
                          setCashAvailable(e.target.value);
                          setProfileSuccess(false);
                          setProfileError(null);
                        }}
                        required
                        placeholder="Ví dụ: 100000000"
                        style={{
                          width: '100%',
                          maxWidth: '360px',
                          padding: '8px 12px',
                          fontSize: '0.95rem',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                      <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#475569' }}>
                        VNĐ
                      </span>
                    </div>
                    {/* Live Formatted VND Preview */}
                    {!isNaN(Number(cashAvailable)) && cashAvailable !== '' && Number(cashAvailable) >= 0 && (
                      <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: '#2563eb' }}>
                        ≈ {Number(cashAvailable).toLocaleString('vi-VN')} ₫
                      </div>
                    )}
                  </div>

                  {/* Field 2: Risk Tolerance */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                      Mức chấp nhận rủi ro
                    </label>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.82rem', color: '#64748b' }}>
                      Mức độ chấp nhận biến động giá và rủi ro sụt giảm tài sản của bạn.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                      {[
                        { value: 'low', label: 'Thấp', desc: 'Bảo toàn vốn, hạn chế rủi ro tối đa' },
                        { value: 'moderate', label: 'Vừa', desc: 'Cân bằng giữa lợi nhuận và an toàn' },
                        { value: 'high', label: 'Cao', desc: 'Kỳ vọng tăng trưởng cao, chấp nhận biến động lớn' }
                      ].map((item) => (
                        <label
                          key={item.value}
                          style={{
                            display: 'block',
                            padding: '0.85rem 1rem',
                            borderRadius: '6px',
                            border: `1.5px solid ${riskTolerance === item.value ? '#2563eb' : '#e2e8f0'}`,
                            backgroundColor: riskTolerance === item.value ? '#eff6ff' : '#ffffff',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <input
                              type="radio"
                              name="risk_tolerance"
                              value={item.value}
                              checked={riskTolerance === item.value}
                              onChange={(e) => {
                                setRiskTolerance(e.target.value);
                                setProfileSuccess(false);
                                setProfileError(null);
                              }}
                              style={{ margin: 0 }}
                            />
                            <strong style={{ fontSize: '0.9rem', color: riskTolerance === item.value ? '#1d4ed8' : '#0f172a' }}>
                              {item.label}
                            </strong>
                          </div>
                          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block' }}>
                            {item.desc}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Field 3: Investment Horizon */}
                  <div style={{ marginBottom: '1.75rem' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                      Thời gian đầu tư
                    </label>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.82rem', color: '#64748b' }}>
                      Khoảng thời gian dự kiến trước khi bạn cần rút hoặc sử dụng vốn đầu tư.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                      {[
                        { value: 'short', label: 'Ngắn hạn', desc: 'Dưới 1 năm' },
                        { value: 'medium', label: 'Trung hạn', desc: 'Từ 1 đến 3 năm' },
                        { value: 'long', label: 'Dài hạn', desc: 'Trên 3 năm' }
                      ].map((item) => (
                        <label
                          key={item.value}
                          style={{
                            display: 'block',
                            padding: '0.85rem 1rem',
                            borderRadius: '6px',
                            border: `1.5px solid ${investmentHorizon === item.value ? '#2563eb' : '#e2e8f0'}`,
                            backgroundColor: investmentHorizon === item.value ? '#eff6ff' : '#ffffff',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <input
                              type="radio"
                              name="investment_horizon"
                              value={item.value}
                              checked={investmentHorizon === item.value}
                              onChange={(e) => {
                                setInvestmentHorizon(e.target.value);
                                setProfileSuccess(false);
                                setProfileError(null);
                              }}
                              style={{ margin: 0 }}
                            />
                            <strong style={{ fontSize: '0.9rem', color: investmentHorizon === item.value ? '#1d4ed8' : '#0f172a' }}>
                              {item.label}
                            </strong>
                          </div>
                          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block' }}>
                            {item.desc}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Actions & Meta */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '1rem',
                    borderTop: '1px solid #f1f5f9'
                  }}>
                    <button
                      type="submit"
                      disabled={profileSaving}
                      style={{
                        padding: '8px 20px',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        backgroundColor: profileSaving ? '#93c5fd' : '#2563eb',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: profileSaving ? 'default' : 'pointer',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        transition: 'background-color 0.15s ease'
                      }}
                    >
                      {profileSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                    </button>

                    {profile && profile.updated_at && (
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                        Cập nhật lúc: {formatPublishedTime(profile.updated_at)}
                      </span>
                    )}
                  </div>
                </form>
              </div>
            )}
          </section>
        )}

      </main>
    </div>
  );
}

export default App;
