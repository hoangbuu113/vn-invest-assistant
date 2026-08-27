import React, { useState, useEffect } from 'react';

function App() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>VN Invest Assistant</h1>
      <h2>Investment Assets</h2>

      {loading && <p>Loading assets from database...</p>}

      {error && (
        <div style={{ color: 'red', marginBottom: '1rem' }}>
          <p><strong>Error loading assets:</strong> {error}</p>
        </div>
      )}

      {!loading && !error && (
        <div>
          <p>Total assets: {assets.length}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Symbol</th>
                <th style={{ padding: '8px' }}>Name</th>
                <th style={{ padding: '8px' }}>Type</th>
                <th style={{ padding: '8px' }}>Exchange</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id || asset.symbol} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px', fontWeight: 'bold' }}>{asset.symbol}</td>
                  <td style={{ padding: '8px' }}>{asset.name}</td>
                  <td style={{ padding: '8px' }}>{asset.asset_type}</td>
                  <td style={{ padding: '8px' }}>{asset.exchange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;
