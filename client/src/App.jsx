import React, { useState, useEffect, useCallback } from 'react';

function App() {
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
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>VN Invest Assistant</h1>
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
    </div>
  );
}

export default App;
