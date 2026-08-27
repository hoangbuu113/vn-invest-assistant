import React, { useState, useEffect } from 'react';

function App() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selected asset detail state
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [assetDetail, setAssetDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

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

  const handleSelectAsset = (symbol) => {
    setSelectedSymbol(symbol);
    setDetailLoading(true);
    setDetailError(null);
    setAssetDetail(null);

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
  };

  const handleBackToList = () => {
    setSelectedSymbol(null);
    setAssetDetail(null);
    setDetailError(null);
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
            <div style={{ border: '1px solid #ddd', padding: '1.5rem', borderRadius: '4px' }}>
              <h3 style={{ marginTop: 0 }}>{assetDetail.symbol} — {assetDetail.name}</h3>
              <p><strong>ID:</strong> {assetDetail.id}</p>
              <p><strong>Symbol:</strong> {assetDetail.symbol}</p>
              <p><strong>Name:</strong> {assetDetail.name}</p>
              <p><strong>Asset Type:</strong> {assetDetail.asset_type || 'N/A'}</p>
              <p><strong>Exchange:</strong> {assetDetail.exchange || 'N/A'}</p>
              <p><strong>Created At:</strong> {assetDetail.created_at}</p>
            </div>
          )}
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
