import React from 'react';
import { VietnamRegimePanel } from './VietnamRegimePanel.jsx';
import { InvestmentBriefPanel } from './InvestmentBriefPanel.jsx';
import { MarketNewsPreview } from './MarketNewsPreview.jsx';

export function MarketIntelligenceSection({
  news = [],
  newsLoading = false,
  newsError = null,
  onNavigateNews
}) {
  return (
    <div className="market-intelligence-container">
      <VietnamRegimePanel
        briefSlot={<InvestmentBriefPanel />}
        newsSlot={
          <MarketNewsPreview
            news={news}
            loading={newsLoading}
            error={newsError}
            onViewAll={onNavigateNews}
          />
        }
      />
    </div>
  );
}
