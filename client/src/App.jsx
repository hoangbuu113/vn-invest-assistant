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

const CATEGORY_STYLES = {
  market: { label: 'Thị trường', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', accent: '#2563eb' },
  company: { label: 'Doanh nghiệp', bg: '#faf5ff', color: '#7c3aed', border: '#e9d5ff', accent: '#7c3aed' },
  macro: { label: 'Vĩ mô', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', accent: '#059669' },
  global: { label: 'Quốc tế', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa', accent: '#ea580c' }
};

const HISTORY_RANGES = [
  { id: '1W', label: '1T' },
  { id: '1M', label: '1Th' },
  { id: '3M', label: '3Th' },
  { id: '6M', label: '6Th' },
  { id: '1Y', label: '1N' }
];

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

const NEWS_CATEGORY_LABELS = {
  macro: 'Vĩ mô',
  market: 'Thị trường',
  company: 'Doanh nghiệp',
  international: 'Quốc tế'
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
        currency: mkt.currency || 'VND',
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
  const [cashAvailable, setCashAvailable] = useState('');
  const [riskTolerance, setRiskTolerance] = useState('moderate');
  const [investmentHorizon, setInvestmentHorizon] = useState('medium');

  // Holdings state
  const [holdings, setHoldings] = useState([]);
  const [holdingsLoading, setHoldingsLoading] = useState(true);
  const [holdingsError, setHoldingsError] = useState(null);
  const [holdingsSuccess, setHoldingsSuccess] = useState(null);

  // Add Holding form state
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newAverageCost, setNewAverageCost] = useState('');
  const [addHoldingLoading, setAddHoldingLoading] = useState(false);
  const [addHoldingError, setAddHoldingError] = useState(null);

  // Edit Holding inline state
  const [editingHoldingId, setEditingHoldingId] = useState(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editAverageCost, setEditAverageCost] = useState('');
  const [editHoldingLoading, setEditHoldingLoading] = useState(false);
  const [editHoldingError, setEditHoldingError] = useState(null);
  const [deletingHoldingId, setDeletingHoldingId] = useState(null);

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

  // Historical market data state (Feature 06)
  const [historyRange, setHistoryRange] = useState('1M'); // '1W' | '1M' | '3M' | '6M' | '1Y'
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // Deterministic Asset Analysis state (Feature 07)
  const [analysisData, setAnalysisData] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  // Request controller refs for stale response protection
  const activeMarketReqRef = useRef(null);
  const activeHistoryReqRef = useRef(null);
  const activeAssetDetailReqRef = useRef(null);
  const activeAnalysisReqRef = useRef(null);

  // News feed state
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [newsError, setNewsError] = useState(null);

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

  // Handle adding a holding
  const handleAddHolding = (e) => {
    if (e && e.preventDefault) e.preventDefault();

    if (!selectedAssetId) {
      setAddHoldingError('Vui lòng chọn một tài sản.');
      return;
    }

    const qty = Number(newQuantity);
    if (newQuantity === '' || isNaN(qty) || !isFinite(qty) || qty <= 0) {
      setAddHoldingError('Số lượng phải là số lớn hơn 0.');
      return;
    }

    const cost = Number(newAverageCost);
    if (newAverageCost === '' || isNaN(cost) || !isFinite(cost) || cost < 0) {
      setAddHoldingError('Giá mua trung bình phải là số không âm.');
      return;
    }

    setAddHoldingLoading(true);
    setAddHoldingError(null);
    setHoldingsSuccess(null);

    fetch('/api/holdings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_id: selectedAssetId,
        quantity: qty,
        average_cost: cost
      })
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((json) => {
            throw new Error(json.message || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setHoldings((prev) => [...prev, json.data]);
          setSelectedAssetId('');
          setNewQuantity('');
          setNewAverageCost('');
          setHoldingsSuccess(`Đã thêm ${json.data.asset?.symbol || 'tài sản'} vào danh mục thành công.`);
          fetchPortfolio(false);
          fetchComposition(false);
        }
      })
      .catch((err) => {
        setAddHoldingError(err.message || 'Không thể thêm tài sản vào danh mục.');
      })
      .finally(() => {
        setAddHoldingLoading(false);
      });
  };

  // Start editing a holding
  const handleStartEditHolding = (holding) => {
    setEditingHoldingId(holding.id);
    setEditQuantity(String(holding.quantity));
    setEditAverageCost(String(holding.average_cost));
    setEditHoldingError(null);
    setHoldingsSuccess(null);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingHoldingId(null);
    setEditQuantity('');
    setEditAverageCost('');
    setEditHoldingError(null);
  };

  // Save edited holding
  const handleSaveEditHolding = (id) => {
    const qty = Number(editQuantity);
    if (editQuantity === '' || isNaN(qty) || !isFinite(qty) || qty <= 0) {
      setEditHoldingError('Số lượng phải là số lớn hơn 0.');
      return;
    }

    const cost = Number(editAverageCost);
    if (editAverageCost === '' || isNaN(cost) || !isFinite(cost) || cost < 0) {
      setEditHoldingError('Giá mua trung bình phải là số không âm.');
      return;
    }

    setEditHoldingLoading(true);
    setEditHoldingError(null);

    fetch(`/api/holdings/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quantity: qty,
        average_cost: cost
      })
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((json) => {
            throw new Error(json.message || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok' && json.data) {
          setHoldings((prev) => prev.map((h) => (h.id === id ? json.data : h)));
          setEditingHoldingId(null);
          setHoldingsSuccess(`Đã cập nhật ${json.data.asset?.symbol || 'tài sản'} thành công.`);
          fetchPortfolio(false);
          fetchComposition(false);
        }
      })
      .catch((err) => {
        setEditHoldingError(err.message || 'Không thể cập nhật tài sản.');
      })
      .finally(() => {
        setEditHoldingLoading(false);
      });
  };

  // Delete holding
  const handleDeleteHolding = (id, symbol) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa ${symbol || 'tài sản này'} khỏi danh mục?`)) {
      return;
    }

    setDeletingHoldingId(id);
    setHoldingsError(null);
    setHoldingsSuccess(null);

    fetch(`/api/holdings/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((json) => {
            throw new Error(json.message || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok') {
          setHoldings((prev) => prev.filter((h) => h.id !== id));
          setHoldingsSuccess(`Đã xóa ${symbol || 'tài sản'} khỏi danh mục.`);
          fetchPortfolio(false);
          fetchComposition(false);
        }
      })
      .catch((err) => {
        setHoldingsError(err.message || 'Không thể xóa tài sản khỏi danh mục.');
      })
      .finally(() => {
        setDeletingHoldingId(null);
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

  // Fetch portfolio & composition on initial mount
  useEffect(() => {
    fetchPortfolio(true);
    fetchComposition(true);
  }, [fetchPortfolio, fetchComposition]);

  // Periodic 5-minute auto-refresh when on portfolio tab
  useEffect(() => {
    if (activeTab !== 'portfolio') return;
    fetchPortfolio(false);
    fetchComposition(false);
    const intervalId = setInterval(() => {
      fetchPortfolio(false);
      fetchComposition(false);
    }, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [activeTab, fetchPortfolio, fetchComposition]);

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
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
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

  // Fetch historical market data (Feature 06)
  const fetchHistoryData = useCallback((symbol, range = '1M') => {
    if (!symbol) return;
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.status === 'ok' && json.data) {
          if (json.data.symbol === symbol && json.data.range === range) {
            setHistoryData(json.data);
          }
        } else {
          throw new Error(json.message || 'Không thể tải dữ liệu lịch sử giá');
        }
        setHistoryLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        setHistoryError(err.message || 'Dữ liệu lịch sử giá không khả dụng');
        setHistoryLoading(false);
      });
  }, []);

  // Fetch deterministic asset analysis (Feature 07)
  const fetchAnalysisData = useCallback((symbol, isInitial = false) => {
    if (!symbol) return;
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
        if (!res.ok) {
          return res.json().catch(() => ({})).then((json) => {
            throw new Error(json.message || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.status === 'ok' && json.data) {
          if (json.data.symbol === symbol) {
            setAnalysisData(json.data);
          }
        } else {
          throw new Error(json.message || 'Không thể tải phân tích tài sản');
        }
        setAnalysisLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        setAnalysisError(err.message || 'Dữ liệu phân tích tài sản không khả dụng');
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
    if (activeAssetDetailReqRef.current) activeAssetDetailReqRef.current.abort();
    if (activeMarketReqRef.current) activeMarketReqRef.current.abort();
    if (activeHistoryReqRef.current) activeHistoryReqRef.current.abort();
    if (activeAnalysisReqRef.current) activeAnalysisReqRef.current.abort();

    const controller = new AbortController();
    activeAssetDetailReqRef.current = controller;

    setSelectedSymbol(symbol);
    setDetailLoading(true);
    setDetailError(null);
    setAssetDetail(null);
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
    if (activeAssetDetailReqRef.current) activeAssetDetailReqRef.current.abort();
    if (activeMarketReqRef.current) activeMarketReqRef.current.abort();
    if (activeHistoryReqRef.current) activeHistoryReqRef.current.abort();
    if (activeAnalysisReqRef.current) activeAnalysisReqRef.current.abort();

    setSelectedSymbol(null);
    setAssetDetail(null);
    setDetailError(null);
    setMarketData(null);
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
            onChange={(tabId) => setActiveTab(tabId)}
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
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>Độ trễ ~15p</span>
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
                                ▲ Tăng mạnh nhất
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
                                {movers.topGainer.price.toLocaleString('vi-VN')} ₫
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
                                ▼ Giảm mạnh nhất
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
                                {movers.topDecliner.price.toLocaleString('vi-VN')} ₫
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
                                  {hasPrice ? `${mkt.price.toLocaleString('vi-VN')} ₫` : 'Chưa có giá'}
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
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>Cập nhật từ CafeF</span>
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
                        Dữ liệu thị trường có độ trễ (~15p)
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
                  }}
                  disabled={portfolioRefreshing || compositionRefreshing || portfolioLoading}
                  className="fintech-btn btn-secondary btn-sm"
                >
                  <span className={portfolioRefreshing || compositionRefreshing ? 'spin-icon' : ''}>
                    {portfolioRefreshing || compositionRefreshing ? '⟳' : '↻'}
                  </span>
                  <span>{portfolioRefreshing || compositionRefreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
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

              {/* Content when loaded */}
              {!portfolioLoading && portfolioOverview && (
                <>
                  {/* Metric Summary Cards with 3D Tilt & Dynamic Radial Sheen */}
                  <motion.div variants={sectionItemVariants} className="metrics-grid">
                    {/* Metric 1: Cash Available */}
                    <TiltCard className="metric-card" style={{ '--card-accent': '#3b82f6' }}>
                      <div className="metric-header">
                        <span className="metric-label">Tiền sẵn sàng đầu tư</span>
                        <span className="metric-icon">💵</span>
                      </div>
                      <div className="metric-value">
                        <CountUp value={portfolioOverview.summary.cashAvailable} suffix=" ₫" />
                      </div>
                      <div className="metric-change" style={{ color: 'var(--color-slate-500)' }}>
                        Vốn tiền mặt chưa giải ngân
                      </div>
                    </TiltCard>

                    {/* Metric 2: Total Cost Basis */}
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
                    <div className="card-header">
                      <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                        Chi tiết tài sản nắm giữ ({portfolioOverview.holdings.length})
                      </span>
                    </div>

                    {portfolioOverview.holdings.length === 0 ? (
                      <div className="state-box" style={{ border: 'none', boxShadow: 'none' }}>
                        <div className="state-icon float-icon">💼</div>
                        <h3 className="state-title">Chưa có tài sản nào trong danh mục</h3>
                        <p className="state-desc" style={{ marginBottom: '1.25rem' }}>
                          Chuyển sang mục <strong>Hồ sơ đầu tư</strong> để thêm các tài sản bạn đang nắm giữ.
                        </p>
                        <MagneticButton
                          onClick={() => setActiveTab('profile')}
                          className="fintech-btn btn-primary btn-sm"
                        >
                          Đến Hồ sơ đầu tư &rarr;
                        </MagneticButton>
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
                              const isProfit = isPriced && h.unrealizedPnL > 0;
                              const isLoss = isPriced && h.unrealizedPnL < 0;

                              return (
                                <tr key={h.id}>
                                  {/* 1. Symbol & Name */}
                                  <td>
                                    <div style={{ fontWeight: 800, color: 'var(--color-slate-900)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span>{h.symbol || 'N/A'}</span>
                                      {h.assetType && (
                                        <span className="fintech-badge badge-neutral">
                                          {formatAssetType(h.assetType)}
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
                                    {h.averageCost.toLocaleString('vi-VN')} ₫
                                  </td>

                                  {/* 4. Latest Price */}
                                  <td style={{ textAlign: 'right' }}>
                                    {isPriced ? (
                                      <span style={{ fontWeight: 700, color: 'var(--color-slate-900)' }}>
                                        {h.latestPrice.toLocaleString('vi-VN')} ₫
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontStyle: 'italic' }}>
                                        Chưa có dữ liệu
                                      </span>
                                    )}
                                  </td>

                                  {/* 5. Market Value */}
                                  <td style={{ textAlign: 'right' }}>
                                    {isPriced && h.marketValue !== null ? (
                                      <span style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                        {h.marketValue.toLocaleString('vi-VN')} ₫
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontStyle: 'italic' }}>
                                        Chưa có dữ liệu
                                      </span>
                                    )}
                                  </td>

                                  {/* 6. Unrealized PnL & % */}
                                  <td style={{ textAlign: 'right' }}>
                                    {isPriced && h.unrealizedPnL !== null ? (
                                      <div>
                                        <div style={{
                                          fontWeight: 800,
                                          color: isProfit ? 'var(--color-gain-600)' : isLoss ? 'var(--color-loss-600)' : 'var(--color-slate-900)'
                                        }}>
                                          {isProfit ? '+' : ''}{h.unrealizedPnL.toLocaleString('vi-VN')} ₫
                                        </div>
                                        <div style={{ marginTop: '2px' }}>
                                          <span className={`fintech-badge ${isProfit ? 'badge-gain' : isLoss ? 'badge-loss' : 'badge-neutral'}`}>
                                            {h.unrealizedPnLPercent !== null && h.unrealizedPnLPercent !== undefined
                                              ? `${h.unrealizedPnLPercent > 0 ? '+' : ''}${Number(h.unrealizedPnLPercent).toFixed(2)}%`
                                              : '—'}
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)', fontStyle: 'italic' }}>
                                        Chưa có dữ liệu
                                      </span>
                                    )}
                                  </td>

                                  {/* 7. Market Updated Time */}
                                  <td style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--color-slate-500)' }}>
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
                      Dữ liệu thị trường có độ trễ (~15p)
                    </span>
                  </div>
                </div>

                {/* Refresh Button */}
                <MagneticButton
                  onClick={() => fetchWatchlist(false)}
                  disabled={watchlistRefreshing || watchlistLoading}
                  className="fintech-btn btn-secondary btn-sm"
                >
                  <span className={watchlistRefreshing ? 'spin-icon' : ''}>{watchlistRefreshing ? '⟳' : '↻'}</span>
                  <span>{watchlistRefreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
                </MagneticButton>
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
                          <th>Sàn giao dịch</th>
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

                              {/* 3. Exchange */}
                              <td style={{ color: 'var(--color-slate-500)' }}>
                                {asset.exchange || 'N/A'}
                              </td>

                              {/* 4. Latest Market Price (Failure-isolated) */}
                              <td style={{ textAlign: 'right' }}>
                                {hasPrice ? (
                                  <span style={{ fontWeight: 800, color: 'var(--color-slate-900)', fontSize: '0.95rem' }}>
                                    {mkt.price.toLocaleString('vi-VN')} {mkt.currency ? `${mkt.currency}` : '₫'}
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
                                    {isGain ? '+' : ''}{Number(mkt.change).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}
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
                                <div style={{ display: 'inline-flex', gap: '6px' }}>
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

          {/* TAB 3: NEWS FEED */}
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
                  <h2 className="section-title">Tin tức thị trường</h2>
                  <p className="section-subtitle">
                    Cập nhật tin tức tài chính, doanh nghiệp và vĩ mô mới nhất · <span style={{ color: 'var(--color-slate-400)' }}>Nguồn: CafeF</span>
                  </p>
                </div>

                {/* Refresh Button */}
                <MagneticButton
                  onClick={() => fetchNews(false)}
                  disabled={newsRefreshing || newsLoading}
                  className="fintech-btn btn-secondary btn-sm"
                >
                  <span className={newsRefreshing ? 'spin-icon' : ''}>{newsRefreshing ? '⟳' : '↻'}</span>
                  <span>{newsRefreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
                </MagneticButton>
              </motion.div>

              {/* Additive Economic Category Pulse Rail */}
              <motion.div variants={sectionItemVariants}>
                <EconomicPulseRail />
              </motion.div>

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
                            Nguồn: CafeF
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
              {/* Detail View */}
              {selectedSymbol ? (
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
                      </div>
                      <p style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', color: 'var(--color-slate-600)', fontWeight: 600 }}>
                        {assetDetail.name}
                      </p>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.88rem' }}>
                        <div><span style={{ color: 'var(--color-slate-500)' }}>Mã tài sản:</span> <strong style={{ color: 'var(--color-slate-900)' }}>{assetDetail.symbol}</strong></div>
                        <div><span style={{ color: 'var(--color-slate-500)' }}>Loại tài sản:</span> <strong style={{ color: 'var(--color-slate-900)' }}>{formatAssetType(assetDetail.asset_type)}</strong></div>
                        <div><span style={{ color: 'var(--color-slate-500)' }}>Sàn niêm yết:</span> <strong style={{ color: 'var(--color-slate-900)' }}>{assetDetail.exchange || 'N/A'}</strong></div>
                        <div><span style={{ color: 'var(--color-slate-500)' }}>Mã định danh:</span> <span style={{ color: 'var(--color-slate-400)', fontSize: '0.78rem' }}>{assetDetail.id}</span></div>
                      </div>
                    </TiltCard>
                  )}

                  {/* Market Snapshot Card with 3D Tilt */}
                  <TiltCard className="fintech-card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>Giá thị trường</h3>
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-slate-400)' }}>Dữ liệu thị trường có độ trễ (~15 phút)</span>
                      </div>
                      <MagneticButton
                        onClick={() => fetchMarketData(selectedSymbol, false)}
                        disabled={isRefreshing || marketLoading}
                        className="fintech-btn btn-secondary btn-sm"
                      >
                        <span className={isRefreshing ? 'spin-icon' : ''}>{isRefreshing ? '⟳' : '↻'}</span>
                        <span>{isRefreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
                      </MagneticButton>
                    </div>

                    {marketLoading && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 0' }}>
                        <div className="skeleton-shimmer" style={{ width: '220px', height: '36px' }} />
                        <div className="metrics-grid" style={{ marginBottom: 0 }}>
                          {[1, 2, 3, 4].map((n) => (
                            <div key={n} className="skeleton-shimmer" style={{ height: '70px' }} />
                          ))}
                        </div>
                      </div>
                    )}

                    {marketError && (
                      <div className="fintech-banner banner-warning">
                        <span>Thông báo: Không thể tải dữ liệu giá thị trường ({marketError}).</span>
                      </div>
                    )}

                    {marketData && !marketLoading && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.85rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '2.15rem', fontWeight: 800, color: 'var(--color-slate-900)', letterSpacing: '-0.02em' }}>
                            {marketData.price !== null ? (
                              <CountUp value={marketData.price} suffix={marketData.currency ? ` ${marketData.currency}` : ''} />
                            ) : 'N/A'}
                          </span>

                          {marketData.change !== null && marketData.change !== undefined ? (
                            <span className={`fintech-badge ${(marketData.change || 0) >= 0 ? 'badge-gain' : 'badge-loss'}`} style={{ fontSize: '0.88rem', padding: '4px 12px' }}>
                              {marketData.change > 0 ? '+' : ''}
                              {Number(marketData.change).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ({marketData.changePercent > 0 ? '+' : ''}{marketData.changePercent !== null && marketData.changePercent !== undefined ? `${Number(marketData.changePercent).toFixed(2)}%` : '—'})
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
                              {marketData.dayHigh !== null ? `${marketData.dayHigh.toLocaleString('vi-VN')}${marketData.currency ? ` ${marketData.currency}` : ''}` : 'N/A'}
                            </div>
                          </div>

                          <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#64748b' }}>
                            <div className="metric-label">Thấp nhất trong ngày</div>
                            <div className="metric-value" style={{ fontSize: '1.15rem' }}>
                              {marketData.dayLow !== null ? `${marketData.dayLow.toLocaleString('vi-VN')}${marketData.currency ? ` ${marketData.currency}` : ''}` : 'N/A'}
                            </div>
                          </div>

                          <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#3b82f6' }}>
                            <div className="metric-label">Khối lượng giao dịch</div>
                            <div className="metric-value" style={{ fontSize: '1.15rem' }}>
                              {marketData.volume !== null ? marketData.volume.toLocaleString('vi-VN') : 'N/A'}
                            </div>
                          </div>

                          <div className="metric-card" style={{ padding: '0.95rem 1rem', '--card-accent': '#10b981' }}>
                            <div className="metric-label">Cập nhật lúc</div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-slate-600)' }}>
                              {formatPublishedTime(marketData.updatedAt)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </TiltCard>

                  {/* Historical Price & Trend Card (Feature 06) */}
                  <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginTop: '1.25rem' }}>
                    {/* Header: Title, delayed badge, and range selector */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-slate-900)', fontWeight: 800 }}>Lịch sử giá</h3>
                          <span className="fintech-badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                            Dữ liệu thị trường có độ trễ
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
                          <span>Không thể tải dữ liệu lịch sử giá ({historyError}).</span>
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
                    {historyData && !historyLoading && (
                      <div>
                        {/* Summary Metrics Grid */}
                        <div className="metrics-grid" style={{ marginBottom: '1.25rem' }}>
                          {/* 1. Giá đầu kỳ */}
                          <div className="metric-card" style={{ padding: '0.85rem 1rem', '--card-accent': '#64748b' }}>
                            <div className="metric-label">Giá đầu kỳ</div>
                            <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                              {historyData.metrics?.periodStartPrice !== null && historyData.metrics?.periodStartPrice !== undefined
                                ? `${historyData.metrics.periodStartPrice.toLocaleString('vi-VN')} ₫`
                                : 'N/A'}
                            </div>
                          </div>

                          {/* 2. Giá gần nhất */}
                          <div className="metric-card" style={{ padding: '0.85rem 1rem', '--card-accent': '#3b82f6' }}>
                            <div className="metric-label">Giá gần nhất</div>
                            <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                              {historyData.metrics?.latestPrice !== null && historyData.metrics?.latestPrice !== undefined
                                ? `${historyData.metrics.latestPrice.toLocaleString('vi-VN')} ₫`
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
                                ? `${historyData.metrics.absoluteChange > 0 ? '+' : ''}${Number(historyData.metrics.absoluteChange).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`
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
                                ? `${historyData.metrics.percentageChange > 0 ? '+' : ''}${Number(historyData.metrics.percentageChange).toFixed(2)}%`
                                : 'N/A'}
                            </div>
                          </div>

                          {/* 5. Cao nhất kỳ */}
                          <div className="metric-card" style={{ padding: '0.85rem 1rem', '--card-accent': '#10b981' }}>
                            <div className="metric-label">Cao nhất</div>
                            <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                              {historyData.metrics?.periodHigh !== null && historyData.metrics?.periodHigh !== undefined
                                ? `${Number(historyData.metrics.periodHigh).toLocaleString('vi-VN')} ₫`
                                : 'N/A'}
                            </div>
                          </div>

                          {/* 6. Thấp nhất kỳ */}
                          <div className="metric-card" style={{ padding: '0.85rem 1rem', '--card-accent': '#ef4444' }}>
                            <div className="metric-label">Thấp nhất</div>
                            <div className="metric-value" style={{ fontSize: '1.1rem' }}>
                              {historyData.metrics?.periodLow !== null && historyData.metrics?.periodLow !== undefined
                                ? `${Number(historyData.metrics.periodLow).toLocaleString('vi-VN')} ₫`
                                : 'N/A'}
                            </div>
                          </div>
                        </div>

                        {/* Visual Trend Chart */}
                        <PriceHistoryChart
                          bars={historyData.bars || []}
                          percentageChange={historyData.metrics?.percentageChange}
                          currency="VND"
                        />
                      </div>
                    )}
                  </TiltCard>

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
                  <motion.div variants={sectionItemVariants} className="section-header">
                    <div>
                      <h2 className="section-title">Danh sách tài sản</h2>
                      <p className="section-subtitle">
                        Danh sách tài sản đang theo dõi trong hệ thống ({assets.length} mã)
                      </p>
                    </div>
                  </motion.div>

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

                  {!loading && !error && assets.length > 0 && (
                    <motion.div variants={sectionItemVariants} className="fintech-card" style={{ overflow: 'hidden' }}>
                      <div className="table-container">
                        <table className="fintech-table">
                          <thead>
                            <tr>
                              <th>Mã</th>
                              <th>Tên tài sản</th>
                              <th>Loại tài sản</th>
                              <th>Sàn giao dịch</th>
                              <th style={{ textAlign: 'right' }}>Thao tác</th>
                            </tr>
                          </thead>
                          <tbody>
                            {assets.map((asset) => (
                              <tr
                                key={asset.id || asset.symbol}
                                className="row-interactive"
                                onClick={() => handleSelectAsset(asset.symbol)}
                              >
                                <td style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--color-brand-50)',
                                    color: 'var(--color-brand-700)',
                                    border: '1px solid var(--color-brand-200)',
                                    fontWeight: 800
                                  }}>
                                    {asset.symbol}
                                  </span>
                                </td>
                                <td style={{ color: 'var(--color-slate-800)', fontWeight: 600 }}>
                                  {asset.name}
                                </td>
                                <td>
                                  <span className="fintech-badge badge-neutral">
                                    {formatAssetType(asset.asset_type)}
                                  </span>
                                </td>
                                <td style={{ color: 'var(--color-slate-500)' }}>
                                  {asset.exchange || 'N/A'}
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
                    </motion.div>
                  )}
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
                      {/* Field 1: Available Cash */}
                      <div style={{ marginBottom: '1.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.25rem' }}>
                          Tiền sẵn sàng đầu tư
                        </label>
                        <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.82rem', color: 'var(--color-slate-500)' }}>
                          Số tiền bạn hiện có thể sử dụng để đầu tư (tính theo VNĐ).
                        </p>
                        <div className="input-suffix-group">
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
                            className="fintech-input"
                          />
                          <span className="input-suffix-badge">VNĐ</span>
                        </div>

                        {/* Live Formatted VND Preview */}
                        {!isNaN(Number(cashAvailable)) && cashAvailable !== '' && Number(cashAvailable) >= 0 && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            style={{ marginTop: '0.45rem', fontSize: '0.85rem', color: 'var(--color-brand-600)', fontWeight: 700 }}
                          >
                            ≈ <CountUp value={Number(cashAvailable)} suffix=" ₫" />
                          </motion.div>
                        )}
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
              <motion.div variants={sectionItemVariants} className="section-header">
                <div>
                  <h2 className="section-title">Danh mục hiện có</h2>
                  <p className="section-subtitle">
                    Ghi nhận các mã và tài sản bạn đang nắm giữ thực tế
                  </p>
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

              {/* Add Holding Form Card with Subtle 3D Tilt */}
              <motion.div variants={sectionItemVariants}>
                <TiltCard className="fintech-card" style={{ padding: '1.5rem', marginBottom: '1.75rem' }} tiltMax={2}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.02rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                    Thêm tài sản vào danh mục
                  </h3>

                  {addHoldingError && (
                    <div className="fintech-banner banner-error">
                      <span>{addHoldingError}</span>
                    </div>
                  )}

                  <form onSubmit={handleAddHolding}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                      {/* Select Asset */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.35rem' }}>
                          Tài sản
                        </label>
                        <select
                          value={selectedAssetId}
                          onChange={(e) => {
                            setSelectedAssetId(e.target.value);
                            setAddHoldingError(null);
                          }}
                          required
                          className="fintech-select"
                        >
                          <option value="">-- Chọn tài sản --</option>
                          {assets.map((asset) => {
                            const alreadyHeld = holdings.some((h) => h.asset_id === asset.id);
                            return (
                              <option key={asset.id} value={asset.id} disabled={alreadyHeld}>
                                {asset.symbol} - {asset.name} ({formatAssetType(asset.asset_type)}) {alreadyHeld ? '(Đã có)' : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* Quantity */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.35rem' }}>
                          Số lượng
                        </label>
                        <input
                          type="number"
                          min="0.0001"
                          step="any"
                          placeholder="Ví dụ: 1000"
                          value={newQuantity}
                          onChange={(e) => {
                            setNewQuantity(e.target.value);
                            setAddHoldingError(null);
                          }}
                          required
                          className="fintech-input"
                        />
                      </div>

                      {/* Average Purchase Price */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-slate-700)', marginBottom: '0.35rem' }}>
                          Giá mua trung bình (VNĐ)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          placeholder="Ví dụ: 58000"
                          value={newAverageCost}
                          onChange={(e) => {
                            setNewAverageCost(e.target.value);
                            setAddHoldingError(null);
                          }}
                          required
                          className="fintech-input"
                        />
                      </div>
                    </div>

                    {/* Calculation preview and submit button */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <div>
                        {Number(newQuantity) > 0 && Number(newAverageCost) >= 0 && (
                          <span style={{ fontSize: '0.88rem', color: 'var(--color-brand-600)', fontWeight: 700 }}>
                            Tổng vốn dự kiến: {(Number(newQuantity) * Number(newAverageCost)).toLocaleString('vi-VN')} ₫
                          </span>
                        )}
                      </div>

                      <MagneticButton
                        type="submit"
                        disabled={addHoldingLoading}
                        className="fintech-btn btn-primary"
                      >
                        <span className={addHoldingLoading ? 'spin-icon' : ''}>{addHoldingLoading ? '⟳' : '+'}</span>
                        <span>{addHoldingLoading ? 'Đang thêm...' : 'Thêm vào danh mục'}</span>
                      </MagneticButton>
                    </div>
                  </form>
                </TiltCard>
              </motion.div>

              {/* Holdings Table */}
              <motion.div variants={sectionItemVariants} className="fintech-card" style={{ overflow: 'hidden' }}>
                <div className="card-header">
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>
                    Danh sách tài sản đang nắm giữ ({holdings.length})
                  </span>
                  <MagneticButton
                    onClick={() => fetchHoldings(false)}
                    disabled={holdingsLoading}
                    className="fintech-btn btn-secondary btn-sm"
                  >
                    <span className={holdingsLoading ? 'spin-icon' : ''}>{holdingsLoading ? '⟳' : '↻'}</span>
                    <span>{holdingsLoading ? 'Đang tải...' : 'Làm mới'}</span>
                  </MagneticButton>
                </div>

                {editHoldingError && (
                  <div className="fintech-banner banner-error" style={{ margin: '0.75rem 1rem' }}>
                    <span>{editHoldingError}</span>
                  </div>
                )}

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
                    <p className="state-desc">
                      Sử dụng biểu mẫu phía trên để ghi nhận các khoản đầu tư bạn đang sở hữu.
                    </p>
                  </div>
                )}

                {holdings.length > 0 && (
                  <div className="table-container">
                    <table className="fintech-table">
                      <thead>
                        <tr>
                          <th>Tài sản</th>
                          <th style={{ textAlign: 'right' }}>Số lượng</th>
                          <th style={{ textAlign: 'right' }}>Giá mua TB</th>
                          <th style={{ textAlign: 'right' }}>Tổng giá trị vốn</th>
                          <th style={{ textAlign: 'right' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map((h) => {
                          const isEditing = editingHoldingId === h.id;
                          const asset = h.asset || {};
                          const totalCost = Number(h.quantity) * Number(h.average_cost);

                          return (
                            <tr key={h.id} className={isEditing ? 'row-editing' : ''}>
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

                              {/* Column 2: Quantity */}
                              <td style={{ textAlign: 'right' }}>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min="0.0001"
                                    step="any"
                                    value={editQuantity}
                                    onChange={(e) => setEditQuantity(e.target.value)}
                                    className="fintech-input"
                                    style={{ width: '100px', padding: '4px 8px', fontSize: '0.85rem' }}
                                  />
                                ) : (
                                  <span style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                    {Number(h.quantity).toLocaleString('vi-VN')}
                                  </span>
                                )}
                              </td>

                              {/* Column 3: Average Cost */}
                              <td style={{ textAlign: 'right' }}>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min="0"
                                    step="100"
                                    value={editAverageCost}
                                    onChange={(e) => setEditAverageCost(e.target.value)}
                                    className="fintech-input"
                                    style={{ width: '120px', padding: '4px 8px', fontSize: '0.85rem' }}
                                  />
                                ) : (
                                  <span style={{ color: 'var(--color-slate-700)', fontWeight: 600 }}>
                                    {Number(h.average_cost).toLocaleString('vi-VN')} ₫
                                  </span>
                                )}
                              </td>

                              {/* Column 4: Total Cost Basis */}
                              <td style={{ textAlign: 'right' }}>
                                {isEditing ? (
                                  <span style={{ fontSize: '0.84rem', color: 'var(--color-brand-600)', fontWeight: 700 }}>
                                    {Number(editQuantity) > 0 && Number(editAverageCost) >= 0
                                      ? `${(Number(editQuantity) * Number(editAverageCost)).toLocaleString('vi-VN')} ₫`
                                      : '---'}
                                  </span>
                                ) : (
                                  <span style={{ fontWeight: 800, color: 'var(--color-slate-900)' }}>
                                    {totalCost.toLocaleString('vi-VN')} ₫
                                  </span>
                                )}
                              </td>

                              {/* Column 5: Actions */}
                              <td style={{ textAlign: 'right' }}>
                                {isEditing ? (
                                  <div style={{ display: 'inline-flex', gap: '6px' }}>
                                    <MagneticButton
                                      onClick={() => handleSaveEditHolding(h.id)}
                                      disabled={editHoldingLoading}
                                      className="fintech-btn btn-primary btn-sm"
                                    >
                                      {editHoldingLoading ? '...' : 'Lưu'}
                                    </MagneticButton>
                                    <MagneticButton
                                      onClick={handleCancelEdit}
                                      disabled={editHoldingLoading}
                                      className="fintech-btn btn-secondary btn-sm"
                                    >
                                      Hủy
                                    </MagneticButton>
                                  </div>
                                ) : (
                                  <div style={{ display: 'inline-flex', gap: '6px' }}>
                                    <MagneticButton
                                      onClick={() => handleStartEditHolding(h)}
                                      className="fintech-btn btn-secondary btn-sm"
                                    >
                                      Chỉnh sửa
                                    </MagneticButton>
                                    <MagneticButton
                                      onClick={() => handleDeleteHolding(h.id, asset.symbol)}
                                      disabled={deletingHoldingId === h.id}
                                      className="fintech-btn btn-danger btn-sm"
                                    >
                                      {deletingHoldingId === h.id ? '...' : 'Xóa'}
                                    </MagneticButton>
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
      </main>
    </div>
  );
}

export default App;
