import React, { useState, useEffect, useCallback } from 'react';

const CATEGORY_STYLES = {
  market: { label: 'Thị trường', bg: '#e7f1ff', color: '#0056b3', border: '#b8daff' },
  company: { label: 'Doanh nghiệp', bg: '#f3e8fd', color: '#5925dc', border: '#d8b4fe' },
  macro: { label: 'Vĩ mô', bg: '#e6f4ea', color: '#137333', border: '#b7e1cd' },
  global: { label: 'Tài chính quốc tế', bg: '#fff3e0', color: '#b06000', border: '#ffe0b2' }
};

function formatPublishedTime(isoString) {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('assets'); // 'assets' | 'news'

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
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [newsLoadedOnce, setNewsLoadedOnce] = useState(false);

  // Load all assets on mount
  useEffect(() => {
    fetch('/api/assets')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setAssets(json.data);
        } else {
          throw new Error(json.message || 'Failed to load assets');
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to connect to backend');
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
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setNews(json.data);
          setNewsLoadedOnce(true);
        } else {
          throw new Error(json.message || 'Failed to load news');
        }
        setNewsLoading(false);
        setNewsRefreshing(false);
      })
      .catch((err) => {
        setNewsError(err.message || 'Failed to fetch news feed');
        setNewsLoading(false);
        setNewsRefreshing(false);
      });
  }, []);

  // Fetch news when user switches to news tab for the first time
  useEffect(() => {
    if (activeTab === 'news' && !newsLoadedOnce && !newsLoading) {
      fetchNews(true);
    }
  }, [activeTab, newsLoadedOnce, newsLoading, fetchNews]);

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
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setMarketData(json.data);
        } else {
          throw new Error(json.message || 'Failed to load market snapshot');
        }
        setMarketLoading(false);
        setIsRefreshing(false);
      })
      .catch((err) => {
        setMarketError(err.message || 'Market snapshot unavailable');
        setMarketLoading(false);
        setIsRefreshing(false);
      });
  }, []);

  // Automatic 5-minute refresh timer for market snapshot
  useEffect(() => {
    if (!selectedSymbol) return;

    // Refresh every 5 minutes (300,000 ms)
    const intervalId = setInterval(() => {
      fetchMarketData(selectedSymbol, false);
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [selectedSymbol, fetchMarketData]);

  const handleSelectAsset = (symbol) => {
    setSelectedSymbol(symbol);
    setDetailLoading(true);
    setDetailError(null);
    setAssetDetail(null);

    // 1. Fetch asset details from database
    fetch(`/api/assets/${encodeURIComponent(symbol)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setAssetDetail(json.data);
        } else {
          throw new Error(json.message || `Failed to load asset details for ${symbol}`);
        }
        setDetailLoading(false);
      })
      .catch((err) => {
        setDetailError(err.message || `Failed to load asset details for ${symbol}`);
        setDetailLoading(false);
      });

    // 2. Fetch initial market snapshot
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
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '850px', margin: '0 auto', color: '#222' }}>
      <header style={{ marginBottom: '1.5rem', borderBottom: '2px solid #e0e0e0', paddingBottom: '1rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '1.8rem', color: '#1a1a1a' }}>VN Invest Assistant</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '0.95rem' }}>Personal Investment Assistant for Vietnamese Financial Markets</p>

        {/* Navigation Tabs */}
        <nav style={{ display: 'flex', gap: '0.5rem', marginTop: '1.2rem' }}>
          <button
            onClick={() => setActiveTab('assets')}
            style={{
              padding: '8px 16px',
              fontSize: '0.95rem',
              fontWeight: activeTab === 'assets' ? 'bold' : 'normal',
              backgroundColor: activeTab === 'assets' ? '#0066cc' : '#f0f0f0',
              color: activeTab === 'assets' ? '#fff' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            📊 Asset Browser
          </button>
          <button
            onClick={() => setActiveTab('news')}
            style={{
              padding: '8px 16px',
              fontSize: '0.95rem',
              fontWeight: activeTab === 'news' ? 'bold' : 'normal',
              backgroundColor: activeTab === 'news' ? '#0066cc' : '#f0f0f0',
              color: activeTab === 'news' ? '#fff' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            📰 News Feed (CafeF)
          </button>
        </nav>
      </header>

      {/* TAB 1: ASSET BROWSER */}
      {activeTab === 'assets' && (
        <section>
          <h2>Asset Browser</h2>

          {/* Asset Detail View */}
          {selectedSymbol ? (
            <div>
              <button
                onClick={handleBackToList}
                style={{
                  padding: '6px 12px',
                  marginBottom: '1rem',
                  cursor: 'pointer'
                }}
              >
                &larr; Back to Assets List
              </button>

              {detailLoading && <p>Loading details for {selectedSymbol}...</p>}

              {detailError && (
                <div style={{ color: 'red', marginBottom: '1rem' }}>
                  <p><strong>Error loading asset details:</strong> {detailError}</p>
                </div>
              )}

              {assetDetail && (
                <div style={{ border: '1px solid #ddd', padding: '1.5rem', borderRadius: '4px', marginBottom: '1.5rem' }}>
                  <h3 style={{ marginTop: 0 }}>{assetDetail.symbol} — {assetDetail.name}</h3>
                  <p><strong>ID:</strong> {assetDetail.id}</p>
                  <p><strong>Symbol:</strong> {assetDetail.symbol}</p>
                  <p><strong>Name:</strong> {assetDetail.name}</p>
                  <p><strong>Asset Type:</strong> {assetDetail.asset_type || 'N/A'}</p>
                  <p><strong>Exchange:</strong> {assetDetail.exchange || 'N/A'}</p>
                  <p><strong>Created At:</strong> {assetDetail.created_at}</p>
                </div>
              )}

              {/* Market Snapshot Section */}
              <div style={{ border: '1px solid #cce5ff', backgroundColor: '#f0f8ff', padding: '1.5rem', borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0, color: '#004085' }}>Market Snapshot</h3>
                  <button
                    onClick={() => fetchMarketData(selectedSymbol, false)}
                    disabled={isRefreshing || marketLoading}
                    style={{
                      padding: '4px 10px',
                      cursor: isRefreshing || marketLoading ? 'default' : 'pointer',
                      fontSize: '0.85rem'
                    }}
                  >
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0, marginBottom: '1rem' }}>
                  <em>Delayed market data</em>
                </p>

                {marketLoading && <p>Loading market snapshot...</p>}

                {marketError && (
                  <div style={{ color: '#721c24' }}>
                    <p><strong>Notice:</strong> Unable to load market snapshot ({marketError}).</p>
                  </div>
                )}

                {marketData && (
                  <div>
                    <p>
                      <strong>Latest Price:</strong>{' '}
                      <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                        {marketData.price !== null ? marketData.price.toLocaleString() : 'N/A'} {marketData.currency}
                      </span>
                    </p>
                    <p>
                      <strong>Price Change:</strong>{' '}
                      <span style={{ color: (marketData.change || 0) >= 0 ? 'green' : 'red', fontWeight: 'bold' }}>
                        {marketData.change !== null ? (marketData.change > 0 ? `+${marketData.change.toLocaleString()}` : marketData.change.toLocaleString()) : 'N/A'}{' '}
                        ({marketData.changePercent !== null ? (marketData.changePercent > 0 ? `+${marketData.changePercent}%` : `${marketData.changePercent}%`) : 'N/A'})
                      </span>
                    </p>
                    <p><strong>Day High:</strong> {marketData.dayHigh !== null ? marketData.dayHigh.toLocaleString() : 'N/A'} {marketData.currency}</p>
                    <p><strong>Day Low:</strong> {marketData.dayLow !== null ? marketData.dayLow.toLocaleString() : 'N/A'} {marketData.currency}</p>
                    <p><strong>Volume:</strong> {marketData.volume !== null ? marketData.volume.toLocaleString() : 'N/A'}</p>
                    <p><strong>Last Updated Time:</strong> {marketData.updatedAt || 'N/A'}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Asset List View */
            <div>
              {loading && <p>Loading assets from database...</p>}

              {error && (
                <div style={{ color: 'red', marginBottom: '1rem' }}>
                  <p><strong>Error loading assets:</strong> {error}</p>
                </div>
              )}

              {!loading && !error && assets.length === 0 && (
                <p>No assets found in database.</p>
              )}

              {!loading && !error && assets.length > 0 && (
                <div>
                  <p>Total assets: {assets.length} (click a symbol to view details)</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                        <th style={{ padding: '8px' }}>Symbol</th>
                        <th style={{ padding: '8px' }}>Name</th>
                        <th style={{ padding: '8px' }}>Type</th>
                        <th style={{ padding: '8px' }}>Exchange</th>
                        <th style={{ padding: '8px' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.map((asset) => (
                        <tr key={asset.id || asset.symbol} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px', fontWeight: 'bold' }}>
                            <button
                              onClick={() => handleSelectAsset(asset.symbol)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#0066cc',
                                textDecoration: 'underline',
                                cursor: 'pointer',
                                padding: 0,
                                fontWeight: 'bold',
                                fontSize: 'inherit'
                              }}
                            >
                              {asset.symbol}
                            </button>
                          </td>
                          <td style={{ padding: '8px' }}>{asset.name}</td>
                          <td style={{ padding: '8px' }}>{asset.asset_type || 'N/A'}</td>
                          <td style={{ padding: '8px' }}>{asset.exchange || 'N/A'}</td>
                          <td style={{ padding: '8px' }}>
                            <button
                              onClick={() => handleSelectAsset(asset.symbol)}
                              style={{ cursor: 'pointer', padding: '4px 8px' }}
                            >
                              View
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

      {/* TAB 2: NEWS FEED */}
      {activeTab === 'news' && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>News Feed</h2>
            <button
              onClick={() => fetchNews(false)}
              disabled={newsRefreshing || newsLoading}
              style={{
                padding: '6px 12px',
                cursor: newsRefreshing || newsLoading ? 'default' : 'pointer',
                fontSize: '0.9rem',
                backgroundColor: '#f8f9fa',
                border: '1px solid #ccc',
                borderRadius: '4px'
              }}
            >
              {newsRefreshing ? 'Refreshing...' : '🔄 Refresh News'}
            </button>
          </div>

          <p style={{ color: '#666', fontSize: '0.88rem', marginTop: 0, marginBottom: '1.5rem' }}>
            Real-time financial and market updates from <strong>CafeF</strong> (thi-truong-chung-khoan, doanh-nghiep, vi-mo-dau-tu, tai-chinh-quoc-te).
          </p>

          {/* Loading State */}
          {newsLoading && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#666', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
              <p style={{ margin: 0, fontSize: '1rem' }}>Loading latest news from CafeF...</p>
            </div>
          )}

          {/* Error State */}
          {newsError && !newsLoading && news.length === 0 && (
            <div style={{ color: '#721c24', backgroundColor: '#f8d7da', border: '1px solid #f5c6cb', padding: '1.2rem', borderRadius: '4px', marginBottom: '1rem' }}>
              <p style={{ margin: '0 0 0.8rem 0' }}><strong>Error loading news feed:</strong> {newsError}</p>
              <button
                onClick={() => fetchNews(true)}
                style={{ padding: '6px 12px', cursor: 'pointer', backgroundColor: '#721c24', color: '#fff', border: 'none', borderRadius: '4px' }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Non-fatal error banner if refresh failed but old news is available */}
          {newsError && news.length > 0 && (
            <div style={{ color: '#856404', backgroundColor: '#fff3cd', border: '1px solid #ffeeba', padding: '0.8rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.88rem' }}>
              Notice: Could not refresh news feed ({newsError}). Showing cached items.
            </div>
          )}

          {/* Empty State */}
          {!newsLoading && !newsError && news.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#666', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
              <p style={{ margin: 0 }}>No news articles found.</p>
            </div>
          )}

          {/* News List */}
          {!newsLoading && news.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {news.map((item) => {
                const catStyle = CATEGORY_STYLES[item.category] || { label: item.category, bg: '#eee', color: '#333', border: '#ccc' };
                return (
                  <article
                    key={item.id || item.url}
                    style={{
                      border: '1px solid #e0e0e0',
                      borderRadius: '6px',
                      padding: '1.2rem',
                      backgroundColor: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                    }}
                  >
                    {/* Header meta badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: catStyle.bg,
                          color: catStyle.color,
                          border: `1px solid ${catStyle.border}`
                        }}
                      >
                        {catStyle.label}
                      </span>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: '#f1f3f5',
                          color: '#495057',
                          border: '1px solid #dee2e6'
                        }}
                      >
                        {item.source || 'CafeF'}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: '#777', marginLeft: 'auto' }}>
                        {formatPublishedTime(item.publishedAt)}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 style={{ margin: '0 0 0.6rem 0', fontSize: '1.1rem', lineHeight: '1.4' }}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#0056b3', textDecoration: 'none' }}
                        onMouseOver={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseOut={(e) => (e.currentTarget.style.textDecoration = 'none')}
                      >
                        {item.title}
                      </a>
                    </h3>

                    {/* Summary */}
                    {item.summary && (
                      <p style={{ margin: '0 0 0.8rem 0', color: '#444', fontSize: '0.92rem', lineHeight: '1.5' }}>
                        {item.summary}
                      </p>
                    )}

                    {/* Footer link */}
                    <div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '0.85rem', color: '#0066cc', textDecoration: 'none', fontWeight: '500' }}
                        onMouseOver={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseOut={(e) => (e.currentTarget.style.textDecoration = 'none')}
                      >
                        Xem bài viết gốc trên CafeF &rarr;
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
