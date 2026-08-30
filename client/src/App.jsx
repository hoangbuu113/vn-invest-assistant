import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Fintech3DOrb } from './components/Fintech3DOrb.jsx';
import { MarketTicker } from './components/MarketTicker.jsx';
import { MoneyFlowAmbience } from './components/MoneyFlowAmbience.jsx';
import { WealthOrbit } from './components/WealthOrbit.jsx';
import { EconomicPulseRail } from './components/EconomicPulseRail.jsx';
import {
  TiltCard,
  MagneticButton,
  CountUp,
  MultiLayerBackground,
  GlobalCursorSpotlight,
  PointerHalo,
  AnimatedNavTabs
} from './components/MotionHelpers.jsx';

import { PriceHistoryChart } from './components/PriceHistoryChart.jsx';
import { AssetAnalysisSection } from './components/AssetAnalysisSection.jsx';
import { PortfolioCompositionSection } from './components/PortfolioCompositionSection.jsx';
import { AssetComparisonSection } from './components/AssetComparisonSection.jsx';
import PriceAlertModal from './components/PriceAlertModal.jsx';
import AlertCenterSection from './components/AlertCenterSection.jsx';
import TransactionModal from './components/TransactionModal.jsx';
import TransactionHistorySection from './components/TransactionHistorySection.jsx';
import CashMovementModal from './components/CashMovementModal.jsx';
import CashManagementSection from './components/CashManagementSection.jsx';
import OpeningPositionModal from './components/OpeningPositionModal.jsx';
import { PortfolioPerformanceSection } from './components/PortfolioPerformanceSection.jsx';
import {
  formatNativeAmount,
  formatMarketChange,
  formatVNDReporting,
  formatPercentVN,
  formatAssetType,
  formatMarketContext,
  getMarketDisplayDecimals
} from './utils/formatting.js';

const CATEGORY_STYLES = {
  market: { label: 'Thị trường', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', accent: '#2563eb' },
  company: { label: 'Doanh nghiệp', bg: '#faf5ff', color: '#7c3aed', border: '#e9d5ff', accent: '#7c3aed' },
  macro: { label: 'Vĩ mô', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', accent: '#059669' },
  global: { label: 'Quốc tế', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa', accent: '#ea580c' },
  international: { label: 'Quốc tế', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa', accent: '#ea580c' },
  crypto: { label: 'Crypto', bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe', accent: '#7c3aed' },
  gold: { label: 'Vàng', bg: '#fefce8', color: '#a16207', border: '#fef08a', accent: '#ca8a04' },
  fx: { label: 'Ngoại hối', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', accent: '#16a34a' },
  general: { label: 'Tin chung', bg: '#f8fafc', color: '#475569', border: '#e2e8f0', accent: '#64748b' }
};

const HISTORY_RANGES = [
  { id: '1W', label: '1T' },
  { id: '1M', label: '1Th' },
  { id: '3M', label: '3Th' },
  { id: '6M', label: '6Th' },
  { id: '1Y', label: '1N' }
];

const HISTORY_UNAVAILABLE_MESSAGE = 'Dữ liệu lịch sử tạm thời chưa khả dụng. Vui lòng thử lại sau.';
const ANALYSIS_UNAVAILABLE_MESSAGE = 'Phân tích tạm thời chưa khả dụng vì dữ liệu lịch sử chưa tải được.';

const NAV_TABS = [
  { id: 'dashboard', label: 'Tổng quan', icon: '⚡' },
  { id: 'portfolio', label: 'Danh mục', icon: '📊' },
  { id: 'watchlist', label: 'Theo dõi', icon: '⭐' },
  { id: 'news', label: 'Tin tức', icon: '📰' },
  { id: 'assets', label: 'Tài sản', icon: '📈' },
  { id: 'profile', label: 'Hồ sơ đầu tư', icon: '👤' }
];

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

const ASSET_CLASS_FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'stock', label: 'Cổ phiếu' },
  { id: 'etf', label: 'ETF' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'gold', label: 'Vàng' },
  { id: 'fx', label: 'Ngoại hối' }
];

const ASSET_SECTIONS = [
  { type: 'stock', title: 'Cổ phiếu Việt Nam', icon: '🏛️' },
  { type: 'etf', title: 'ETF', icon: '📦' },
  { type: 'crypto', title: 'Crypto', icon: '💎' },
  { type: 'gold', title: 'Vàng', icon: '🥇' },
  { type: 'fx', title: 'Ngoại hối', icon: '💱' }
];

const NEWS_CATEGORY_LABELS = {
  macro: 'Vĩ mô',
  market: 'Thị trường',
  company: 'Doanh nghiệp',
  global: 'Quốc tế',
  international: 'Quốc tế',
  crypto: 'Crypto',
  gold: 'Vàng',
  fx: 'Ngoại hối',
  general: 'Tin chung'
};

function formatNewsCategory(category) {
  if (!category) return null;
  return NEWS_CATEGORY_LABELS[String(category).toLowerCase()] || null;
}

/**
 * Feature 09: Compute top gainer and decliner within watchlist based purely on descriptive percentage changes
 */
function computeWatchlistMovers(watchlistItems, marketDataMap = {}) {
  if (!Array.isArray(watchlistItems) || watchlistItems.length === 0) {
    return { topGainer: null, topDecliner: null, validCount: 0 };
  }

  const validItems = [];

  for (const item of watchlistItems) {
    const sym = item.asset?.symbol || item.symbol;
    if (!sym || typeof sym !== 'string') continue;

    const mkt = marketDataMap[sym] || item.marketData;
    if (!mkt || typeof mkt !== 'object') continue;

    const price = typeof mkt.price === 'number' && !isNaN(mkt.price) && Number.isFinite(mkt.price) && mkt.price > 0
      ? mkt.price
      : null;

    const change = typeof mkt.change === 'number' && !isNaN(mkt.change) && Number.isFinite(mkt.change)
      ? mkt.change
      : null;

    const changePercent = typeof mkt.changePercent === 'number' && !isNaN(mkt.changePercent) && Number.isFinite(mkt.changePercent)
      ? mkt.changePercent
      : null;

    if (price !== null && changePercent !== null) {
      validItems.push({
        id: item.id || item.asset_id || sym,
        symbol: sym,
        name: item.asset?.name || item.name || sym,
        assetType: item.asset?.asset_type || item.assetType,
        price,
        change,
        changePercent,
        currency: item.asset?.quote_currency || item.asset?.quoteCurrency || mkt.currency || 'VND',
        changeBasis: mkt.changeBasis || (item.asset?.market_policy === 'CONTINUOUS_24_7' ? 'ROLLING_24H' : 'PREVIOUS_SESSION_CLOSE'),
        updatedAt: mkt.updatedAt || null
      });
    }
  }

  if (validItems.length < 2) {
    return {
      topGainer: null,
      topDecliner: null,
      validCount: validItems.length
    };
  }

  const sorted = [...validItems].sort((a, b) => b.changePercent - a.changePercent);
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];

  const topGainer = highest && highest.changePercent > 0 ? highest : null;
  const topDecliner = lowest && lowest.changePercent < 0 ? lowest : null;

  return {
    topGainer,
    topDecliner,
    validCount: validItems.length
  };
}

const pageVariants = {
  initial: { opacity: 0, scale: 0.985, y: 10, filter: 'blur(4px)' },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.28,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.06
    }
  },
  exit: {
    opacity: 0,
    scale: 0.99,
    y: -6,
    filter: 'blur(2px)',
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] }
  }
};

const sectionItemVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'portfolio' | 'watchlist' | 'news' | 'assets' | 'profile'

  // Profile state
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Form states
  const [riskTolerance, setRiskTolerance] = useState('moderate');
  const [investmentHorizon, setInvestmentHorizon] = useState('medium');

  // Holdings state
  const [holdings, setHoldings] = useState([]);
  const [holdingsLoading, setHoldingsLoading] = useState(true);
  const [holdingsError, setHoldingsError] = useState(null);
  const [holdingsSuccess, setHoldingsSuccess] = useState(null);

  // Feature 17: Opening Position Modal state
  const [isOpeningPositionModalOpen, setIsOpeningPositionModalOpen] = useState(false);
  const [openingPositionModalMode, setOpeningPositionModalMode] = useState('CREATE'); // 'CREATE' | 'CORRECT' | 'CANCEL'
  const [openingPositionTargetHolding, setOpeningPositionTargetHolding] = useState(null);

  // Assets state
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assetTypeFilter, setAssetTypeFilter] = useState('all'); // 'all' | 'stock' | 'etf' | 'crypto' | 'gold' | 'fx'
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  const [cryptoExpanded, setCryptoExpanded] = useState(false);

  // Selected asset detail state
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [assetDetail, setAssetDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // Market snapshot state
  const [marketData, setMarketData] = useState(null);
  const [realtimeData, setRealtimeData] = useState(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketError, setMarketError] = useState(null);

  // Historical market data state (Feature 06)
  const [historyRange, setHistoryRange] = useState('1M'); // '1W' | '1M' | '3M' | '6M' | '1Y'
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // Deterministic Asset Analysis state (Feature 07)
  const [analysisData, setAnalysisData] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  // Asset Comparison state (Feature 11)
  const [isComparingAssets, setIsComparingAssets] = useState(false);
  const [comparePresetSymbols, setComparePresetSymbols] = useState(['FPT', 'VCB']);

  // Price Alerts state (Feature 12)
  const [isViewingAlerts, setIsViewingAlerts] = useState(false);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertTargetAsset, setAlertTargetAsset] = useState(null);

  // Transaction Ledger state (Feature 14)
  const [transactions, setTransactions] = useState([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transactionsRefreshing, setTransactionsRefreshing] = useState(false);
  const [transactionsError, setTransactionsError] = useState(null);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [transactionModalDefaultType, setTransactionModalDefaultType] = useState('BUY');
  const [transactionModalDefaultAsset, setTransactionModalDefaultAsset] = useState(null);

  // Cash / Capital Ledger state (Feature 15)
  const [cashOverview, setCashOverview] = useState(null);
  const [cashOverviewLoading, setCashOverviewLoading] = useState(true);
  const [cashOverviewRefreshing, setCashOverviewRefreshing] = useState(false);
  const [cashOverviewError, setCashOverviewError] = useState(null);
  const [cashLedger, setCashLedger] = useState([]);
  const [cashLedgerLoading, setCashLedgerLoading] = useState(true);
  const [cashLedgerRefreshing, setCashLedgerRefreshing] = useState(false);
  const [cashLedgerError, setCashLedgerError] = useState(null);
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [cashModalMode, setCashModalMode] = useState('DEPOSIT'); // 'DEPOSIT' | 'WITHDRAWAL'

  // Request controller refs for stale response protection
  const activeMarketReqRef = useRef(null);
  const activeRealtimeReqRef = useRef(null);
  const activeHistoryReqRef = useRef(null);
  const activeAssetDetailReqRef = useRef(null);
  const activeAnalysisReqRef = useRef(null);

  // News feed & Personalized News state (Feature 13)
  const [newsSubTab, setNewsSubTab] = useState('general'); // 'general' | 'personalized'
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [newsError, setNewsError] = useState(null);

  const [personalizedNews, setPersonalizedNews] = useState([]);
  const [personalizedLoading, setPersonalizedLoading] = useState(true);
  const [personalizedRefreshing, setPersonalizedRefreshing] = useState(false);
  const [personalizedError, setPersonalizedError] = useState(null);
  const [personalizedUserAssetCount, setPersonalizedUserAssetCount] = useState(0);

  // Portfolio overview state
  const [portfolioOverview, setPortfolioOverview] = useState(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioRefreshing, setPortfolioRefreshing] = useState(false);
  const [portfolioError, setPortfolioError] = useState(null);

  // Portfolio composition state (Feature 10)
  const [compositionData, setCompositionData] = useState(null);
  const [compositionLoading, setCompositionLoading] = useState(true);
  const [compositionRefreshing, setCompositionRefreshing] = useState(false);
  const [compositionError, setCompositionError] = useState(null);
  const activeCompositionReqRef = useRef(null);

  // Watchlist state (Feature 08)
  const [watchlist, setWatchlist] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [watchlistRefreshing, setWatchlistRefreshing] = useState(false);
  const [watchlistError, setWatchlistError] = useState(null);
  const [watchlistActionLoading, setWatchlistActionLoading] = useState(null);
  const [watchlistMarketData, setWatchlistMarketData] = useState({});
  const [watchlistMarketLoading, setWatchlistMarketLoading] = useState(false);

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

  // Handle saving profile changes (preferences only; cash is ledger-authoritative)
  const handleSaveProfile = (e) => {
    if (e && e.preventDefault) e.preventDefault();

    setProfileSaving(true);
    setProfileError(null);
    setProfileSuccess(false);

    fetch('/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
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
          setRiskTolerance(json.data.risk_tolerance);
          setInvestmentHorizon(json.data.investment_horizon);
          setProfileSuccess(true);
          fetchPortfolio(false);
          fetchComposition(false);
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

  // Fetch holdings
  const fetchHoldings = useCallback((isInitial = false) => {
    if (isInitial) setHoldingsLoading(true);
    setHoldingsError(null);

    fetch('/api/holdings')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setHoldings(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải danh mục đầu tư');
        }
      })
      .catch((err) => {
        setHoldingsError(err.message || 'Không thể tải danh mục đầu tư');
      })
      .finally(() => {
        setHoldingsLoading(false);
      });
  }, []);

  // Fetch holdings on mount
  useEffect(() => {
    fetchHoldings(true);
  }, [fetchHoldings]);

  // Feature 17: Handle opening position modal actions
  const handleOpenOpeningPositionModal = (mode = 'CREATE', targetHolding = null) => {
    setOpeningPositionModalMode(mode);
    setOpeningPositionTargetHolding(targetHolding);
    setIsOpeningPositionModalOpen(true);
  };

  const handleOpeningPositionSuccess = ({ message }) => {
    setHoldingsSuccess(message || 'Thao tác vị thế ban đầu thành công.');
    fetchHoldings(false);
    fetchPortfolio(false);
    fetchComposition(false);
    fetchPersonalizedNews(false);
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

  // Fetch personalized news data (Feature 13)
  const fetchPersonalizedNews = useCallback((isInitial = false) => {
    if (isInitial) {
      setPersonalizedLoading(true);
    } else {
      setPersonalizedRefreshing(true);
    }
    setPersonalizedError(null);

    fetch('/api/news/personalized')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setPersonalizedNews(json.data);
          setPersonalizedUserAssetCount(typeof json.userAssetCount === 'number' ? json.userAssetCount : 0);
        } else {
          throw new Error(json.message || 'Không thể tải tin tức cá nhân hóa');
        }
      })
      .catch((err) => {
        setPersonalizedError(err.message || 'Không thể tải tin tức cá nhân hóa');
      })
      .finally(() => {
        setPersonalizedLoading(false);
        setPersonalizedRefreshing(false);
      });
  }, []);

  // Fetch news on initial mount
  useEffect(() => {
    fetchNews(true);
    fetchPersonalizedNews(true);
  }, [fetchNews, fetchPersonalizedNews]);

  // Fetch portfolio overview data
  const fetchPortfolio = useCallback((isInitial = false) => {
    if (isInitial) {
      setPortfolioLoading(true);
    } else {
      setPortfolioRefreshing(true);
    }
    setPortfolioError(null);

    fetch('/api/portfolio/overview')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setPortfolioOverview(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải tổng quan danh mục');
        }
      })
      .catch((err) => {
        setPortfolioError(err.message || 'Không thể tải dữ liệu tổng quan danh mục');
      })
      .finally(() => {
        setPortfolioLoading(false);
        setPortfolioRefreshing(false);
      });
  }, []);

  // Fetch portfolio composition data (Feature 10)
  const fetchComposition = useCallback((isInitial = false) => {
    if (activeCompositionReqRef.current) {
      activeCompositionReqRef.current.abort();
    }
    const controller = new AbortController();
    activeCompositionReqRef.current = controller;

    if (isInitial) {
      setCompositionLoading(true);
    } else {
      setCompositionRefreshing(true);
    }
    setCompositionError(null);

    fetch('/api/portfolio/composition', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setCompositionData(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải cơ cấu danh mục');
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setCompositionError(err.message || 'Không thể tải dữ liệu cơ cấu danh mục');
      })
      .finally(() => {
        if (activeCompositionReqRef.current === controller) {
          activeCompositionReqRef.current = null;
          setCompositionLoading(false);
          setCompositionRefreshing(false);
        }
      });
  }, []);

  // Fetch portfolio transactions (Feature 14)
  const fetchTransactions = useCallback((isInitial = false) => {
    if (isInitial) {
      setTransactionsLoading(true);
    } else {
      setTransactionsRefreshing(true);
    }
    setTransactionsError(null);

    fetch('/api/transactions')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setTransactions(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải lịch sử giao dịch');
        }
      })
      .catch((err) => {
        setTransactionsError(err.message || 'Không thể tải dữ liệu lịch sử giao dịch');
      })
      .finally(() => {
        setTransactionsLoading(false);
        setTransactionsRefreshing(false);
      });
  }, []);

  // Fetch cash overview (Feature 15)
  const fetchCashOverview = useCallback((isInitial = false) => {
    if (isInitial) {
      setCashOverviewLoading(true);
    } else {
      setCashOverviewRefreshing(true);
    }
    setCashOverviewError(null);

    fetch('/api/cash/overview')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setCashOverview(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải tổng quan tiền mặt');
        }
      })
      .catch((err) => {
        setCashOverviewError(err.message || 'Không thể tải dữ liệu tổng quan tiền mặt');
      })
      .finally(() => {
        setCashOverviewLoading(false);
        setCashOverviewRefreshing(false);
      });
  }, []);

  // Fetch cash ledger (Feature 15)
  const fetchCashLedger = useCallback((isInitial = false) => {
    if (isInitial) {
      setCashLedgerLoading(true);
    } else {
      setCashLedgerRefreshing(true);
    }
    setCashLedgerError(null);

    fetch('/api/cash/ledger')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setCashLedger(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải sổ lệnh tiền mặt');
        }
      })
      .catch((err) => {
        setCashLedgerError(err.message || 'Không thể tải dữ liệu sổ lệnh tiền mặt');
      })
      .finally(() => {
        setCashLedgerLoading(false);
        setCashLedgerRefreshing(false);
      });
  }, []);

  const handleCashMovementSuccess = useCallback(() => {
    fetchCashOverview(false);
    fetchCashLedger(false);
    fetchPortfolio(false);
    fetchComposition(false);
    fetchProfile(false);
  }, [fetchCashOverview, fetchCashLedger, fetchPortfolio, fetchComposition, fetchProfile]);

  const handleTransactionRecorded = useCallback(() => {
    fetchHoldings(false);
    fetchPortfolio(false);
    fetchComposition(false);
    fetchTransactions(false);
    fetchCashOverview(false);
    fetchCashLedger(false);
    fetchPersonalizedNews(false);
  }, [fetchHoldings, fetchPortfolio, fetchComposition, fetchTransactions, fetchCashOverview, fetchCashLedger, fetchPersonalizedNews]);

  // Fetch portfolio, composition, transactions & cash on initial mount
  useEffect(() => {
    fetchPortfolio(true);
    fetchComposition(true);
    fetchTransactions(true);
    fetchCashOverview(true);
    fetchCashLedger(true);
  }, [fetchPortfolio, fetchComposition, fetchTransactions, fetchCashOverview, fetchCashLedger]);

  // Periodic 5-minute auto-refresh when on portfolio tab
  useEffect(() => {
    if (activeTab !== 'portfolio') return;
    fetchPortfolio(false);
    fetchComposition(false);
    fetchTransactions(false);
    fetchCashOverview(false);
    fetchCashLedger(false);
    const intervalId = setInterval(() => {
      fetchPortfolio(false);
      fetchComposition(false);
      fetchTransactions(false);
      fetchCashOverview(false);
      fetchCashLedger(false);
    }, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [activeTab, fetchPortfolio, fetchComposition, fetchTransactions, fetchCashOverview, fetchCashLedger]);

  // Fetch delayed market data for watchlist items (Feature 08)
  const fetchWatchlistMarketData = useCallback((items) => {
    if (!items || items.length === 0) {
      setWatchlistMarketLoading(false);
      return;
    }

    const symbols = [...new Set(items.map((i) => i.asset?.symbol).filter(Boolean))];
    if (symbols.length === 0) {
      setWatchlistMarketLoading(false);
      return;
    }

    setWatchlistMarketLoading(true);

    Promise.allSettled(
      symbols.map((sym) =>
        fetch(`/api/market/${encodeURIComponent(sym)}`)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((json) => {
            if (json.status === 'ok' && json.data) {
              return { symbol: sym, data: json.data };
            }
            return { symbol: sym, data: null };
          })
          .catch(() => ({ symbol: sym, data: null }))
      )
    ).then((results) => {
      const newMarketData = {};
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value) {
          newMarketData[r.value.symbol] = r.value.data;
        }
      });
      setWatchlistMarketData((prev) => ({ ...prev, ...newMarketData }));
      setWatchlistMarketLoading(false);
    });
  }, []);

  // Fetch watchlist items
  const fetchWatchlist = useCallback((isInitial = false) => {
    if (isInitial) {
      setWatchlistLoading(true);
    } else {
      setWatchlistRefreshing(true);
    }
    setWatchlistError(null);

    fetch('/api/watchlist')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && Array.isArray(json.data)) {
          setWatchlist(json.data);
          fetchWatchlistMarketData(json.data);
        } else {
          throw new Error(json.message || 'Không thể tải danh sách theo dõi');
        }
      })
      .catch((err) => {
        setWatchlistError(err.message || 'Không thể tải danh sách theo dõi');
      })
      .finally(() => {
        setWatchlistLoading(false);
        setWatchlistRefreshing(false);
      });
  }, [fetchWatchlistMarketData]);

  // Fetch watchlist on initial mount
  useEffect(() => {
    fetchWatchlist(true);
  }, [fetchWatchlist]);

  // Periodic 5-minute auto-refresh when on watchlist tab
  useEffect(() => {
    if (activeTab !== 'watchlist') return;
    const intervalId = setInterval(() => {
      fetchWatchlist(false);
    }, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [activeTab, fetchWatchlist]);

  // Dashboard refresh state (Feature 09)
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);

  // Global refresh for all dashboard sections
  const handleRefreshAllDashboard = useCallback(() => {
    setDashboardRefreshing(true);
    Promise.allSettled([
      fetchPortfolio(false),
      fetchComposition(false),
      fetchWatchlist(false),
      fetchNews(false)
    ]).finally(() => {
      setDashboardRefreshing(false);
    });
  }, [fetchPortfolio, fetchComposition, fetchWatchlist, fetchNews]);

  // Periodic 5-minute auto-refresh when on dashboard tab
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    const intervalId = setInterval(() => {
      handleRefreshAllDashboard();
    }, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [activeTab, handleRefreshAllDashboard]);

  // Toggle or add/remove asset from watchlist
  const handleToggleWatchlist = (assetId, symbol) => {
    const isFollowed = watchlist.some(
      (w) => (symbol && w.asset?.symbol === symbol) || (assetId && w.asset_id === assetId)
    );

    const targetIdentifier = symbol || assetId;
    if (!targetIdentifier) return;

    setWatchlistActionLoading(targetIdentifier);

    if (isFollowed) {
      fetch(`/api/watchlist/${encodeURIComponent(targetIdentifier)}`, {
        method: 'DELETE'
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json) => {
          if (json.status === 'ok') {
            setWatchlist((prev) =>
              prev.filter(
                (w) =>
                  !((symbol && w.asset?.symbol === symbol) || (assetId && w.asset_id === assetId))
              )
            );
            fetchPersonalizedNews(false);
          }
        })
        .catch((err) => {
          console.error('Error removing from watchlist:', err);
        })
        .finally(() => {
          setWatchlistActionLoading(null);
        });
    } else {
      fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: assetId || undefined,
          symbol: symbol || undefined
        })
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json) => {
          if (json.status === 'ok' && json.data) {
            setWatchlist((prev) => {
              if (prev.some((w) => w.id === json.data.id)) return prev;
              return [...prev, json.data];
            });
            if (symbol && !watchlistMarketData[symbol]) {
              fetchWatchlistMarketData([json.data]);
            }
            fetchPersonalizedNews(false);
          }
        })
        .catch((err) => {
          console.error('Error adding to watchlist:', err);
        })
        .finally(() => {
          setWatchlistActionLoading(null);
        });
    }
  };

  const fetchMarketData = useCallback((symbol, isInitial = false) => {
    if (!symbol) return;

    if (isInitial) {
      setMarketLoading(true);
      setMarketData(null);
    } else {
      setIsRefreshing(true);
    }
    setMarketError(null);

    if (activeMarketReqRef.current) {
      activeMarketReqRef.current.abort();
    }
    const controller = new AbortController();
    activeMarketReqRef.current = controller;

    fetch(`/api/market/${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = new Error(json.message || `HTTP ${res.status}`);
          error.code = json.code || null;
          throw error;
        }
        return json;
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.status === 'ok' && json.data) {
          if (json.data.symbol === symbol) {
            setMarketData(json.data);
          }
        } else {
          throw new Error(json.message || 'Không thể tải dữ liệu giá thị trường');
        }
        setMarketLoading(false);
        setIsRefreshing(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        if (!isInitial) {
          setMarketData((current) => current && current.symbol === symbol
            ? {
                ...current,
                freshness: 'stale',
                staleReason: err.code || 'REFRESH_FAILED'
              }
            : current);
        }
        setMarketError(err.message || 'Dữ liệu giá thị trường không khả dụng');
        setMarketLoading(false);
        setIsRefreshing(false);
      });
  }, []);

  const fetchRealtimeData = useCallback((symbol) => {
    if (!symbol) return;
    if (activeRealtimeReqRef.current) {
      activeRealtimeReqRef.current.abort();
    }
    const controller = new AbortController();
    activeRealtimeReqRef.current = controller;

    fetch(`/api/market/${encodeURIComponent(symbol)}/realtime`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.status === 'ok' && json.data) {
          if (json.data.symbol === symbol) {
            setRealtimeData(json.data);
          }
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        setRealtimeData(null);
      });
  }, []);

  // Automatic 5-minute refresh timer for canonical market snapshot (all assets)
  useEffect(() => {
    if (!selectedSymbol) return;

    const intervalId = setInterval(() => {
      fetchMarketData(selectedSymbol, false);
    }, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [selectedSymbol, fetchMarketData]);

  // Feature 24A: Dedicated ~2-second polling for Binance realtime crypto market reference (Asset Detail view only)
  useEffect(() => {
    if (!selectedSymbol) {
      setRealtimeData(null);
      return;
    }

    const isCrypto = assetDetail?.market_policy === 'CONTINUOUS_24_7';
    if (!isCrypto) {
      setRealtimeData(null);
      return;
    }

    // Initial immediate fetch
    fetchRealtimeData(selectedSymbol);

    const intervalId = setInterval(() => {
      fetchRealtimeData(selectedSymbol);
    }, 2000);

    return () => {
      clearInterval(intervalId);
      if (activeRealtimeReqRef.current) {
        activeRealtimeReqRef.current.abort();
      }
      setRealtimeData(null);
    };
  }, [selectedSymbol, assetDetail?.market_policy, fetchRealtimeData]);

  // Fetch historical market data (Feature 06)
  const fetchHistoryData = useCallback((symbol, range = '1M') => {
    if (!symbol) return;
    if (symbol === 'USD/VND') {
      setHistoryLoading(false);
      setHistoryError(null);
      setHistoryData({
        unsupported: true,
        symbol: 'USD/VND',
        quoteCurrency: 'VND',
        message: 'Lịch sử giá hiện chưa được hỗ trợ cho USD/VND.'
      });
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryData(null); // Prevent stale range data from showing while loading

    if (activeHistoryReqRef.current) {
      activeHistoryReqRef.current.abort();
    }
    const controller = new AbortController();
    activeHistoryReqRef.current = controller;

    fetch(`/api/market/${encodeURIComponent(symbol)}/history?range=${encodeURIComponent(range)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(HISTORY_UNAVAILABLE_MESSAGE);
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.status === 'ok' && json.data) {
          if (json.data.symbol === symbol && json.data.range === range) {
            setHistoryData(json.data);
          }
        } else {
          throw new Error(HISTORY_UNAVAILABLE_MESSAGE);
        }
        setHistoryLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        setHistoryError(HISTORY_UNAVAILABLE_MESSAGE);
        setHistoryLoading(false);
      });
  }, []);

  // Fetch deterministic asset analysis (Feature 07)
  const fetchAnalysisData = useCallback((symbol, isInitial = false) => {
    if (!symbol) return;
    if (symbol === 'USD/VND') {
      setAnalysisLoading(false);
      setAnalysisError(null);
      setAnalysisData({
        unsupported: true,
        symbol: 'USD/VND',
        quoteCurrency: 'VND',
        message: 'Phân tích lịch sử hiện chưa được hỗ trợ cho USD/VND.'
      });
      return;
    }

    if (isInitial) {
      setAnalysisLoading(true);
      setAnalysisData(null);
    }
    setAnalysisError(null);

    if (activeAnalysisReqRef.current) {
      activeAnalysisReqRef.current.abort();
    }
    const controller = new AbortController();
    activeAnalysisReqRef.current = controller;

    fetch(`/api/analysis/${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(ANALYSIS_UNAVAILABLE_MESSAGE);
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.status === 'ok' && json.data) {
          if (json.data.symbol === symbol) {
            setAnalysisData(json.data);
          }
        } else {
          throw new Error(ANALYSIS_UNAVAILABLE_MESSAGE);
        }
        setAnalysisLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        setAnalysisError(ANALYSIS_UNAVAILABLE_MESSAGE);
        setAnalysisLoading(false);
      });
  }, []);

  // Handle range change for history chart
  const handleRangeChange = (newRange) => {
    setHistoryRange(newRange);
    if (selectedSymbol) {
      fetchHistoryData(selectedSymbol, newRange);
    }
  };

  const handleSelectAsset = (symbol) => {
    setActiveTab('assets');
    setIsComparingAssets(false);
    if (activeAssetDetailReqRef.current) activeAssetDetailReqRef.current.abort();
    if (activeMarketReqRef.current) activeMarketReqRef.current.abort();
    if (activeRealtimeReqRef.current) activeRealtimeReqRef.current.abort();
    if (activeHistoryReqRef.current) activeHistoryReqRef.current.abort();
    if (activeAnalysisReqRef.current) activeAnalysisReqRef.current.abort();

    const controller = new AbortController();
    activeAssetDetailReqRef.current = controller;

    setSelectedSymbol(symbol);
    setDetailLoading(true);
    setDetailError(null);
    setAssetDetail(null);
    setRealtimeData(null);
    setHistoryRange('1M');
    setAnalysisData(null);
    setAnalysisError(null);

    fetch(`/api/assets/${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.status === 'ok' && json.data) {
          if (json.data.symbol === symbol) {
            setAssetDetail(json.data);
          }
        } else {
          throw new Error(json.message || `Không thể tải thông tin chi tiết cho ${symbol}`);
        }
        setDetailLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        setDetailError(err.message || `Không thể tải thông tin chi tiết cho ${symbol}`);
        setDetailLoading(false);
      });

    fetchMarketData(symbol, true);
    fetchHistoryData(symbol, '1M');
    fetchAnalysisData(symbol, true);
  };

  const handleBackToList = () => {
    setIsComparingAssets(false);
    if (activeAssetDetailReqRef.current) activeAssetDetailReqRef.current.abort();
    if (activeMarketReqRef.current) activeMarketReqRef.current.abort();
    if (activeRealtimeReqRef.current) activeRealtimeReqRef.current.abort();
    if (activeHistoryReqRef.current) activeHistoryReqRef.current.abort();
    if (activeAnalysisReqRef.current) activeAnalysisReqRef.current.abort();

    setSelectedSymbol(null);
    setAssetDetail(null);
    setDetailError(null);
    setMarketData(null);
    setRealtimeData(null);
    setMarketError(null);
    setIsRefreshing(false);
    setHistoryData(null);
    setHistoryError(null);
    setHistoryLoading(false);
    setHistoryRange('1M');
    setAnalysisData(null);
    setAnalysisError(null);
    setAnalysisLoading(false);
  };

  // Abort all active requests on component unmount
  useEffect(() => {
    return () => {
      if (activeAssetDetailReqRef.current) activeAssetDetailReqRef.current.abort();
      if (activeMarketReqRef.current) activeMarketReqRef.current.abort();
      if (activeRealtimeReqRef.current) activeRealtimeReqRef.current.abort();
      if (activeHistoryReqRef.current) activeHistoryReqRef.current.abort();
      if (activeAnalysisReqRef.current) activeAnalysisReqRef.current.abort();
    };
  }, []);

  return (
    <div className="app-container">
      {/* Multi-Layer Parallax Ambient Background */}
      <MultiLayerBackground />

      {/* Additive Gen Z Money Flow Ambience & Floating Glyphs */}
      <MoneyFlowAmbience />

      {/* Global Desktop Cursor Spotlight */}
      <GlobalCursorSpotlight />

      {/* Desktop Pointer Halo */}
      <PointerHalo />

      {/* Top Application Shell Header */}
      <header className="app-header">
        <div className="app-header-inner">
          {/* Brand Identity */}
          <div className="brand-mark">
            <div className="brand-icon-box">
              <span>📈</span>
            </div>
            <div>
              <h1 className="brand-title">VN Invest Assistant</h1>
              <p className="brand-tagline">Trợ lý Phân tích Đầu tư Cá nhân</p>
            </div>
          </div>

          {/* Animated Spring-Sliding Navigation Control */}
          <AnimatedNavTabs
            tabs={NAV_TABS}
            activeTab={activeTab}
            onChange={(tabId) => {
              setIsViewingAlerts(false);
              setIsComparingAssets(false);
              setActiveTab(tabId);
            }}
          />
        </div>
      </header>

      {/* Additive Market Pulse Ticker Bar */}
      <MarketTicker />

      {/* Main Content Area with Sequential Coordinated Transitions */}
      <main className="app-main">
        <AnimatePresence mode="wait">

          {/* TAB 0: DASHBOARD / TỔNG QUAN (Feature 09 - De-duplicated cross-app overview) */}
          {activeTab === 'dashboard' && (
            <motion.section
              key="dashboard-view"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {/* SECTION 1: DASHBOARD HERO / PERSONAL SUMMARY */}
              <motion.div variants={sectionItemVariants} className="section-header" style={{ alignItems: 'center', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                  <Fintech3DOrb size={68} className="dashboard-3d-accent" />
                  <div>
                    <h2 className="section-title">Tổng quan đầu tư</h2>
                    <p className="section-subtitle">
                      Các thông tin quan trọng từ danh mục và tài sản bạn đang theo dõi.
                    </p>
                  </div>
                </div>

                {/* Refresh Button */}
                <MagneticButton
                  onClick={handleRefreshAllDashboard}
                  disabled={dashboardRefreshing || portfolioLoading || watchlistLoading || newsLoading}
                  className="fintech-btn btn-secondary btn-sm"
                >
                  <span className={dashboardRefreshing ? 'spin-icon' : ''}>{dashboardRefreshing ? '⟳' : '↻'}</span>
                  <span>{dashboardRefreshing ? 'Đang làm mới...' : 'Làm mới tất cả'}</span>
                </MagneticButton>
              </motion.div>

              {/* SECTION 2 & 3: MAIN GRID (ONE Compact Portfolio Summary Card + Watchlist Snapshot & Movers) */}
              <div className="dashboard-main-grid">

                {/* CARD 1: DANH MỤC CỦA TÔI (Single Compact Portfolio Summary Card) */}
                <motion.div variants={sectionItemVariants} className="fintech-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                        Danh mục của tôi
                      </span>
                    </div>
                    <MagneticButton
                      onClick={() => setActiveTab('portfolio')}
                      className="fintech-btn btn-secondary btn-sm"
                    >
                      Xem danh mục &rarr;
                    </MagneticButton>
                  </div>

                  <div style={{ flex: 1, padding: '1.25rem' }}>
                    {portfolioLoading && !portfolioOverview && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div className="skeleton-shimmer" style={{ width: '45%', height: '16px' }} />
                        <div className="skeleton-shimmer" style={{ width: '75%', height: '32px' }} />
                        <div className="skeleton-shimmer" style={{ width: '100%', height: '70px', marginTop: '0.5rem' }} />
                      </div>
                    )}

                    {portfolioError && !portfolioOverview && (
                      <div className="fintech-banner banner-error" style={{ margin: 0 }}>
                        <div>
                          <strong>Không thể tải danh mục:</strong> {portfolioError}
                        </div>
                        <MagneticButton onClick={() => fetchPortfolio(true)} className="fintech-btn btn-danger btn-sm" style={{ marginTop: '0.5rem' }}>
                          Thử lại
                        </MagneticButton>
                      </div>
                    )}

                    {portfolioOverview && (() => {
                      const holdingsList = Array.isArray(portfolioOverview.holdings) ? portfolioOverview.holdings : [];
                      const holdingsCount = holdingsList.length;
                      const unpricedCount = holdingsList.filter(
                        (h) => h.pricingStatus !== 'available' || h.latestPrice === null
                      ).length;

                      return (
                        <>
                          {portfolioOverview.summary.valuationStatus === 'partial' && unpricedCount > 0 && (
                            <div className="fintech-banner banner-warning" style={{ marginBottom: '1rem', padding: '0.55rem 0.85rem', fontSize: '0.8rem' }}>
                              <span>⚠️ <strong>Định giá một phần:</strong> {unpricedCount} mã chưa có dữ liệu giá thị trường.</span>
                            </div>
                          )}

                          {/* Big Total Portfolio Value */}
                          <div style={{ marginBottom: '1.25rem' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Tổng giá trị
                            </span>
                            <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--color-slate-900)', letterSpacing: '-0.02em', marginTop: '2px' }}>
                              {portfolioOverview.summary.totalPortfolioValue !== null
                                ? `${portfolioOverview.summary.totalPortfolioValue.toLocaleString('vi-VN')} đ`
                                : 'Chưa khả dụng'}
                            </div>
                          </div>

                          {/* Stacked key summary figures */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
                            {/* Cash Available */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.88rem', color: 'var(--color-slate-500)' }}>Tiền mặt:</span>
                              <strong style={{ fontSize: '0.95rem', color: 'var(--color-slate-900)' }}>
                                {portfolioOverview.summary.cashAvailable.toLocaleString('vi-VN')} đ
                              </strong>
                            </div>

                            {/* Unrealized P/L */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.88rem', color: 'var(--color-slate-500)' }}>Lãi/lỗ tạm tính:</span>
                              <div style={{ textAlign: 'right' }}>
                                {portfolioOverview.summary.totalUnrealizedPnL !== null ? (
                                  <span style={{
                                    fontWeight: 800,
                                    fontSize: '0.95rem',
                                    color: portfolioOverview.summary.totalUnrealizedPnL > 0
                                      ? 'var(--color-gain-700)'
                                      : portfolioOverview.summary.totalUnrealizedPnL < 0
                                        ? 'var(--color-loss-700)'
                                        : 'var(--color-slate-700)'
                                  }}>
                                    {portfolioOverview.summary.totalUnrealizedPnL > 0 ? '+' : ''}
                                    {portfolioOverview.summary.totalUnrealizedPnL.toLocaleString('vi-VN')} đ
                                    {portfolioOverview.summary.totalUnrealizedPnLPercent !== null && (
                                      <span style={{ fontSize: '0.82rem', marginLeft: '4px', fontWeight: 700 }}>
                                        ({portfolioOverview.summary.totalUnrealizedPnLPercent > 0 ? '+' : ''}
                                        {portfolioOverview.summary.totalUnrealizedPnLPercent.toFixed(2).replace('.', ',')}%)
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                                )}
                              </div>
                            </div>

                            {/* Holdings count indicator (derived directly from real holdings array length) */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.35rem' }}>
                              <span style={{ fontSize: '0.85rem', color: 'var(--color-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                <span>💼</span>
                                <span>
                                  {holdingsCount > 0
                                    ? `${holdingsCount} tài sản đang nắm giữ`
                                    : 'Chưa có tài sản nắm giữ'}
                                </span>
                              </span>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  <div className="dashboard-card-footer">
                    <MagneticButton
                      onClick={() => setActiveTab('portfolio')}
                      className="fintech-btn btn-primary btn-sm"
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      Xem danh mục &rarr;
                    </MagneticButton>
                  </div>
                </motion.div>

                {/* CARD 2: ĐANG THEO DÕI (Watchlist Snapshot & Movers) */}
                <motion.div variants={sectionItemVariants} className="fintech-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                        Đang theo dõi
                      </span>
                      {watchlist.length > 0 && (
                        <span className="fintech-badge badge-neutral">
                          {watchlist.length} mã
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>Dữ liệu thị trường</span>
                  </div>

                  {/* Section 5: Watchlist Movers Highlights */}
                  {(() => {
                    const movers = computeWatchlistMovers(watchlist, watchlistMarketData);
                    if (!movers.topGainer && !movers.topDecliner) return null;

                    return (
                      <div className="dashboard-mover-grid">
                        {movers.topGainer && (
                          <div
                            className="dashboard-mover-chip gain"
                            onClick={() => handleSelectAsset(movers.topGainer.symbol)}
                            title="Nhấn để xem chi tiết tài sản"
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-gain-700)' }}>
                                ▲ Tăng mạnh nhất {movers.topGainer.changeBasis === 'ROLLING_24H' ? '(24h)' : '(phiên)'}
                              </span>
                              <span style={{ fontWeight: 800, color: 'var(--color-gain-800)', fontSize: '0.82rem' }}>
                                +{Number(movers.topGainer.changePercent).toFixed(2)}%
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '2px' }}>
                              <strong style={{ fontSize: '0.95rem', color: 'var(--color-slate-900)' }}>
                                {movers.topGainer.symbol}
                              </strong>
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-600)' }}>
                                {formatNativeAmount(movers.topGainer.price, movers.topGainer.currency)}
                              </span>
                            </div>
                          </div>
                        )}

                        {movers.topDecliner && (
                          <div
                            className="dashboard-mover-chip loss"
                            onClick={() => handleSelectAsset(movers.topDecliner.symbol)}
                            title="Nhấn để xem chi tiết tài sản"
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-loss-700)' }}>
                                ▼ Giảm mạnh nhất {movers.topDecliner.changeBasis === 'ROLLING_24H' ? '(24h)' : '(phiên)'}
                              </span>
                              <span style={{ fontWeight: 800, color: 'var(--color-loss-800)', fontSize: '0.82rem' }}>
                                {Number(movers.topDecliner.changePercent).toFixed(2)}%
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '2px' }}>
                              <strong style={{ fontSize: '0.95rem', color: 'var(--color-slate-900)' }}>
                                {movers.topDecliner.symbol}
                              </strong>
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-600)' }}>
                                {formatNativeAmount(movers.topDecliner.price, movers.topDecliner.currency)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div style={{ flex: 1, padding: '0.75rem 1rem' }}>
                    {watchlistLoading && watchlist.length === 0 && (
                      <div className="skeleton-shimmer" style={{ width: '100%', height: '120px', borderRadius: '8px' }} />
                    )}

                    {watchlist.length === 0 && !watchlistLoading && (
                      <div className="state-box" style={{ padding: '1.5rem 1rem', border: 'none', boxShadow: 'none' }}>
                        <div className="state-icon float-icon" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⭐</div>
                        <h4 className="state-title" style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>Chưa có tài sản theo dõi</h4>
                        <p className="state-desc" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                          Lưu các mã bạn quan tâm để theo dõi biến động nhanh.
                        </p>
                        <MagneticButton
                          onClick={() => {
                            handleBackToList();
                            setActiveTab('assets');
                          }}
                          className="fintech-btn btn-primary btn-sm"
                        >
                          Khám phá tài sản &rarr;
                        </MagneticButton>
                      </div>
                    )}

                    {watchlist.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {watchlist.slice(0, 5).map((item) => {
                          const asset = item.asset || {};
                          const sym = asset.symbol || 'N/A';
                          const mkt = watchlistMarketData[sym];
                          const hasPrice = mkt && typeof mkt.price === 'number' && Number.isFinite(mkt.price) && mkt.price > 0;
                          const isGain = hasPrice && (mkt.change || 0) > 0;
                          const isLoss = hasPrice && (mkt.change || 0) < 0;

                          return (
                            <div
                              key={item.id || item.asset_id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.65rem 0.85rem',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'rgba(248, 250, 252, 0.7)',
                                border: '1px solid var(--border-subtle)',
                                cursor: 'pointer',
                                transition: 'background-color var(--transition-fast)'
                              }}
                              onClick={() => handleSelectAsset(sym)}
                            >
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--color-brand-50)',
                                    color: 'var(--color-brand-700)',
                                    border: '1px solid var(--color-brand-200)',
                                    fontWeight: 800,
                                    fontSize: '0.85rem'
                                  }}>
                                    {sym}
                                  </span>
                                  <span style={{ fontSize: '0.82rem', color: 'var(--color-slate-700)', fontWeight: 600 }}>
                                    {asset.name || 'Tài sản'}
                                  </span>
                                </div>
                              </div>

                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontWeight: 700, color: 'var(--color-slate-900)', fontSize: '0.9rem' }}>
                                  {hasPrice ? formatNativeAmount(mkt.price, asset.quote_currency || asset.quoteCurrency || mkt.currency || 'VND') : 'Chưa có giá'}
                                </div>
                                <div style={{ marginTop: '2px' }}>
                                  {hasPrice && mkt.changePercent !== null && mkt.changePercent !== undefined ? (
                                    <span className={`fintech-badge ${isGain ? 'badge-gain' : isLoss ? 'badge-loss' : 'badge-neutral'}`} style={{ fontSize: '0.72rem', padding: '1px 6px' }}>
                                      {isGain ? '+' : ''}{Number(mkt.changePercent).toFixed(2)}%
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>—</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="dashboard-card-footer">
                    <MagneticButton
                      onClick={() => setActiveTab('watchlist')}
                      className="fintech-btn btn-secondary btn-sm"
                    >
                      Xem tất cả theo dõi &rarr;
                    </MagneticButton>
                  </div>
                </motion.div>
              </div>

              {/* SECTION 4: TIN MỚI (News Preview - 4 Balanced Responsive Columns) */}
              <motion.div variants={sectionItemVariants} className="fintech-card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                      Tin tức tài chính mới nhất
                    </h3>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>Cập nhật đa nguồn thị trường</span>
                  </div>

                  <MagneticButton
                    onClick={() => setActiveTab('news')}
                    className="fintech-btn btn-secondary btn-sm"
                  >
                    Xem tất cả tin tức &rarr;
                  </MagneticButton>
                </div>

                {newsLoading && news.length === 0 && (
                  <div className="dashboard-news-grid">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="skeleton-shimmer" style={{ width: '100%', height: '80px', borderRadius: '6px' }} />
                    ))}
                  </div>
                )}

                {newsError && news.length === 0 && !newsLoading && (
                  <div className="fintech-banner banner-warning" style={{ margin: 0 }}>
                    <span>Không thể tải tin tức mới nhất: {newsError}</span>
                  </div>
                )}

                {news.length > 0 && (
                  <div className="dashboard-news-grid">
                    {news.slice(0, 4).map((item) => {
                      const catLabel = formatNewsCategory(item.category);

                      return (
                        <div
                          key={item.id || item.url}
                          style={{
                            padding: '0.85rem',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: 'rgba(248, 250, 252, 0.7)',
                            border: '1px solid var(--border-subtle)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '0.5rem'
                          }}
                        >
                          <div>
                            {catLabel && (
                              <span className="fintech-badge badge-neutral" style={{ fontSize: '0.7rem', padding: '1px 6px', marginBottom: '4px', display: 'inline-block' }}>
                                {catLabel}
                              </span>
                            )}
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: 'var(--color-slate-900)',
                                fontWeight: 700,
                                fontSize: '0.88rem',
                                lineHeight: 1.35,
                                textDecoration: 'none',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                              }}
                              className="news-title-link"
                            >
                              {item.title}
                            </a>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--color-slate-400)', marginTop: '4px' }}>
                            <span>{item.source || 'CafeF'}</span>
                            <span>{formatPublishedTime(item.publishedAt)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            </motion.section>
          )}

          {/* TAB 1: PORTFOLIO OVERVIEW */}
          {activeTab === 'portfolio' && (
            <motion.section
              key="portfolio-view"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {/* Header with 3D Constellation Orb & Wealth Orbit Widget */}
              <motion.div variants={sectionItemVariants} className="section-header" style={{ alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                  <Fintech3DOrb size={74} className="dashboard-3d-accent" />
                  <div>
                    <h2 className="section-title">Tổng quan danh mục</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span className="section-subtitle">
                        Theo dõi giá trị tài sản, lãi/lỗ và cơ cấu danh mục đầu tư
                      </span>
                      <span className="fintech-badge badge-neutral" style={{ animation: 'pulseGlow 3s ease-in-out infinite' }}>
                        Dữ liệu theo thời điểm cập nhật của nhà cung cấp
                      </span>
                    </div>

                    {/* Additive Wealth Orbit Lifecycle Display */}
                    <WealthOrbit />
                  </div>
                </div>

                {/* Refresh Button */}
                <MagneticButton
                  onClick={() => {
                    fetchPortfolio(false);
                    fetchComposition(false);
                    fetchTransactions(false);
                    fetchCashOverview(false);
                    fetchCashLedger(false);
                  }}
                  disabled={portfolioRefreshing || compositionRefreshing || transactionsRefreshing || cashOverviewRefreshing || cashLedgerRefreshing || portfolioLoading}
                  className="fintech-btn btn-secondary btn-sm"
                >
                  <span className={portfolioRefreshing || compositionRefreshing || transactionsRefreshing || cashOverviewRefreshing || cashLedgerRefreshing ? 'spin-icon' : ''}>
                    {portfolioRefreshing || compositionRefreshing || transactionsRefreshing || cashOverviewRefreshing || cashLedgerRefreshing ? '⟳' : '↻'}
                  </span>
                  <span>{portfolioRefreshing || compositionRefreshing || transactionsRefreshing || cashOverviewRefreshing || cashLedgerRefreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
                </MagneticButton>
              </motion.div>

              {/* Loading State */}
              {portfolioLoading && (
                <div className="state-box">
                  <div className="state-icon spin-icon">⏳</div>
                  <h3 className="state-title">Đang tính toán tổng quan danh mục...</h3>
                  <p className="state-desc">Đang tải và cập nhật số liệu định giá thị trường mới nhất.</p>
                </div>
              )}

              {/* Fatal Error State */}
              {portfolioError && !portfolioLoading && !portfolioOverview && (
                <div className="fintech-banner banner-error">
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Không thể tải tổng quan danh mục</strong>
                    <span style={{ fontSize: '0.85rem' }}>{portfolioError}</span>
                  </div>
                  <MagneticButton
                    onClick={() => fetchPortfolio(true)}
                    className="fintech-btn btn-danger btn-sm"
                  >
                    Thử lại
                  </MagneticButton>
                </div>
              )}

              {/* Non-fatal Refresh Error Banner */}
              {portfolioError && portfolioOverview && (
                <div className="fintech-banner banner-warning">
                  <span>Không thể làm mới dữ liệu định giá ({portfolioError}). Đang hiển thị kết quả gần nhất.</span>
                </div>
              )}

              {/* Partial Valuation Warning Banner */}
              {!portfolioLoading && portfolioOverview && portfolioOverview.summary?.valuationStatus === 'partial' && (
                <div className="fintech-banner banner-warning">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>⚠️</span>
                    <span><strong>Định giá một phần</strong> — một số tài sản chưa có dữ liệu giá thị trường từ sàn.</span>
                  </div>
                </div>
              )}

              {/* Feature 25D: Portfolio performance and benchmark comparison */}
              {!portfolioLoading && (
                <PortfolioPerformanceSection />
              )}

              {/* Content when loaded */}
              {!portfolioLoading && portfolioOverview && (
                <>
                  {/* Feature 15: Cash Management Section (Overview, Deposit/Withdraw, Cash Ledger) */}
                  <CashManagementSection
                    cashOverview={cashOverview}
                    cashOverviewLoading={cashOverviewLoading}
                    cashOverviewError={cashOverviewError}
                    cashLedger={cashLedger}
                    cashLedgerLoading={cashLedgerLoading}
                    cashLedgerError={cashLedgerError}
                    onOpenDeposit={() => {
                      setCashModalMode('DEPOSIT');
                      setIsCashModalOpen(true);
                    }}
                    onOpenWithdraw={() => {
                      setCashModalMode('WITHDRAWAL');
                      setIsCashModalOpen(true);
                    }}
                    onRefresh={() => {
                      fetchCashOverview(false);
                      fetchCashLedger(false);
                    }}
                  />

                  {/* Metric Summary Cards with 3D Tilt & Dynamic Radial Sheen */}
                  <motion.div variants={sectionItemVariants} className="metrics-grid">
                    {/* Metric 1: Total Cost Basis */}
                    <TiltCard className="metric-card" style={{ '--card-accent': '#64748b' }}>
                      <div className="metric-header">
                        <span className="metric-label">Giá vốn đang nắm giữ</span>
                        <span className="metric-icon">💼</span>
                      </div>
                      <div className="metric-value">
                        <CountUp value={portfolioOverview.summary.totalCostBasis} suffix=" ₫" />
                      </div>
                      <div className="metric-change" style={{ color: 'var(--color-slate-500)' }}>
                        Tổng chi phí mua ban đầu
                      </div>
                    </TiltCard>

                    {/* Metric 3: Total Market Value */}
                    <TiltCard className="metric-card" style={{ '--card-accent': '#6366f1' }}>
                      <div className="metric-header">
                        <span className="metric-label">Giá trị thị trường</span>
                        <span className="metric-icon">📊</span>
                      </div>
                      <div className="metric-value">
                        <CountUp value={portfolioOverview.summary.totalMarketValue} suffix=" ₫" />
                      </div>
                      <div className="metric-change" style={{ color: 'var(--color-slate-500)' }}>
                        Định giá theo giá khớp gần nhất
                      </div>
                    </TiltCard>

                    {/* Metric 4: Unrealized P/L */}
                    <TiltCard
                      className={`metric-card ${
                        portfolioOverview.summary.totalUnrealizedPnL > 0
                          ? 'metric-card-gain'
                          : portfolioOverview.summary.totalUnrealizedPnL < 0
                          ? 'metric-card-loss'
                          : ''
                      }`}
                      style={{
                        '--card-accent':
                          portfolioOverview.summary.totalUnrealizedPnL > 0
                            ? '#10b981'
                            : portfolioOverview.summary.totalUnrealizedPnL < 0
                            ? '#ef4444'
                            : '#94a3b8'
                      }}
                    >
                      <div className="metric-header">
                        <span className="metric-label">Lãi / Lỗ tạm tính</span>
                        <span className="metric-icon">
                          {portfolioOverview.summary.totalUnrealizedPnL > 0 ? '▲' : portfolioOverview.summary.totalUnrealizedPnL < 0 ? '▼' : '➖'}
                        </span>
                      </div>
                      <div
                        className="metric-value"
                        style={{
                          color: portfolioOverview.summary.totalUnrealizedPnL > 0
                            ? 'var(--color-gain-600)'
                            : portfolioOverview.summary.totalUnrealizedPnL < 0
                              ? 'var(--color-loss-600)'
                              : 'var(--color-slate-900)'
                        }}
                      >
                        {portfolioOverview.summary.totalUnrealizedPnL > 0 ? '+' : ''}
                        <CountUp value={portfolioOverview.summary.totalUnrealizedPnL} suffix=" ₫" />
                      </div>
                      <div className="metric-change">
                        <span className={`fintech-badge ${portfolioOverview.summary.totalUnrealizedPnL > 0 ? 'badge-gain' : portfolioOverview.summary.totalUnrealizedPnL < 0 ? 'badge-loss' : 'badge-neutral'}`}>
                          {portfolioOverview.summary.totalUnrealizedPnLPercent !== null && portfolioOverview.summary.totalUnrealizedPnLPercent !== undefined ? (
                            <>
                              {portfolioOverview.summary.totalUnrealizedPnLPercent > 0 ? '+' : ''}
                              <CountUp value={portfolioOverview.summary.totalUnrealizedPnLPercent} decimals={2} suffix="%" />
                            </>
                          ) : '—'}
                        </span>
                      </div>
                    </TiltCard>

                    {/* Metric 5: Total Portfolio Value (Highlight with Animated Border Glow) */}
                    <TiltCard className="metric-card metric-card-highlight" borderGlow={true} style={{ '--card-accent': '#2563eb' }}>
                      <div className="metric-header">
                        <span className="metric-label" style={{ color: 'var(--color-brand-700)' }}>Tổng giá trị danh mục</span>
                        <span className="metric-icon">💎</span>
                      </div>
                      <div className="metric-value" style={{ color: 'var(--color-brand-700)', fontSize: '1.45rem' }}>
                        <CountUp value={portfolioOverview.summary.totalPortfolioValue} suffix=" ₫" />
                      </div>
                      <div className="metric-change" style={{ color: 'var(--color-brand-600)' }}>
                        Tiền mặt + Giá trị thị trường
                      </div>
                    </TiltCard>
                  </motion.div>

                  {/* Holdings Breakdown Table */}
                  <motion.div variants={sectionItemVariants} className="fintech-card" style={{ overflow: 'hidden' }}>
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                        Chi tiết tài sản nắm giữ ({portfolioOverview.holdings.length})
                      </span>
                      <MagneticButton
                        onClick={() => handleOpenOpeningPositionModal('CREATE')}
                        className="fintech-btn btn-secondary btn-sm"
                        style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <span>+</span>
                        <span>Thêm tài sản đã sở hữu từ trước</span>
                      </MagneticButton>
                    </div>

                    {portfolioOverview.holdings.length === 0 ? (
                      <div className="state-box" style={{ border: 'none', boxShadow: 'none' }}>
                        <div className="state-icon float-icon">💼</div>
                        <h3 className="state-title">Chưa có tài sản nào trong danh mục</h3>
                        <p className="state-desc" style={{ marginBottom: '1.25rem' }}>
                          Ghi nhận tài sản bạn đã sở hữu từ trước hoặc ghi nhận giao dịch mua mới để bắt đầu theo dõi danh mục.
                        </p>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <MagneticButton
                            onClick={() => handleOpenOpeningPositionModal('CREATE')}
                            className="fintech-btn btn-primary btn-sm"
                          >
                            + Thêm tài sản đã sở hữu từ trước
                          </MagneticButton>
                          <MagneticButton
                            onClick={() => {
                              setTransactionModalDefaultType('BUY');
                              setTransactionModalDefaultAsset(null);
                              setIsTransactionModalOpen(true);
                            }}
                            className="fintech-btn btn-secondary btn-sm"
                          >
                            + Ghi nhận giao dịch mua
                          </MagneticButton>
                        </div>
                      </div>
                    ) : (
                      <div className="table-container">
                        <table className="fintech-table">
                          <thead>
                            <tr>
                              <th>Mã & Tài sản</th>
                              <th style={{ textAlign: 'right' }}>Số lượng</th>
                              <th style={{ textAlign: 'right' }}>Giá mua TB</th>
                              <th style={{ textAlign: 'right' }}>Giá gần nhất</th>
                              <th style={{ textAlign: 'right' }}>Giá trị hiện tại</th>
                              <th style={{ textAlign: 'right' }}>Lãi / Lỗ tạm tính</th>
                              <th style={{ textAlign: 'right' }}>Cập nhật giá</th>
                            </tr>
                          </thead>
                          <tbody>
                            {portfolioOverview.holdings.map((h) => {
                              const isPriced = h.pricingStatus === 'available' && h.latestPrice !== null;
                              const isPnlSupported = h.pnlStatus === 'available' && h.unrealizedPnL !== null;
                              const isProfit = isPnlSupported && h.unrealizedPnL > 0;
                              const isLoss = isPnlSupported && h.unrealizedPnL < 0;
                              const holdingCurrency = h.asset?.quote_currency || h.asset?.quoteCurrency || h.currency || 'VND';

                              const holdingMeta = holdings.find((item) => item.asset_id === h.assetId || item.id === h.id);
                              const isEditable = holdingMeta?.opening_correction_allowed === true;

                              return (
                                <tr key={h.id}>
                                  {/* 1. Symbol & Name */}
                                  <td>
                                    <div style={{ fontWeight: 800, color: 'var(--color-slate-900)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                      <span>{h.symbol || 'N/A'}</span>
                                      {h.assetType && (
                                        <span className="fintech-badge badge-neutral">
                                          {formatAssetType(h.assetType)}
                                        </span>
                                      )}
                                      {isEditable && (
                                        <span
                                          className="fintech-badge badge-neutral"
                                          style={{ fontSize: '0.7rem', color: 'var(--color-brand-700)', backgroundColor: 'var(--color-brand-50)' }}
                                          title="Vị thế ban đầu ghi nhận trước khi dùng ứng dụng"
                                        >
                                          Vị thế ban đầu
                                        </span>
                                      )}
                                      {holdingMeta && !isEditable && (
                                        <span
                                          className="fintech-badge badge-neutral"
                                          style={{ fontSize: '0.7rem', color: 'var(--color-slate-500)' }}
                                          title="Đã phát sinh giao dịch — thay đổi số lượng qua Ghi nhận giao dịch"
                                        >
                                          Đã có giao dịch
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                                      {h.name || 'Tài sản'}
                                    </div>
                                  </td>

                                  {/* 2. Quantity */}
                                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-slate-900)' }}>
                                    {h.quantity.toLocaleString('vi-VN')}
                                  </td>

                                  {/* 3. Average Cost */}
                                  <td style={{ textAlign: 'right', color: 'var(--color-slate-700)' }}>
                                    {h.averageCost !== null && h.averageCost !== undefined
                                      ? formatNativeAmount(h.averageCost, holdingCurrency)
                                      : '—'}
                                  </td>

                                  {/* 4. Latest Price */}
                                  <td style={{ textAlign: 'right' }}>
                                    {isPriced ? (
                                      <span style={{ fontWeight: 700, color: 'var(--color-slate-900)' }}>
                                        {formatNativeAmount(h.latestPrice, holdingCurrency)}
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontStyle: 'italic' }}>
                                        Chưa có dữ liệu
                                      </span>
                                    )}
                                  </td>

                                  {/* 5. Market Value (Reporting VND) */}
                                  <td style={{ textAlign: 'right' }}>
                                    {isPriced && h.marketValue !== null ? (
                                      <span style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                        {formatVNDReporting(h.marketValue)}
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontStyle: 'italic' }}>
                                        Chưa có dữ liệu
                                      </span>
                                    )}
                                  </td>

                                  {/* 6. Unrealized PnL & % */}
                                  <td style={{ textAlign: 'right' }}>
                                    {isPnlSupported ? (
                                      <div>
                                        <div style={{
                                          fontWeight: 800,
                                          color: isProfit ? 'var(--color-gain-600)' : isLoss ? 'var(--color-loss-600)' : 'var(--color-slate-900)'
                                        }}>
                                          {isProfit ? '+' : ''}{formatVNDReporting(h.unrealizedPnL)}
                                        </div>
                                        <div style={{ marginTop: '2px' }}>
                                          <span className={`fintech-badge ${isProfit ? 'badge-gain' : isLoss ? 'badge-loss' : 'badge-neutral'}`}>
                                            {formatPercentVN(h.unrealizedPnLPercent)}
                                          </span>
                                        </div>
                                      </div>
                                    ) : h.pnlStatus === 'unavailable' ? (
                                      <span className="fintech-badge badge-neutral" style={{ fontSize: '0.72rem' }} title="Chưa hỗ trợ tính P&L cho tài sản phi VND">
                                        Chưa khả dụng
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontStyle: 'italic' }}>
                                        Chưa có dữ liệu
                                      </span>
                                    )}
                                  </td>

                                  {/* 7. Market Updated Time */}
                                  <td style={{ textAlign: 'right' }}>
                                    {isPriced && h.marketUpdatedAt ? (
                                      formatPublishedTime(h.marketUpdatedAt)
                                    ) : (
                                      <span style={{ color: 'var(--color-slate-400)', fontStyle: 'italic' }}>
                                        Chưa có dữ liệu
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </motion.div>

                  {/* Feature 14: Lịch sử giao dịch (Transaction History) */}
                  <TransactionHistorySection
                    transactions={transactions}
                    loading={transactionsLoading}
                    refreshing={transactionsRefreshing}
                    error={transactionsError}
                    holdingsCount={portfolioOverview.holdings.length}
                    onOpenTransactionModal={() => {
                      setTransactionModalDefaultType('BUY');
                      setTransactionModalDefaultAsset(null);
                      setIsTransactionModalOpen(true);
                    }}
                    onRetry={() => fetchTransactions(true)}
                    onRefresh={() => fetchTransactions(false)}
                  />

                  {/* Feature 10: Cơ cấu danh mục (Portfolio Composition & Concentration) */}
                  <PortfolioCompositionSection
                    data={compositionData}
                    loading={compositionLoading}
                    error={compositionError}
                    onRetry={() => fetchComposition(true)}
                  />
                </>
              )}
            </motion.section>
          )}

          {/* TAB: WATCHLIST / DANH SÁCH THEO DÕI (Feature 08) */}
          {activeTab === 'watchlist' && (
            <motion.section
              key="watchlist-view"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {/* Section Header */}
              <motion.div variants={sectionItemVariants} className="section-header" style={{ alignItems: 'center' }}>
                <div>
                  <h2 className="section-title">Danh sách theo dõi</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="section-subtitle">
                      Các tài sản bạn quan tâm theo dõi nhanh
                    </span>
                    <span className="fintech-badge badge-neutral">
                      Dữ liệu theo thời điểm cập nhật của nhà cung cấp
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Feature 12: Price Alerts Entry */}
                  <MagneticButton
                    onClick={() => {
                      setActiveTab('assets');
                      setIsViewingAlerts(true);
                    }}
                    className="fintech-btn btn-secondary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span>🔔</span>
                    <span>Cảnh báo giá</span>
                  </MagneticButton>

                  {/* Refresh Button */}
                  <MagneticButton
                    onClick={() => fetchWatchlist(false)}
                    disabled={watchlistRefreshing || watchlistLoading}
                    className="fintech-btn btn-secondary btn-sm"
                  >
                    <span className={watchlistRefreshing ? 'spin-icon' : ''}>{watchlistRefreshing ? '⟳' : '↻'}</span>
                    <span>{watchlistRefreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
                  </MagneticButton>
                </div>
              </motion.div>

              {/* Loading State */}
              {watchlistLoading && (
                <div className="state-box">
                  <div className="state-icon spin-icon">⏳</div>
                  <h3 className="state-title">Đang tải danh sách theo dõi...</h3>
                </div>
              )}

              {/* Fatal Error State */}
              {watchlistError && !watchlistLoading && watchlist.length === 0 && (
                <div className="fintech-banner banner-error">
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Không thể tải danh sách theo dõi</strong>
                    <span style={{ fontSize: '0.85rem' }}>{watchlistError}</span>
                  </div>
                  <MagneticButton
                    onClick={() => fetchWatchlist(true)}
                    className="fintech-btn btn-danger btn-sm"
                  >
                    Thử lại
                  </MagneticButton>
                </div>
              )}

              {/* Empty State (Section 6) */}
              {!watchlistLoading && watchlist.length === 0 && (
                <motion.div variants={sectionItemVariants} className="state-box">
                  <div className="state-icon float-icon">⭐</div>
                  <h3 className="state-title">Bạn chưa theo dõi tài sản nào.</h3>
                  <p className="state-desc" style={{ marginBottom: '1.25rem' }}>
                    Thêm các mã bạn quan tâm để xem lại nhanh hơn.
                  </p>
                  <MagneticButton
                    onClick={() => {
                      handleBackToList();
                      setActiveTab('assets');
                    }}
                    className="fintech-btn btn-primary btn-sm"
                  >
                    Khám phá danh sách tài sản &rarr;
                  </MagneticButton>
                </motion.div>
              )}

              {/* Saved Assets Table (Section 5, 7, 8) */}
              {!watchlistLoading && watchlist.length > 0 && (
                <motion.div variants={sectionItemVariants} className="fintech-card" style={{ overflow: 'hidden' }}>
                  <div className="card-header">
                    <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                      Tài sản đang theo dõi ({watchlist.length})
                    </span>
                  </div>

                  <div className="table-container">
                    <table className="fintech-table">
                      <thead>
                        <tr>
                          <th>Mã & Tài sản</th>
                          <th>Loại tài sản</th>
                          <th>Thị trường</th>
                          <th style={{ textAlign: 'right' }}>Giá gần nhất</th>
                          <th style={{ textAlign: 'right' }}>Biến động</th>
                          <th style={{ textAlign: 'right' }}>Cập nhật</th>
                          <th style={{ textAlign: 'right' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {watchlist.map((item) => {
                          const asset = item.asset || {};
                          const sym = asset.symbol || 'N/A';
                          const mkt = watchlistMarketData[sym];
                          const hasPrice = mkt && typeof mkt.price === 'number' && isFinite(mkt.price) && mkt.price > 0;
                          const isGain = hasPrice && (mkt.change || 0) > 0;
                          const isLoss = hasPrice && (mkt.change || 0) < 0;
                          const isActionLoading =
                            watchlistActionLoading === sym || watchlistActionLoading === item.asset_id;

                          return (
                            <tr key={item.id || item.asset_id}>
                              {/* 1. Symbol & Name */}
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--color-brand-50)',
                                    color: 'var(--color-brand-700)',
                                    border: '1px solid var(--color-brand-200)',
                                    fontWeight: 800
                                  }}>
                                    {sym}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                                  {asset.name || 'Tài sản'}
                                </div>
                              </td>

                              {/* 2. Asset Type */}
                              <td>
                                <span className="fintech-badge badge-neutral">
                                  {formatAssetType(asset.asset_type)}
                                </span>
                              </td>

                              {/* 3. Exchange / Market Context */}
                              <td style={{ color: 'var(--color-slate-500)' }}>
                                {formatMarketContext(asset)}
                              </td>

                              {/* 4. Latest Market Price (Failure-isolated) */}
                              <td style={{ textAlign: 'right' }}>
                                {hasPrice ? (
                                  <span style={{ fontWeight: 800, color: 'var(--color-slate-900)', fontSize: '0.95rem' }}>
                                    {formatNativeAmount(mkt.price, asset.quote_currency || asset.quoteCurrency || mkt.currency || 'VND')}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-400)', fontStyle: 'italic' }}>
                                    Chưa có dữ liệu giá
                                  </span>
                                )}
                              </td>

                              {/* 5. Change & % Change */}
                              <td style={{ textAlign: 'right' }}>
                                {hasPrice && mkt.change !== null && mkt.change !== undefined ? (
                                  <span className={`fintech-badge ${isGain ? 'badge-gain' : isLoss ? 'badge-loss' : 'badge-neutral'}`}>
                                    {formatMarketChange(mkt.change, asset.quote_currency || asset.quoteCurrency || mkt.currency || 'VND')}
                                    {mkt.changePercent !== null && mkt.changePercent !== undefined
                                      ? ` (${mkt.changePercent > 0 ? '+' : ''}${Number(mkt.changePercent).toFixed(2)}%)`
                                      : ''}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--color-slate-400)' }}>—</span>
                                )}
                              </td>

                              {/* 6. Market Updated Time */}
                              <td style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--color-slate-500)' }}>
                                {hasPrice && mkt.updatedAt ? formatPublishedTime(mkt.updatedAt) : '—'}
                              </td>

                              {/* 7. Quick Actions */}
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                                  <MagneticButton
                                    onClick={() => {
                                      setAlertTargetAsset({
                                        id: item.asset_id || item.id,
                                        symbol: sym,
                                        name: asset.name || sym,
                                        exchange: asset.exchange,
                                        asset_type: asset.asset_type,
                                        quote_currency: asset.quote_currency || asset.quoteCurrency || 'VND'
                                      });
                                      setIsAlertModalOpen(true);
                                    }}
                                    className="fintech-btn btn-secondary btn-sm"
                                    title="Đặt cảnh báo giá"
                                    style={{ padding: '0.35rem 0.6rem' }}
                                  >
                                    🔔
                                  </MagneticButton>
                                  <MagneticButton
                                    onClick={() => handleSelectAsset(sym)}
                                    className="fintech-btn btn-secondary btn-sm"
                                  >
                                    Xem chi tiết ↗
                                  </MagneticButton>
                                  <MagneticButton
                                    onClick={() => handleToggleWatchlist(item.asset_id, sym)}
                                    disabled={isActionLoading}
                                    className="fintech-btn btn-danger btn-sm"
                                  >
                                    {isActionLoading ? '...' : 'Bỏ theo dõi'}
                                  </MagneticButton>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </motion.section>
          )}

          {/* TAB 4: NEWS FEED */}
          {activeTab === 'news' && (
            <motion.section
              key="news-view"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {/* Header */}
              <motion.div variants={sectionItemVariants} className="section-header">
                <div>
                  <h2 className="section-title">
                    {newsSubTab === 'general' ? 'Tin tức thị trường' : 'Tin của tôi'}
                  </h2>
                  <p className="section-subtitle">
                    {newsSubTab === 'general' ? (
                      <>
                        Cập nhật tin tức tài chính, doanh nghiệp và vĩ mô mới nhất từ các nguồn uy tín
                      </>
                    ) : (
                      <>
                        Tin tức liên quan đến các tài sản bạn đang nắm giữ hoặc theo dõi
                      </>
                    )}
                  </p>
                </div>

                {/* Refresh Button */}
                <MagneticButton
                  onClick={() => {
                    if (newsSubTab === 'general') {
                      fetchNews(false);
                    } else {
                      fetchPersonalizedNews(false);
                    }
                  }}
                  disabled={
                    newsSubTab === 'general'
                      ? (newsRefreshing || newsLoading)
                      : (personalizedRefreshing || personalizedLoading)
                  }
                  className="fintech-btn btn-secondary btn-sm"
                >
                  <span
                    className={
                      (newsSubTab === 'general' ? newsRefreshing : personalizedRefreshing)
                        ? 'spin-icon'
                        : ''
                    }
                  >
                    {(newsSubTab === 'general' ? newsRefreshing : personalizedRefreshing) ? '⟳' : '↻'}
                  </span>
                  <span>
                    {(newsSubTab === 'general' ? newsRefreshing : personalizedRefreshing)
                      ? 'Đang làm mới...'
                      : 'Làm mới'}
                  </span>
                </MagneticButton>
              </motion.div>

              {/* Sub-tabs switcher (Tin mới / Tin của tôi) */}
              <motion.div variants={sectionItemVariants}>
                <div className="news-subtabs-bar">
                  <button
                    type="button"
                    onClick={() => setNewsSubTab('general')}
                    className={`news-subtab-btn ${newsSubTab === 'general' ? 'active' : ''}`}
                  >
                    <span>📰 Tin mới</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewsSubTab('personalized')}
                    className={`news-subtab-btn ${newsSubTab === 'personalized' ? 'active' : ''}`}
                  >
                    <span>🎯 Tin của tôi</span>
                    {personalizedNews.length > 0 && (
                      <span className="news-subtab-badge">{personalizedNews.length}</span>
                    )}
                  </button>
                </div>
              </motion.div>

              {/* Additive Economic Category Pulse Rail for General Feed */}
              {newsSubTab === 'general' && (
                <motion.div variants={sectionItemVariants}>
                  <EconomicPulseRail />
                </motion.div>
              )}

              {/* VIEW 1: GENERAL NEWS ("Tin mới") */}
              {newsSubTab === 'general' && (
                <>
                  {/* Loading State with Shimmer */}
                  {newsLoading && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="news-card" style={{ '--accent-color': '#e2e8f0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                            <div className="skeleton-shimmer" style={{ width: '80px', height: '20px' }} />
                            <div className="skeleton-shimmer" style={{ width: '100px', height: '16px' }} />
                          </div>
                          <div className="skeleton-shimmer" style={{ width: '85%', height: '22px', marginBottom: '0.65rem' }} />
                          <div className="skeleton-shimmer" style={{ width: '100%', height: '36px', marginBottom: '0.75rem' }} />
                          <div className="skeleton-shimmer" style={{ width: '60px', height: '14px' }} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Fatal Error State */}
                  {newsError && !newsLoading && news.length === 0 && (
                    <div className="fintech-banner banner-error">
                      <div>
                        <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Không thể tải tin tức</strong>
                        <span style={{ fontSize: '0.85rem' }}>{newsError}</span>
                      </div>
                      <MagneticButton
                        onClick={() => fetchNews(true)}
                        className="fintech-btn btn-danger btn-sm"
                      >
                        Thử lại
                      </MagneticButton>
                    </div>
                  )}

                  {/* Non-fatal Refresh Error Banner */}
                  {newsError && news.length > 0 && (
                    <div className="fintech-banner banner-warning">
                      <span>Không thể làm mới nguồn tin ({newsError}). Đang hiển thị các tin tức trước đó.</span>
                    </div>
                  )}

                  {/* Empty State */}
                  {!newsLoading && !newsError && news.length === 0 && (
                    <div className="state-box">
                      <div className="state-icon float-icon">📰</div>
                      <h3 className="state-title">Hiện chưa có tin tức nào</h3>
                      <p className="state-desc">Hãy nhấn nút "Làm mới" phía trên để tải nguồn tin mới nhất.</p>
                    </div>
                  )}

                  {/* News Articles List with Scroll Reveal */}
                  {!newsLoading && news.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      {news.map((item, idx) => {
                        const cat = CATEGORY_STYLES[item.category] || { label: item.category, bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', accent: '#94a3b8' };
                        return (
                          <motion.article
                            key={item.id || item.url}
                            className="news-card"
                            style={{ '--accent-color': cat.accent }}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-20px' }}
                            transition={{ duration: 0.28, delay: Math.min(idx * 0.03, 0.3) }}
                            whileHover={{ y: -2 }}
                          >
                            {/* Meta Row: Category Badge + Timestamp */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                              <span
                                className="fintech-badge"
                                style={{
                                  backgroundColor: cat.bg,
                                  color: cat.color,
                                  border: `1px solid ${cat.border}`,
                                  textTransform: 'uppercase'
                                }}
                              >
                                {cat.label}
                              </span>

                              <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontWeight: 500 }}>
                                {formatPublishedTime(item.publishedAt)}
                              </span>
                            </div>

                            {/* Headline Link */}
                            <h3 className="news-title">
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="news-title-link"
                              >
                                {item.title}
                              </a>
                            </h3>

                            {/* Summary */}
                            {item.summary && (
                              <p className="news-summary">
                                {item.summary}
                              </p>
                            )}

                            {/* Footer Row: Attribution + Read Original Link */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.45rem', borderTop: '1px solid var(--border-subtle)' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-slate-400)' }}>
                                Nguồn: {item.source || 'Tin tức'}
                              </span>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="news-link-action"
                              >
                                Đọc bài gốc ↗
                              </a>
                            </div>
                          </motion.article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* VIEW 2: PERSONALIZED NEWS ("Tin của tôi") */}
              {newsSubTab === 'personalized' && (
                <>
                  {/* Loading State with Shimmer */}
                  {personalizedLoading && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="news-card" style={{ '--accent-color': '#e2e8f0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                            <div className="skeleton-shimmer" style={{ width: '120px', height: '20px' }} />
                            <div className="skeleton-shimmer" style={{ width: '100px', height: '16px' }} />
                          </div>
                          <div className="skeleton-shimmer" style={{ width: '85%', height: '22px', marginBottom: '0.65rem' }} />
                          <div className="skeleton-shimmer" style={{ width: '100%', height: '36px', marginBottom: '0.75rem' }} />
                          <div className="skeleton-shimmer" style={{ width: '60px', height: '14px' }} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Fatal Error State */}
                  {personalizedError && !personalizedLoading && personalizedNews.length === 0 && (
                    <div className="fintech-banner banner-error">
                      <div>
                        <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Không thể tải tin tức cá nhân hóa</strong>
                        <span style={{ fontSize: '0.85rem' }}>{personalizedError}</span>
                      </div>
                      <MagneticButton
                        onClick={() => fetchPersonalizedNews(true)}
                        className="fintech-btn btn-danger btn-sm"
                      >
                        Thử lại
                      </MagneticButton>
                    </div>
                  )}

                  {/* Non-fatal Refresh Error Banner */}
                  {personalizedError && personalizedNews.length > 0 && (
                    <div className="fintech-banner banner-warning">
                      <span>Không thể làm mới tin tức cá nhân hóa ({personalizedError}). Đang hiển thị các tin tức trước đó.</span>
                    </div>
                  )}

                  {/* Empty State A: User has NO holdings and NO watchlist assets */}
                  {!personalizedLoading && !personalizedError && personalizedUserAssetCount === 0 && (
                    <div className="state-box">
                      <div className="state-icon float-icon">🎯</div>
                      <h3 className="state-title">Bạn chưa có tài sản để cá nhân hóa tin tức.</h3>
                      <p className="state-desc">
                        Thêm tài sản vào danh mục nắm giữ hoặc danh sách theo dõi để nhận tin tức phù hợp với danh mục của bạn.
                      </p>
                      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setActiveTab('assets')}
                          className="fintech-btn btn-primary btn-sm"
                        >
                          📈 Tài sản
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('watchlist')}
                          className="fintech-btn btn-secondary btn-sm"
                        >
                          ⭐ Theo dõi
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Empty State B: User has assets, but 0 matched articles in current feed */}
                  {!personalizedLoading && !personalizedError && personalizedUserAssetCount > 0 && personalizedNews.length === 0 && (
                    <div className="state-box">
                      <div className="state-icon float-icon">🔍</div>
                      <h3 className="state-title">Chưa có tin mới liên quan đến các tài sản của bạn.</h3>
                      <p className="state-desc">
                        Hiện tại chưa có bài viết mới nhắc đến các mã tài sản bạn đang nắm giữ hoặc theo dõi.
                      </p>
                      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.25rem' }}>
                        <button
                          type="button"
                          onClick={() => setNewsSubTab('general')}
                          className="fintech-btn btn-secondary btn-sm"
                        >
                          📰 Xem tất cả tin mới
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Personalized Articles List with Scroll Reveal */}
                  {!personalizedLoading && personalizedNews.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      {personalizedNews.map((item, idx) => {
                        const cat = CATEGORY_STYLES[item.category] || { label: item.category, bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', accent: '#94a3b8' };
                        return (
                          <motion.article
                            key={item.id || item.url}
                            className="news-card"
                            style={{ '--accent-color': cat.accent }}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-20px' }}
                            transition={{ duration: 0.28, delay: Math.min(idx * 0.03, 0.3) }}
                            whileHover={{ y: -2 }}
                          >
                            {/* Meta Row: Category Badge + Matched Asset Chips + Timestamp */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <span
                                  className="fintech-badge"
                                  style={{
                                    backgroundColor: cat.bg,
                                    color: cat.color,
                                    border: `1px solid ${cat.border}`,
                                    textTransform: 'uppercase'
                                  }}
                                >
                                  {cat.label}
                                </span>

                                {Array.isArray(item.matchedAssets) && item.matchedAssets.map((matched) => (
                                  <span
                                    key={matched.symbol}
                                    className="matched-asset-chip"
                                    title={matched.name || matched.symbol}
                                  >
                                    {matched.symbol}
                                  </span>
                                ))}
                              </div>

                              <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontWeight: 500 }}>
                                {formatPublishedTime(item.publishedAt)}
                              </span>
                            </div>

                            {/* Headline Link */}
                            <h3 className="news-title">
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="news-title-link"
                              >
                                {item.title}
                              </a>
                            </h3>

                            {/* Summary */}
                            {item.summary && (
                              <p className="news-summary">
                                {item.summary}
                              </p>
                            )}

                            {/* Footer Row: Attribution + Read Original Link */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.45rem', borderTop: '1px solid var(--border-subtle)' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-slate-400)' }}>
                                Nguồn: {item.source || 'Tin tức'}
                              </span>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="news-link-action"
                              >
                                Đọc bài gốc ↗
                              </a>
                            </div>
                          </motion.article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </motion.section>
          )}

          {/* TAB 3: ASSET BROWSER */}
          {activeTab === 'assets' && (
            <motion.section
              key="assets-view"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {isViewingAlerts ? (
                /* Feature 12: Price Alerts View */
                <AlertCenterSection
                  onSelectAsset={(sym) => {
                    setIsViewingAlerts(false);
                    handleSelectAsset(sym);
                  }}
                  onBackToAssets={() => setIsViewingAlerts(false)}
                />
              ) : isComparingAssets ? (
                /* Feature 11: Asset Comparison View */
                <AssetComparisonSection
                  availableAssets={assets}
                  initialSymbols={comparePresetSymbols}
                  onBack={() => setIsComparingAssets(false)}
                  onSelectAsset={(sym) => {
                    setIsComparingAssets(false);
                    handleSelectAsset(sym);
                  }}
                />
              ) : selectedSymbol ? (
                /* Detail View */
                <div>
                  <MagneticButton
                    onClick={handleBackToList}
                    className="fintech-btn btn-secondary btn-sm"
                    style={{ marginBottom: '1.25rem' }}
                  >
                    &larr; Quay lại danh sách
                  </MagneticButton>

                  {detailLoading && (
                    <div className="state-box" style={{ marginBottom: '1.25rem' }}>
                      <div className="state-icon spin-icon">⏳</div>
                      <p className="state-desc">Đang tải thông tin chi tiết cho {selectedSymbol}...</p>
                    </div>
                  )}

                  {detailError && (
                    <div className="fintech-banner banner-error">
                      <p style={{ margin: 0 }}><strong>Lỗi:</strong> {detailError}</p>
                    </div>
                  )}

                  {assetDetail && (
                    <TiltCard className="fintech-card" style={{ padding: '1.35rem 1.5rem', marginBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <h3 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                            {assetDetail.symbol}
                          </h3>
                          <span className="fintech-badge badge-brand">
                            {formatAssetType(assetDetail.asset_type)}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          {/* Feature 08: Compact Watchlist Action Button */}
                          {(() => {
                            const isFollowed = watchlist.some(
                              (w) => w.asset?.symbol === assetDetail.symbol || w.asset_id === assetDetail.id
                            );
                            const isLoadingThis =
                              watchlistActionLoading === assetDetail.symbol ||
                              watchlistActionLoading === assetDetail.id;

                            return (
                              <MagneticButton
                                onClick={() => handleToggleWatchlist(assetDetail.id, assetDetail.symbol)}
                                disabled={isLoadingThis}
                                className={`fintech-btn btn-sm ${isFollowed ? 'btn-watchlist-active' : 'btn-secondary'}`}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                              >
                                {isLoadingThis ? (
                                  <span className="spin-icon">⟳</span>
                                ) : isFollowed ? (
                                  <span>✓</span>
                                ) : (
                                  <span>＋</span>
                                )}
                                <span>
                                  {isLoadingThis ? 'Đang cập nhật...' : isFollowed ? 'Đang theo dõi' : 'Theo dõi'}
                                </span>
                              </MagneticButton>
                            );
                          })()}

                          {/* Feature 12: Compact Price Alert Action Button */}
                          <MagneticButton
                            onClick={() => {
                              setAlertTargetAsset(assetDetail);
                              setIsAlertModalOpen(true);
                            }}
                            className="fintech-btn btn-secondary btn-sm"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          >
                            <span>🔔</span>
                            <span>Đặt cảnh báo</span>
                          </MagneticButton>
                        </div>
                      </div>
                      <p style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', color: 'var(--color-slate-600)', fontWeight: 600 }}>
                        {assetDetail.name}
                      </p>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.88rem' }}>
                        <div><span style={{ color: 'var(--color-slate-500)' }}>Mã tài sản:</span> <strong style={{ color: 'var(--color-slate-900)' }}>{assetDetail.symbol}</strong></div>
                        <div><span style={{ color: 'var(--color-slate-500)' }}>Loại tài sản:</span> <strong style={{ color: 'var(--color-slate-900)' }}>{formatAssetType(assetDetail.asset_type)}</strong></div>
                        <div><span style={{ color: 'var(--color-slate-500)' }}>Thị trường:</span> <strong style={{ color: 'var(--color-slate-900)' }}>{formatMarketContext(assetDetail)}</strong></div>
                        <div><span style={{ color: 'var(--color-slate-500)' }}>Mã định danh:</span> <span style={{ color: 'var(--color-slate-400)', fontSize: '0.78rem' }}>{assetDetail.id}</span></div>
                      </div>
                    </TiltCard>
                  )}

                  {/* Market Snapshot Card with 3D Tilt */}
                  {(() => {
                    const isRealtime = !!realtimeData && realtimeData.price !== null;
                    const displayData = isRealtime ? realtimeData : marketData;
                    const referenceVnd = isRealtime ? realtimeData.referenceVnd : null;
                    const showReferenceVnd = referenceVnd?.approximate === true
                      && referenceVnd?.referenceOnly === true
                      && referenceVnd?.accountingEligible === false
                      && typeof referenceVnd?.value === 'number'
                      && Number.isFinite(referenceVnd.value)
                      && referenceVnd.value > 0;

                    return (
                      <TiltCard className="fintech-card" style={{ padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>Giá thị trường</h3>
                              {isRealtime && (
                                <span className="fintech-badge badge-gain" style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                                  Realtime
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>
                              {isRealtime
                                ? `Binance realtime (USDT) · ${realtimeData.freshness === 'live' ? 'Trực tiếp' : 'Gần đây'}`
                                : assetDetail?.market_policy === 'VN_EXCHANGE'
                                  ? 'Dữ liệu thị trường có độ trễ (~15 phút)'
                                  : 'Dữ liệu theo thời điểm cập nhật của nhà cung cấp'}
                            </span>
                          </div>
                          <MagneticButton
                            onClick={() => {
                              fetchMarketData(selectedSymbol, false);
                              if (assetDetail?.market_policy === 'CONTINUOUS_24_7') {
                                fetchRealtimeData(selectedSymbol);
                              }
                            }}
                            disabled={isRefreshing || marketLoading}
                            className="fintech-btn btn-secondary btn-sm"
                          >
                            <span className={isRefreshing ? 'spin-icon' : ''}>{isRefreshing ? '⟳' : '↻'}</span>
                            <span>{isRefreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
                          </MagneticButton>
                        </div>

                        {marketLoading && !displayData && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 0' }}>
                            <div className="skeleton-shimmer" style={{ width: '220px', height: '36px' }} />
                            <div className="metrics-grid" style={{ marginBottom: 0 }}>
                              {[1, 2, 3, 4].map((n) => (
                                <div key={n} className="skeleton-shimmer" style={{ height: '70px' }} />
                              ))}
                            </div>
                          </div>
                        )}

                        {!isRealtime && marketData?.freshness === 'stale' && (
                          <div className="fintech-banner banner-warning">
                            <span>
                              {marketError
                                ? `Không thể làm mới giá (${marketError}). Đang hiển thị bản ghi hợp lệ cuối cùng từ ${formatPublishedTime(marketData.priceAsOf || marketData.updatedAt)}, không phải giá mới.`
                                : `Dữ liệu giá đang cũ do nhà cung cấp tạm thời giới hạn yêu cầu. Thời điểm ghi nhận: ${formatPublishedTime(marketData.priceAsOf || marketData.updatedAt)}.`}
                            </span>
                          </div>
                        )}

                        {!isRealtime && marketError && marketData?.freshness !== 'stale' && (
                          <div className="fintech-banner banner-warning">
                            <span>Thông báo: Không thể tải dữ liệu giá thị trường ({marketError}).</span>
                          </div>
                        )}

                        {displayData && (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.85rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
                                <span style={{ fontSize: '2.15rem', fontWeight: 800, color: 'var(--color-slate-900)', letterSpacing: '-0.02em' }}>
                                  {displayData.price !== null ? (
                                    formatNativeAmount(displayData.price, displayData.currency)
                                  ) : 'N/A'}
                                </span>
                                {showReferenceVnd && (
                                  <span
                                    title="Giá VND tham chiếu, không dùng cho định giá danh mục"
                                    style={{ fontSize: '0.88rem', fontWeight: 650, color: 'var(--color-slate-500)', lineHeight: 1.35 }}
                                  >
                                    ≈ {formatNativeAmount(referenceVnd.value, 'VND')}
                                    <span style={{ marginLeft: '0.45rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-slate-400)' }}>
                                      Giá tham chiếu · không dùng cho định giá danh mục
                                    </span>
                                  </span>
                                )}
                              </div>

                              {displayData.change !== null && displayData.change !== undefined ? (
                                <span className={`fintech-badge ${(displayData.change || 0) >= 0 ? 'badge-gain' : 'badge-loss'}`} style={{ fontSize: '0.88rem', padding: '4px 12px' }}>
                                  {displayData.change > 0 ? '+' : ''}
                                  {formatMarketChange(displayData.change, displayData.currency)} ({displayData.changePercent > 0 ? '+' : ''}{displayData.changePercent !== null && displayData.changePercent !== undefined ? `${Number(displayData.changePercent).toFixed(2)}%` : '—'})
                                </span>
                              ) : (
                                <span className="fintech-badge badge-neutral" style={{ fontSize: '0.88rem', padding: '4px 12px' }}>
                                  —
                                </span>
                              )}
                            </div>

                            <div className="metrics-grid" style={{ marginBottom: 0 }}>
                              <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#64748b' }}>
                                <div className="metric-label">Cao nhất trong ngày</div>
                                <div className="metric-value" style={{ fontSize: '1.15rem' }}>
                                  {displayData.dayHigh !== null ? formatNativeAmount(displayData.dayHigh, displayData.currency) : 'N/A'}
                                </div>
                              </div>

                              <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#64748b' }}>
                                <div className="metric-label">Thấp nhất trong ngày</div>
                                <div className="metric-value" style={{ fontSize: '1.15rem' }}>
                                  {displayData.dayLow !== null ? formatNativeAmount(displayData.dayLow, displayData.currency) : 'N/A'}
                                </div>
                              </div>

                              <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#3b82f6' }}>
                                <div className="metric-label">Khối lượng giao dịch</div>
                                <div className="metric-value" style={{ fontSize: '1.15rem' }}>
                                  {displayData.volume !== null ? displayData.volume.toLocaleString('vi-VN') : 'N/A'}
                                </div>
                              </div>

                              <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#10b981' }}>
                                <div className="metric-label">Cập nhật lúc</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-slate-600)' }}>
                                  {formatPublishedTime(displayData.observedAt || displayData.updatedAt)}
                                </div>
                              </div>
                            </div>

                            {isRealtime && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)', marginTop: '0.75rem', textAlign: 'right' }}>
                                * Giá tham chiếu USDT theo thời gian thực từ Binance Spot (không dùng cho định giá danh mục VND).
                              </div>
                            )}
                          </div>
                        )}
                      </TiltCard>
                    );
                  })()}


                  {/* Historical Price & Trend Card (Feature 06) */}
                  {selectedSymbol === 'USD/VND' || historyData?.unsupported ? (
                    <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>Lịch sử giá</h3>
                        <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>Không hỗ trợ</span>
                      </div>
                      <div style={{ padding: '1rem', backgroundColor: 'var(--color-slate-50, #f8fafc)', borderRadius: '10px', border: '1px solid var(--color-slate-200, #e2e8f0)', fontSize: '0.85rem', color: 'var(--color-slate-600)' }}>
                        Lịch sử giá hiện chưa được hỗ trợ cho USD/VND.
                      </div>
                    </TiltCard>
                  ) : (
                    <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
                      {/* Header: Title, delayed badge, and range selector */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>Lịch sử giá</h3>
                            <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                              Dữ liệu lịch sử đã hoàn tất
                            </span>
                          </div>
                          {historyData && historyData.updatedAt && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', display: 'block', marginTop: '2px' }}>
                              Cập nhật lúc: {formatPublishedTime(historyData.updatedAt)}
                            </span>
                          )}
                        </div>

                        {/* Range Selector: 1T | 1Th | 3Th | 6Th | 1N */}
                        <div className="range-selector-group">
                          {HISTORY_RANGES.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              className={`range-selector-btn ${historyRange === r.id ? 'active' : ''}`}
                              onClick={() => handleRangeChange(r.id)}
                              disabled={historyLoading}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Loading State */}
                      {historyLoading && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 0' }}>
                          <div className="skeleton-shimmer" style={{ width: '100%', height: '220px', borderRadius: 'var(--radius-md)' }} />
                          <div className="metrics-grid" style={{ marginBottom: 0 }}>
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <div key={n} className="skeleton-shimmer" style={{ height: '65px' }} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Error State */}
                      {historyError && !historyLoading && (
                        <div className="fintech-banner banner-warning" style={{ margin: '0.5rem 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <span>{historyError}</span>
                            <MagneticButton
                              onClick={() => fetchHistoryData(selectedSymbol, historyRange)}
                              className="fintech-btn btn-secondary btn-sm"
                            >
                              Thử lại
                            </MagneticButton>
                          </div>
                        </div>
                      )}

                      {/* Content when loaded */}
                      {historyData && !historyLoading && (() => {
                        const historyCurrency = historyData.quoteCurrency || historyData.currency || assetDetail?.quote_currency || 'VND';
                        const isCloseOnly = historyData.historyCapabilities?.ohlc === false || assetDetail?.market_policy === 'CONTINUOUS_24_7' || assetDetail?.market_policy === 'GLOBAL_24_5';
                        let effHigh = isCloseOnly ? (historyData.metrics?.highestCompletedClose ?? historyData.metrics?.periodHigh) : historyData.metrics?.periodHigh;
                        let effLow = isCloseOnly ? (historyData.metrics?.lowestCompletedClose ?? historyData.metrics?.periodLow) : historyData.metrics?.periodLow;

                        if ((effHigh === null || effHigh === undefined) && Array.isArray(historyData.bars) && historyData.bars.length > 0) {
                          const validCloses = historyData.bars.map((b) => b.close).filter((c) => typeof c === 'number' && Number.isFinite(c));
                          if (validCloses.length > 0) {
                            effHigh = Math.max(...validCloses);
                            effLow = Math.min(...validCloses);
                          }
                        }

                        return (
                          <div>
                            {/* Summary Metrics Grid */}
                            <div className="metrics-grid" style={{ marginBottom: '1.25rem' }}>
                              {/* 1. Giá đầu kỳ */}
                              <div className="metric-card" style={{ padding: '0.85rem 1rem', '--card-accent': '#64748b' }}>
                                <div className="metric-label">Giá đầu kỳ</div>
                                <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                                  {historyData.metrics?.periodStartPrice !== null && historyData.metrics?.periodStartPrice !== undefined
                                    ? formatNativeAmount(historyData.metrics.periodStartPrice, historyCurrency)
                                    : 'N/A'}
                                </div>
                              </div>

                              {/* 2. Giá gần nhất */}
                              <div className="metric-card" style={{ padding: '0.85rem 1rem', '--card-accent': '#3b82f6' }}>
                                <div className="metric-label">Giá gần nhất</div>
                                <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                                  {historyData.metrics?.latestPrice !== null && historyData.metrics?.latestPrice !== undefined
                                    ? formatNativeAmount(historyData.metrics.latestPrice, historyCurrency)
                                    : 'N/A'}
                                </div>
                              </div>

                              {/* 3. Thay đổi tuyệt đối */}
                              <div
                                className={`metric-card ${
                                  (historyData.metrics?.absoluteChange || 0) > 0
                                    ? 'metric-card-gain'
                                    : (historyData.metrics?.absoluteChange || 0) < 0
                                    ? 'metric-card-loss'
                                    : ''
                                }`}
                                style={{ padding: '0.85rem 1rem', '--card-accent': (historyData.metrics?.absoluteChange || 0) >= 0 ? '#10b981' : '#ef4444' }}
                              >
                                <div className="metric-label">Thay đổi</div>
                                <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                                  {historyData.metrics?.absoluteChange !== null && historyData.metrics?.absoluteChange !== undefined
                                    ? formatMarketChange(historyData.metrics.absoluteChange, historyCurrency)
                                    : 'N/A'}
                                </div>
                              </div>

                              {/* 4. % Thay đổi */}
                              <div
                                className={`metric-card ${
                                  (historyData.metrics?.percentageChange || 0) > 0
                                    ? 'metric-card-gain'
                                    : (historyData.metrics?.percentageChange || 0) < 0
                                    ? 'metric-card-loss'
                                    : ''
                                }`}
                                style={{ padding: '0.85rem 1rem', '--card-accent': (historyData.metrics?.percentageChange || 0) >= 0 ? '#10b981' : '#ef4444' }}
                              >
                                <div className="metric-label">% Thay đổi</div>
                                <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                                  {historyData.metrics?.percentageChange !== null && historyData.metrics?.percentageChange !== undefined
                                    ? formatPercentVN(historyData.metrics.percentageChange)
                                    : 'N/A'}
                                </div>
                              </div>

                              {/* 5. Cao nhất kỳ */}
                              <div className="metric-card" style={{ padding: '0.85rem 1rem', '--card-accent': '#10b981' }}>
                                <div className="metric-label">{isCloseOnly ? 'Đóng cửa cao nhất' : 'Cao nhất'}</div>
                                <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                                  {effHigh !== null && effHigh !== undefined
                                    ? formatNativeAmount(effHigh, historyCurrency)
                                    : 'N/A'}
                                </div>
                              </div>

                              {/* 6. Thấp nhất kỳ */}
                              <div className="metric-card" style={{ padding: '0.85rem 1rem', '--card-accent': '#ef4444' }}>
                                <div className="metric-label">{isCloseOnly ? 'Đóng cửa thấp nhất' : 'Thấp nhất'}</div>
                                <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                                  {effLow !== null && effLow !== undefined
                                    ? formatNativeAmount(effLow, historyCurrency)
                                    : 'N/A'}
                                </div>
                              </div>
                            </div>

                            {/* Visual Trend Chart */}
                            <PriceHistoryChart
                              bars={historyData.bars || []}
                              percentageChange={historyData.metrics?.percentageChange}
                              currency={historyCurrency}
                            />
                          </div>
                        );
                      })()}
                    </TiltCard>
                  )}

                  {/* Deterministic Asset Analysis (Feature 07) */}
                  <AssetAnalysisSection
                    data={analysisData}
                    loading={analysisLoading}
                    error={analysisError}
                    onRetry={() => fetchAnalysisData(selectedSymbol, false)}
                    symbol={selectedSymbol}
                  />
                </div>
              ) : (
                /* Asset List View */
                <div>
                  {/* Dynamic counts and filtered collections */}
                  {(() => {
                    const assetCounts = { all: assets.length, stock: 0, etf: 0, crypto: 0, gold: 0, fx: 0 };
                    for (const a of assets) {
                      const t = String(a.asset_type || a.assetType || '').toLowerCase();
                      if (assetCounts[t] !== undefined) {
                        assetCounts[t]++;
                      }
                    }

                    const searchFilteredAssets = !assetSearchQuery.trim()
                      ? assets
                      : assets.filter((a) => {
                          const q = assetSearchQuery.trim().toLowerCase();
                          const sym = String(a.symbol || '').toLowerCase();
                          const name = String(a.name || '').toLowerCase();
                          return sym.includes(q) || name.includes(q);
                        });

                    const currentFilteredAssets = assetTypeFilter === 'all'
                      ? searchFilteredAssets
                      : searchFilteredAssets.filter(
                          (a) => String(a.asset_type || a.assetType || '').toLowerCase() === assetTypeFilter
                        );

                    const renderAssetTable = (assetList) => (
                      <>
                        {/* Desktop View: Full 5-Column Table */}
                        <div className="asset-desktop-table table-container">
                          <table className="fintech-table">
                            <thead>
                              <tr>
                                <th style={{ width: '120px' }}>Mã</th>
                                <th>Tên tài sản</th>
                                <th style={{ width: '130px' }}>Loại tài sản</th>
                                <th style={{ width: '140px' }}>Thị trường</th>
                                <th style={{ textAlign: 'right', width: '140px' }}>Thao tác</th>
                              </tr>
                            </thead>
                            <tbody>
                              {assetList.map((asset) => (
                                <tr
                                  key={asset.id || asset.symbol}
                                  className="row-interactive"
                                  onClick={() => handleSelectAsset(asset.symbol)}
                                >
                                  <td style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                    <span className="asset-symbol-badge">
                                      {asset.symbol}
                                    </span>
                                  </td>
                                  <td style={{ color: 'var(--color-slate-800)', fontWeight: 600 }}>
                                    {asset.name}
                                  </td>
                                  <td>
                                    <span className="fintech-badge badge-neutral">
                                      {formatAssetType(asset.asset_type || asset.assetType)}
                                    </span>
                                  </td>
                                  <td style={{ color: 'var(--color-slate-600)', fontWeight: 500 }}>
                                    {formatMarketContext(asset)}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <MagneticButton
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSelectAsset(asset.symbol);
                                      }}
                                      className="fintech-btn btn-secondary btn-sm"
                                    >
                                      Xem chi tiết ↗
                                    </MagneticButton>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile View: Compact Responsive Rows */}
                        <div className="asset-mobile-list">
                          {assetList.map((asset) => (
                            <div
                              key={asset.id || asset.symbol}
                              className="asset-mobile-row"
                              onClick={() => handleSelectAsset(asset.symbol)}
                            >
                              <div className="asset-mobile-main">
                                <div className="asset-mobile-header">
                                  <span className="asset-symbol-badge">{asset.symbol}</span>
                                  <span className="asset-mobile-name">{asset.name}</span>
                                </div>
                                <div className="asset-mobile-meta">
                                  <span className="fintech-badge badge-neutral" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>
                                    {formatAssetType(asset.asset_type || asset.assetType)}
                                  </span>
                                  <span className="asset-mobile-dot">·</span>
                                  <span className="asset-mobile-context">{formatMarketContext(asset)}</span>
                                </div>
                              </div>
                              <div className="asset-mobile-action">
                                <MagneticButton
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectAsset(asset.symbol);
                                  }}
                                  className="fintech-btn btn-secondary btn-sm"
                                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
                                >
                                  Xem chi tiết ↗
                                </MagneticButton>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    );

                    return (
                      <>
                        <motion.div variants={sectionItemVariants} className="section-header" style={{ alignItems: 'center', marginBottom: '1rem' }}>
                          <div>
                            <h2 className="section-title">Danh sách tài sản</h2>
                            <p className="section-subtitle">
                              {assetSearchQuery.trim() || assetTypeFilter !== 'all'
                                ? `Hiển thị ${currentFilteredAssets.length} / ${assets.length} tài sản trong hệ thống`
                                : `${assets.length} tài sản trong hệ thống`}
                            </p>
                          </div>

                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            {/* Feature 12: Price Alerts Entry */}
                            <MagneticButton
                              onClick={() => {
                                setIsViewingAlerts(true);
                              }}
                              className="fintech-btn btn-secondary btn-sm"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                            >
                              <span>🔔</span>
                              <span>Cảnh báo giá</span>
                            </MagneticButton>

                            {/* Feature 11: Secondary Action */}
                            <MagneticButton
                              onClick={() => {
                                setComparePresetSymbols(['FPT', 'VCB']);
                                setIsComparingAssets(true);
                              }}
                              className="fintech-btn btn-secondary btn-sm"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                            >
                              <span>⚖️</span>
                              <span>So sánh tài sản</span>
                            </MagneticButton>
                          </div>
                        </motion.div>

                        {/* Top Filter & Search Bar */}
                        {!loading && !error && assets.length > 0 && (
                          <motion.div
                            variants={sectionItemVariants}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '0.75rem',
                              marginBottom: '1.25rem',
                              padding: '0.75rem 1rem',
                              background: 'rgba(255, 255, 255, 0.85)',
                              backdropFilter: 'blur(10px)',
                              borderRadius: 'var(--radius-lg)',
                              border: '1px solid var(--border-default)',
                              boxShadow: 'var(--shadow-xs)'
                            }}
                          >
                            {/* Filter Pills */}
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                              {ASSET_CLASS_FILTERS.map((f) => {
                                const count = assetCounts[f.id] || 0;
                                const isActive = assetTypeFilter === f.id;
                                return (
                                  <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => {
                                      setAssetTypeFilter(f.id);
                                      setCryptoExpanded(false);
                                    }}
                                    className={`asset-filter-pill ${isActive ? 'active' : ''}`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      padding: '0.35rem 0.75rem',
                                      fontSize: '0.82rem',
                                      fontWeight: isActive ? 700 : 600,
                                      borderRadius: 'var(--radius-full)',
                                      border: isActive ? '1.5px solid var(--color-brand-600)' : '1px solid var(--border-default)',
                                      background: isActive ? 'var(--color-brand-50)' : '#ffffff',
                                      color: isActive ? 'var(--color-brand-700)' : 'var(--color-slate-700)',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                  >
                                    <span>{f.label}</span>
                                    <span
                                      style={{
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        padding: '1px 6px',
                                        borderRadius: 'var(--radius-full)',
                                        background: isActive ? 'var(--color-brand-200)' : 'var(--color-slate-100)',
                                        color: isActive ? 'var(--color-brand-800)' : 'var(--color-slate-600)'
                                      }}
                                    >
                                      {count}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Search Input */}
                            <div style={{ position: 'relative', minWidth: '220px', maxWidth: '320px', flex: '1 1 auto' }}>
                              <span
                                style={{
                                  position: 'absolute',
                                  left: '10px',
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  fontSize: '0.85rem',
                                  color: 'var(--color-slate-400)',
                                  pointerEvents: 'none'
                                }}
                              >
                                🔍
                              </span>
                              <input
                                type="text"
                                placeholder="Tìm mã hoặc tên tài sản..."
                                value={assetSearchQuery}
                                onChange={(e) => setAssetSearchQuery(e.target.value)}
                                className="fintech-input"
                                style={{
                                  paddingLeft: '32px',
                                  paddingRight: assetSearchQuery ? '30px' : '12px',
                                  paddingTop: '0.4rem',
                                  paddingBottom: '0.4rem',
                                  fontSize: '0.85rem',
                                  height: '36px'
                                }}
                              />
                              {assetSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setAssetSearchQuery('')}
                                  style={{
                                    position: 'absolute',
                                    right: '8px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    fontSize: '0.85rem',
                                    color: 'var(--color-slate-400)',
                                    cursor: 'pointer',
                                    padding: '2px 4px',
                                    lineHeight: 1
                                  }}
                                  title="Xóa tìm kiếm"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </motion.div>
                        )}

                        {loading && (
                          <div className="state-box">
                            <div className="state-icon spin-icon">⏳</div>
                            <h3 className="state-title">Đang tải danh sách tài sản...</h3>
                          </div>
                        )}

                        {error && (
                          <div className="fintech-banner banner-error">
                            <p style={{ margin: 0 }}><strong>Lỗi tải danh sách tài sản:</strong> {error}</p>
                          </div>
                        )}

                        {!loading && !error && assets.length === 0 && (
                          <div className="state-box">
                            <div className="state-icon float-icon">📈</div>
                            <h3 className="state-title">Không tìm thấy tài sản nào</h3>
                            <p className="state-desc">Chưa có tài sản trong cơ sở dữ liệu.</p>
                          </div>
                        )}

                        {/* Empty search/filter result */}
                        {!loading && !error && assets.length > 0 && currentFilteredAssets.length === 0 && (
                          <div className="state-box">
                            <div className="state-icon float-icon">🔍</div>
                            <h3 className="state-title">
                              {assetSearchQuery.trim()
                                ? `Không tìm thấy tài sản phù hợp với "${assetSearchQuery}"`
                                : 'Không tìm thấy tài sản nào trong phân loại đã chọn'}
                            </h3>
                            <p className="state-desc">
                              {assetSearchQuery.trim()
                                ? 'Hãy thử tìm kiếm với mã hoặc tên tài sản khác.'
                                : 'Chưa có tài sản nào thuộc danh mục này.'}
                            </p>
                            {(assetSearchQuery.trim() || assetTypeFilter !== 'all') && (
                              <div style={{ marginTop: '1.25rem' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAssetSearchQuery('');
                                    setAssetTypeFilter('all');
                                  }}
                                  className="fintech-btn btn-secondary btn-sm"
                                >
                                  Xóa bộ lọc
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* "Tất cả" View: Grouped by Section */}
                        {!loading && !error && assetTypeFilter === 'all' && currentFilteredAssets.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {ASSET_SECTIONS.map((section) => {
                              const sectionAssets = searchFilteredAssets.filter(
                                (a) => String(a.asset_type || a.assetType || '').toLowerCase() === section.type
                              );
                              if (sectionAssets.length === 0) return null;

                              const isCrypto = section.type === 'crypto';
                              const isCollapsible = isCrypto && sectionAssets.length > 8;
                              const displayedAssets = isCollapsible && !cryptoExpanded
                                ? sectionAssets.slice(0, 8)
                                : sectionAssets;

                              return (
                                <motion.div
                                  key={section.type}
                                  variants={sectionItemVariants}
                                  className="fintech-card"
                                  style={{ overflow: 'hidden' }}
                                >
                                  {/* Section Subheader */}
                                  <div
                                    style={{
                                      padding: '0.85rem 1.25rem',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      background: 'rgba(248, 250, 252, 0.75)',
                                      borderBottom: '1px solid var(--border-subtle)'
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                                      <span style={{ fontSize: '1.1rem' }}>{section.icon}</span>
                                      <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                        {section.title}
                                      </h3>
                                      <span
                                        style={{
                                          fontSize: '0.72rem',
                                          fontWeight: 700,
                                          padding: '2px 7px',
                                          borderRadius: 'var(--radius-full)',
                                          backgroundColor: 'var(--color-brand-100)',
                                          color: 'var(--color-brand-800)',
                                          border: '1px solid var(--color-brand-200)'
                                        }}
                                      >
                                        {sectionAssets.length}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Table */}
                                  {renderAssetTable(displayedAssets)}

                                  {/* Bottom Expand/Collapse Control for Crypto */}
                                  {isCollapsible && (
                                    <div
                                      style={{
                                        padding: '0.65rem',
                                        textAlign: 'center',
                                        background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(248, 250, 252, 0.9) 100%)',
                                        borderTop: '1px solid var(--border-subtle)'
                                      }}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => setCryptoExpanded(!cryptoExpanded)}
                                        className="fintech-btn btn-secondary btn-sm"
                                        style={{ fontSize: '0.8rem' }}
                                      >
                                        {cryptoExpanded
                                          ? 'Thu gọn ▴'
                                          : `Xem tất cả ${sectionAssets.length} Crypto (${sectionAssets.length - displayedAssets.length} mã khác) ▾`}
                                      </button>
                                    </div>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        )}

                        {/* Dedicated Single-Type View */}
                        {!loading && !error && assetTypeFilter !== 'all' && currentFilteredAssets.length > 0 && (
                          <motion.div variants={sectionItemVariants} className="fintech-card" style={{ overflow: 'hidden' }}>
                            {renderAssetTable(currentFilteredAssets)}
                          </motion.div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </motion.section>
          )}

          {/* TAB 4: INVESTOR PROFILE & HOLDINGS */}
          {activeTab === 'profile' && (
            <motion.section
              key="profile-view"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <motion.div variants={sectionItemVariants} className="section-header">
                <div>
                  <h2 className="section-title">Hồ sơ đầu tư</h2>
                  <p className="section-subtitle">
                    Quản lý số tiền sẵn sàng đầu tư, mức chấp nhận rủi ro và thời gian đầu tư của bạn
                  </p>
                </div>
              </motion.div>

              {/* Loading State */}
              {profileLoading && (
                <div className="state-box">
                  <div className="state-icon spin-icon">⏳</div>
                  <h3 className="state-title">Đang tải hồ sơ đầu tư...</h3>
                </div>
              )}

              {/* Fatal Fetch Error State */}
              {profileError && !profile && !profileLoading && (
                <div className="fintech-banner banner-error">
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Không thể tải hồ sơ đầu tư</strong>
                    <span style={{ fontSize: '0.85rem' }}>{profileError}</span>
                  </div>
                  <MagneticButton
                    onClick={() => fetchProfile(true)}
                    className="fintech-btn btn-danger btn-sm"
                  >
                    Thử lại
                  </MagneticButton>
                </div>
              )}

              {/* Success Banner */}
              {profileSuccess && (
                <motion.div
                  className="fintech-banner banner-success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>✓</span>
                    <span>Đã lưu hồ sơ đầu tư thành công!</span>
                  </div>
                  <button
                    onClick={() => setProfileSuccess(false)}
                    className="banner-close-btn"
                  >
                    ×
                  </button>
                </motion.div>
              )}

              {/* Save Error Banner */}
              {profileError && profile && (
                <div className="fintech-banner banner-error">
                  <span>{profileError}</span>
                  <button
                    onClick={() => setProfileError(null)}
                    className="banner-close-btn"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Profile Form Card with Subtle 3D Tilt */}
              {!profileLoading && (
                <motion.div variants={sectionItemVariants}>
                  <TiltCard className="fintech-card" style={{ padding: '1.75rem', marginBottom: '2.5rem' }} tiltMax={2.5}>
                    <form onSubmit={handleSaveProfile}>
                      {/* Field 1: Read-only Current Cash (Feature 15 Ledger-Authoritative) */}
                      <div style={{ marginBottom: '1.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap', gap: '8px' }}>
                          <label style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                            Tiền mặt hiện tại
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab('portfolio');
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="fintech-btn btn-secondary btn-sm"
                            style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            <span>Quản lý dòng tiền</span>
                            <span>→</span>
                          </button>
                        </div>
                        <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.82rem', color: 'var(--color-slate-500)' }}>
                          Tiền mặt được cập nhật tự động từ lịch sử Nạp / Rút / Mua / Bán.
                        </p>
                        <div
                          style={{
                            padding: '0.85rem 1.1rem',
                            backgroundColor: 'var(--color-slate-50, #f8fafc)',
                            border: '1px solid var(--border-default, #cbd5e1)',
                            borderRadius: '10px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                            <CountUp value={cashOverview?.currentCash ?? profile?.cash_available ?? 0} suffix=" ₫" />
                          </div>
                          <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                            Từ sổ dòng tiền
                          </span>
                        </div>
                      </div>

                      {/* Field 2: Risk Tolerance */}
                      <div style={{ marginBottom: '1.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.25rem' }}>
                          Mức chấp nhận rủi ro
                        </label>
                        <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.82rem', color: 'var(--color-slate-500)' }}>
                          Mức độ chấp nhận biến động giá và rủi ro sụt giảm tài sản của bạn.
                        </p>
                        <div className="radio-card-grid">
                          {[
                            { value: 'low', label: 'Thấp', desc: 'Bảo toàn vốn, hạn chế rủi ro tối đa' },
                            { value: 'moderate', label: 'Vừa', desc: 'Cân bằng giữa lợi nhuận và an toàn' },
                            { value: 'high', label: 'Cao', desc: 'Kỳ vọng tăng trưởng cao, chấp nhận biến động lớn' }
                          ].map((item) => (
                            <motion.label
                              key={item.value}
                              className={`radio-card-item ${riskTolerance === item.value ? 'selected' : ''}`}
                              whileHover={{ y: -2 }}
                              whileTap={{ scale: 0.98 }}
                            >
                              <div className="radio-card-header">
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
                                <span className="radio-card-title">{item.label}</span>
                              </div>
                              <span className="radio-card-desc">{item.desc}</span>
                            </motion.label>
                          ))}
                        </div>
                      </div>

                      {/* Field 3: Investment Horizon */}
                      <div style={{ marginBottom: '2rem' }}>
                        <label style={{ display: 'block', fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.25rem' }}>
                          Thời gian đầu tư
                        </label>
                        <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.82rem', color: 'var(--color-slate-500)' }}>
                          Khoảng thời gian dự kiến trước khi bạn cần rút hoặc sử dụng vốn đầu tư.
                        </p>
                        <div className="radio-card-grid">
                          {[
                            { value: 'short', label: 'Ngắn hạn', desc: 'Dưới 1 năm' },
                            { value: 'medium', label: 'Trung hạn', desc: 'Từ 1 đến 3 năm' },
                            { value: 'long', label: 'Dài hạn', desc: 'Trên 3 năm' }
                          ].map((item) => (
                            <motion.label
                              key={item.value}
                              className={`radio-card-item ${investmentHorizon === item.value ? 'selected' : ''}`}
                              whileHover={{ y: -2 }}
                              whileTap={{ scale: 0.98 }}
                            >
                              <div className="radio-card-header">
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
                                <span className="radio-card-title">{item.label}</span>
                              </div>
                              <span className="radio-card-desc">{item.desc}</span>
                            </motion.label>
                          ))}
                        </div>
                      </div>

                      {/* Actions & Meta */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: '1.25rem',
                        borderTop: '1px solid var(--border-subtle)',
                        flexWrap: 'wrap',
                        gap: '0.75rem'
                      }}>
                        <MagneticButton
                          type="submit"
                          disabled={profileSaving}
                          className="fintech-btn btn-primary"
                        >
                          <span className={profileSaving ? 'spin-icon' : ''}>{profileSaving ? '⟳' : ''}</span>
                          <span>{profileSaving ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
                        </MagneticButton>

                        {profile && profile.updated_at && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-slate-400)' }}>
                            Cập nhật lúc: {formatPublishedTime(profile.updated_at)}
                          </span>
                        )}
                      </div>
                    </form>
                  </TiltCard>
                </motion.div>
              )}

              {/* SECTION 2: DANH MỤC HIỆN CÓ (HOLDINGS) */}
              <motion.div variants={sectionItemVariants} className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h2 className="section-title">Danh mục hiện có</h2>
                  <p className="section-subtitle">
                    Danh sách các tài sản và vị thế đang nắm giữ trong danh mục
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <MagneticButton
                    onClick={() => fetchHoldings(false)}
                    disabled={holdingsLoading}
                    className="fintech-btn btn-secondary btn-sm"
                  >
                    <span className={holdingsLoading ? 'spin-icon' : ''}>{holdingsLoading ? '⟳' : '↻'}</span>
                    <span>{holdingsLoading ? 'Đang tải...' : 'Làm mới'}</span>
                  </MagneticButton>
                  <MagneticButton
                    onClick={() => handleOpenOpeningPositionModal('CREATE')}
                    className="fintech-btn btn-primary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <span>+</span>
                    <span>Thêm tài sản đã sở hữu từ trước</span>
                  </MagneticButton>
                </div>
              </motion.div>

              {/* Holdings Feedback Banners */}
              {holdingsSuccess && (
                <motion.div
                  className="fintech-banner banner-success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>✓</span>
                    <span>{holdingsSuccess}</span>
                  </div>
                  <button
                    onClick={() => setHoldingsSuccess(null)}
                    className="banner-close-btn"
                  >
                    ×
                  </button>
                </motion.div>
              )}

              {holdingsError && (
                <div className="fintech-banner banner-error">
                  <span>{holdingsError}</span>
                  <button
                    onClick={() => setHoldingsError(null)}
                    className="banner-close-btn"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Feature 17: Guidance card for opening positions vs buy/sell */}
              <motion.div variants={sectionItemVariants}>
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    backgroundColor: 'var(--color-surface, #ffffff)',
                    border: '1px solid var(--border-default, #cbd5e1)',
                    borderRadius: '12px',
                    marginBottom: '1.5rem',
                    fontSize: '0.84rem',
                    color: 'var(--color-slate-600)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    lineHeight: 1.5
                  }}
                >
                  <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>💡</span>
                  <div>
                    <strong style={{ color: 'var(--color-slate-800)' }}>Quy tắc quản lý vị thế:</strong> Các tài sản bạn đã sở hữu trước khi dùng ứng dụng được thêm bằng nút <strong>"Thêm tài sản đã sở hữu từ trước"</strong> (không tạo giao dịch và không thay đổi tiền mặt). Để mua hoặc bán thêm tài sản sau này, hãy sử dụng tính năng <strong>Ghi nhận giao dịch</strong> trên trang Danh mục.
                  </div>
                </div>
              </motion.div>

              {/* Holdings Table */}
              <motion.div variants={sectionItemVariants} className="fintech-card" style={{ overflow: 'hidden' }}>
                <div className="card-header">
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                    Danh sách tài sản đang nắm giữ ({holdings.length})
                  </span>
                </div>

                {holdingsLoading && holdings.length === 0 && (
                  <div className="state-box" style={{ border: 'none', boxShadow: 'none' }}>
                    <div className="state-icon spin-icon">⏳</div>
                    <h3 className="state-title">Đang tải danh mục tài sản...</h3>
                  </div>
                )}

                {!holdingsLoading && holdings.length === 0 && (
                  <div className="state-box" style={{ border: 'none', boxShadow: 'none' }}>
                    <div className="state-icon float-icon">💼</div>
                    <h3 className="state-title">Chưa có tài sản nào trong danh mục</h3>
                    <p className="state-desc" style={{ marginBottom: '1.25rem' }}>
                      Sử dụng nút "Thêm tài sản đã sở hữu từ trước" phía trên để ghi nhận các khoản đầu tư bạn đang sở hữu.
                    </p>
                    <MagneticButton
                      onClick={() => handleOpenOpeningPositionModal('CREATE')}
                      className="fintech-btn btn-primary btn-sm"
                    >
                      + Thêm tài sản đã sở hữu từ trước
                    </MagneticButton>
                  </div>
                )}

                {holdings.length > 0 && (
                  <div className="table-container">
                    <table className="fintech-table">
                      <thead>
                        <tr>
                          <th>Tài sản</th>
                          <th>Nguồn gốc</th>
                          <th style={{ textAlign: 'right' }}>Số lượng</th>
                          <th style={{ textAlign: 'right' }}>Giá mua TB</th>
                          <th style={{ textAlign: 'right' }}>Tổng giá trị vốn</th>
                          <th style={{ textAlign: 'right' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map((h) => {
                          const asset = h.asset || {};
                          const totalCost = Number(h.quantity) * Number(h.average_cost);
                          const isCorrectionAllowed = h.opening_correction_allowed === true;

                          return (
                            <tr key={h.id}>
                              {/* Column 1: Asset symbol & name */}
                              <td>
                                <div style={{ fontWeight: 800, color: 'var(--color-slate-900)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span>{asset.symbol || 'N/A'}</span>
                                  {asset.asset_type && (
                                    <span className="fintech-badge badge-neutral">
                                      {formatAssetType(asset.asset_type)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--color-slate-500)', marginTop: '2px' }}>
                                  {asset.name || 'Tài sản'}
                                </div>
                              </td>

                              {/* Column 2: Origin / Provenance */}
                              <td>
                                {isCorrectionAllowed ? (
                                  <span className="fintech-badge badge-neutral" style={{ fontSize: '0.74rem', color: 'var(--color-brand-700)', backgroundColor: 'var(--color-brand-50)' }}>
                                    Vị thế ban đầu
                                  </span>
                                ) : (
                                  <span className="fintech-badge badge-neutral" style={{ fontSize: '0.74rem', color: 'var(--color-slate-600)' }}>
                                    Đã có giao dịch
                                  </span>
                                )}
                              </td>

                              {/* Column 3: Quantity */}
                              <td style={{ textAlign: 'right' }}>
                                <span style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                  {Number(h.quantity).toLocaleString('vi-VN')}
                                </span>
                              </td>

                              {/* Column 4: Average Cost */}
                              <td style={{ textAlign: 'right' }}>
                                <span style={{ color: 'var(--color-slate-700)', fontWeight: 600 }}>
                                  {Number(h.average_cost).toLocaleString('vi-VN')} ₫
                                </span>
                              </td>

                              {/* Column 5: Total Cost Basis */}
                              <td style={{ textAlign: 'right' }}>
                                <span style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                  {totalCost.toLocaleString('vi-VN')} ₫
                                </span>
                              </td>

                              {/* Column 6: Actions */}
                              <td style={{ textAlign: 'right' }}>
                                {isCorrectionAllowed ? (
                                  <div style={{ display: 'inline-flex', gap: '6px', justifyContent: 'flex-end' }}>
                                    <MagneticButton
                                      onClick={() => handleOpenOpeningPositionModal('CORRECT', h)}
                                      className="fintech-btn btn-secondary btn-sm"
                                      style={{ fontSize: '0.76rem', padding: '3px 7px' }}
                                    >
                                      Sửa thông tin ban đầu
                                    </MagneticButton>
                                    <MagneticButton
                                      onClick={() => handleOpenOpeningPositionModal('CANCEL', h)}
                                      className="fintech-btn btn-danger btn-sm"
                                      style={{ fontSize: '0.76rem', padding: '3px 7px' }}
                                    >
                                      Hủy vị thế ban đầu
                                    </MagneticButton>
                                  </div>
                                ) : (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                    <span
                                      style={{
                                        fontSize: '0.76rem',
                                        color: 'var(--color-slate-600)',
                                        backgroundColor: 'var(--color-slate-100)',
                                        padding: '3px 8px',
                                        borderRadius: '6px'
                                      }}
                                    >
                                      Đã có giao dịch — thay đổi bằng Mua/Bán
                                    </span>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            </motion.section>
          )}

        </AnimatePresence>

        {/* Feature 17: Opening Position Modal Dialog */}
        <OpeningPositionModal
          isOpen={isOpeningPositionModalOpen}
          onClose={() => {
            setIsOpeningPositionModalOpen(false);
            setOpeningPositionTargetHolding(null);
          }}
          mode={openingPositionModalMode}
          targetHolding={openingPositionTargetHolding}
          assets={assets}
          holdings={holdings}
          onSuccess={handleOpeningPositionSuccess}
        />

        {/* Feature 12: Price Alert Modal Dialog */}
        <PriceAlertModal
          isOpen={isAlertModalOpen}
          onClose={() => {
            setIsAlertModalOpen(false);
            setAlertTargetAsset(null);
          }}
          asset={alertTargetAsset}
          currentPrice={
            alertTargetAsset?.symbol === selectedSymbol && marketData?.price
              ? marketData.price
              : alertTargetAsset?.symbol && watchlistMarketData[alertTargetAsset.symbol]?.price
              ? watchlistMarketData[alertTargetAsset.symbol].price
              : null
          }
          onAlertCreated={() => {
            // Callback when alert is created
          }}
        />

        {/* Feature 14: Transaction Entry Modal Dialog */}
        <TransactionModal
          isOpen={isTransactionModalOpen}
          onClose={() => {
            setIsTransactionModalOpen(false);
            setTransactionModalDefaultAsset(null);
          }}
          assets={assets}
          holdings={portfolioOverview?.holdings || holdings}
          defaultType={transactionModalDefaultType}
          defaultAsset={transactionModalDefaultAsset}
          onTransactionRecorded={handleTransactionRecorded}
        />

        {/* Feature 15: Cash Movement Modal Dialog (Deposit / Withdraw) */}
        <CashMovementModal
          isOpen={isCashModalOpen}
          onClose={() => setIsCashModalOpen(false)}
          mode={cashModalMode}
          currentCash={cashOverview?.currentCash ?? profile?.cash_available ?? 0}
          onMovementSuccess={handleCashMovementSuccess}
        />
      </main>
    </div>
  );
}

export default App;
