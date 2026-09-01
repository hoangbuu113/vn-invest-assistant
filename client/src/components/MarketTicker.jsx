import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api.js';

const TRACKED_SYMBOLS = ['FPT', 'VCB', 'HPG', 'VNM', 'E1VFVN30'];

export function MarketTicker() {
  const [tickerData, setTickerData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Fetch market data for each symbol from existing API
    Promise.all(
      TRACKED_SYMBOLS.map((sym) =>
        apiFetch(`/api/market/${encodeURIComponent(sym)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => (json && json.status === 'ok' && json.data ? json.data : null))
          .catch(() => null)
      )
    ).then((results) => {
      if (!isMounted) return;
      const valid = results.filter(Boolean);
      setTickerData(valid);
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading || tickerData.length === 0) {
    return (
      <div className="market-ticker-shell">
        <div className="market-ticker-inner">
          <div className="ticker-label-badge">
            <span className="ticker-live-dot" />
            <span>THỊ TRƯỜNG</span>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>
            Đang tải dữ liệu thị trường tham khảo...
          </span>
        </div>
      </div>
    );
  }

  // Duplicate items for infinite seamless looping marquee
  const displayItems = [...tickerData, ...tickerData, ...tickerData];

  return (
    <div className="market-ticker-shell" aria-label="Bảng giá thị trường thu gọn">
      <div className="market-ticker-inner">
        {/* Ticker Lead Tag */}
        <div className="ticker-label-badge">
          <span className="ticker-live-dot" />
          <span>THỊ TRƯỜNG VN</span>
          <span className="ticker-delay-tag">Theo nhà cung cấp</span>
        </div>

        {/* Scrolling Tape Container */}
        <div className="ticker-marquee-viewport">
          <div className="ticker-marquee-track">
            {displayItems.map((item, idx) => {
              const isGain = (item.change || 0) > 0;
              const isLoss = (item.change || 0) < 0;

              return (
                <div key={`${item.symbol}-${idx}`} className="ticker-item">
                  <span className="ticker-symbol">{item.symbol}</span>
                  <span className="ticker-price">
                    {item.price !== null ? `${item.price.toLocaleString('vi-VN')}${item.currency ? ` ${item.currency}` : ''}` : 'N/A'}
                  </span>
                  <span className={`ticker-change ${isGain ? 'change-gain' : isLoss ? 'change-loss' : 'change-neutral'}`}>
                    {isGain ? '▲ +' : isLoss ? '▼ ' : '➖ '}
                    {item.changePercent !== null && item.changePercent !== undefined
                      ? `${Number(item.changePercent).toFixed(2)}%`
                      : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
