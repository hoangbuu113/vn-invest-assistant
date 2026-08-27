import React, { useState, useEffect } from 'react';

function App() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((jsonData) => {
        setData(jsonData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to connect to backend');
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>VN Invest Assistant</h1>
      <h2>System Status</h2>

      {loading && <p>Loading backend status...</p>}

      {error && (
        <div style={{ color: 'red' }}>
          <p><strong>Error:</strong> Cannot reach backend service.</p>
          <p>{error}</p>
        </div>
      )}

      {data && (
        <div style={{ color: 'green' }}>
          <p><strong>Status:</strong> {data.status}</p>
          <p><strong>Message:</strong> {data.message}</p>
        </div>
      )}
    </div>
  );
}

export default App;

