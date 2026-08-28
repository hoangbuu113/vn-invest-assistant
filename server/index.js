import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  checkSupabaseConnection,
  getAssets,
  getAssetBySymbol,
  getInvestorProfile,
  updateInvestorProfile,
  getHoldings,
  addHolding,
  updateHolding,
  deleteHolding,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getAlerts,
  createAlert,
  deleteAlert,
  reactivateAlert,
  evaluateAndPersistAlerts
} from './src/supabase.js';
import { getMarketSnapshot, getMarketHistory, getAnalysisHistory } from './src/market.js';
import { getNewsFeed, getPersonalizedNewsFeed } from './src/news.js';
import { getPortfolioOverview } from './src/portfolio.js';
import { getPortfolioComposition } from './src/composition.js';
import { getAssetAnalysis } from './src/analysis.js';

dotenv.config();

const PORT = process.env.PORT || 5000;

export const ALLOWED_RISK_TOLERANCE = ['low', 'moderate', 'high'];
export const ALLOWED_INVESTMENT_HORIZON = ['short', 'medium', 'long'];

/**
 * Strict validator for financial numbers (no string or boolean coercion).
 */
export function isValidFinancialNumber(val, { allowZero = false } = {}) {
  return typeof val === 'number' && Number.isFinite(val) && (allowZero ? val >= 0 : val > 0);
}

export function createApp(services = {}) {
  const {
    getInvestorProfileFn = getInvestorProfile,
    updateInvestorProfileFn = updateInvestorProfile,
    getHoldingsFn = getHoldings,
    addHoldingFn = addHolding,
    updateHoldingFn = updateHolding,
    deleteHoldingFn = deleteHolding,
    getAssetsFn = getAssets,
    getAssetBySymbolFn = getAssetBySymbol,
    getMarketSnapshotFn = getMarketSnapshot,
    getMarketHistoryFn = getMarketHistory,
    getNewsFeedFn = getNewsFeed,
    getPersonalizedNewsFeedFn = getPersonalizedNewsFeed,
    getPortfolioOverviewFn = getPortfolioOverview,
    getPortfolioCompositionFn = getPortfolioComposition,
    checkSupabaseConnectionFn = checkSupabaseConnection,
    getAnalysisHistoryFn = getAnalysisHistory,
    getAssetAnalysisFn = getAssetAnalysis,
    getWatchlistFn = getWatchlist,
    addToWatchlistFn = addToWatchlist,
    removeFromWatchlistFn = removeFromWatchlist,
    getAlertsFn = getAlerts,
    createAlertFn = createAlert,
    deleteAlertFn = deleteAlert,
    reactivateAlertFn = reactivateAlert,
    evaluateAndPersistAlertsFn = evaluateAndPersistAlerts
  } = services;

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Basic system health endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      message: 'VN Invest Assistant API is running'
    });
  });

  // Database connectivity check endpoint
  app.get('/api/db-health', async (req, res) => {
    const result = await checkSupabaseConnectionFn();

    if (result.connected) {
      return res.json({
        status: 'ok',
        message: result.message || 'Connected to Supabase successfully'
      });
    }

    return res.status(503).json({
      status: 'error',
      message: 'Database connection check failed',
      details: result.error
    });
  });

  // Investor profile endpoints
  app.get('/api/profile', async (req, res) => {
    try {
      const profile = await getInvestorProfileFn();
      return res.json({
        status: 'ok',
        data: profile
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch investor profile',
        details: error.message
      });
    }
  });

  app.put('/api/profile', async (req, res) => {
    try {
      const { cash_available, risk_tolerance, investment_horizon } = req.body || {};

      const errors = [];

      // Strict validation for cash_available (no string/boolean coercion)
      if (!isValidFinancialNumber(cash_available, { allowZero: true })) {
        errors.push('cash_available must be a non-negative finite number');
      }

      // Strict validation for risk_tolerance
      if (
        typeof risk_tolerance !== 'string' ||
        !ALLOWED_RISK_TOLERANCE.includes(risk_tolerance.trim().toLowerCase())
      ) {
        errors.push("risk_tolerance must be one of: 'low', 'moderate', 'high'");
      }

      // Strict validation for investment_horizon
      if (
        typeof investment_horizon !== 'string' ||
        !ALLOWED_INVESTMENT_HORIZON.includes(investment_horizon.trim().toLowerCase())
      ) {
        errors.push("investment_horizon must be one of: 'short', 'medium', 'long'");
      }

      if (errors.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid profile data',
          errors
        });
      }

      const updated = await updateInvestorProfileFn({
        cash_available,
        risk_tolerance: risk_tolerance.trim().toLowerCase(),
        investment_horizon: investment_horizon.trim().toLowerCase()
      });

      return res.json({
        status: 'ok',
        data: updated
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to update investor profile',
        details: error.message
      });
    }
  });

  // Holdings endpoints
  app.get('/api/holdings', async (req, res) => {
    try {
      const holdings = await getHoldingsFn();
      return res.json({
        status: 'ok',
        count: holdings.length,
        data: holdings
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch holdings',
        details: error.message
      });
    }
  });

  app.post('/api/holdings', async (req, res) => {
    try {
      const { asset_id, quantity, average_cost } = req.body || {};
      const errors = [];

      if (!asset_id || typeof asset_id !== 'string' || asset_id.trim() === '') {
        errors.push('asset_id is required and must be a non-empty string');
      }

      if (!isValidFinancialNumber(quantity, { allowZero: false })) {
        errors.push('quantity must be a finite number greater than 0');
      }

      if (!isValidFinancialNumber(average_cost, { allowZero: true })) {
        errors.push('average_cost must be a non-negative finite number');
      }

      if (errors.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid holding data',
          errors
        });
      }

      const newHolding = await addHoldingFn({
        asset_id: asset_id.trim(),
        quantity,
        average_cost
      });

      return res.status(201).json({
        status: 'ok',
        data: newHolding
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to add holding',
        details: error.message
      });
    }
  });

  app.put('/api/holdings/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const { quantity, average_cost } = req.body || {};
      const errors = [];

      if (!id || typeof id !== 'string' || id.trim() === '') {
        errors.push('Valid holding ID is required');
      }

      if (!isValidFinancialNumber(quantity, { allowZero: false })) {
        errors.push('quantity must be a finite number greater than 0');
      }

      if (!isValidFinancialNumber(average_cost, { allowZero: true })) {
        errors.push('average_cost must be a non-negative finite number');
      }

      if (errors.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid holding update data',
          errors
        });
      }

      const updated = await updateHoldingFn(id.trim(), {
        quantity,
        average_cost
      });

      return res.json({
        status: 'ok',
        data: updated
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to update holding',
        details: error.message
      });
    }
  });

  app.delete('/api/holdings/:id', async (req, res) => {
    const { id } = req.params;
    try {
      if (!id || typeof id !== 'string' || id.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid holding ID is required'
        });
      }

      const result = await deleteHoldingFn(id.trim());
      return res.json({
        status: 'ok',
        message: 'Holding deleted successfully',
        data: result
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to delete holding',
        details: error.message
      });
    }
  });

  // Assets list endpoint
  app.get('/api/assets', async (req, res) => {
    try {
      const assets = await getAssetsFn();
      return res.json({
        status: 'ok',
        count: assets.length,
        data: assets
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch assets from database',
        details: error.message
      });
    }
  });

  // Single asset detail endpoint
  app.get('/api/assets/:symbol', async (req, res) => {
    const { symbol } = req.params;
    try {
      const asset = await getAssetBySymbolFn(symbol);
      if (!asset) {
        return res.status(404).json({
          status: 'error',
          message: `Asset with symbol '${symbol}' not found`
        });
      }
      return res.json({
        status: 'ok',
        data: asset
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch asset from database',
        details: error.message
      });
    }
  });

  // Market snapshot endpoint (delayed data from Yahoo Finance)
  app.get('/api/market/:symbol', async (req, res) => {
    const { symbol } = req.params;
    try {
      const snapshot = await getMarketSnapshotFn(symbol);
      return res.json({
        status: 'ok',
        data: snapshot
      });
    } catch (error) {
      const statusCode = error.status || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to fetch market snapshot'
      });
    }
  });

  // Historical market data endpoint (daily bars & period metrics from Yahoo Finance)
  app.get('/api/market/:symbol/history', async (req, res) => {
    const { symbol } = req.params;
    const { range = '1M' } = req.query;
    try {
      const history = await getMarketHistoryFn(symbol, range);
      return res.json({
        status: 'ok',
        data: history
      });
    } catch (error) {
      const statusCode = error.status || 500;
      const response = {
        status: 'error',
        message: error.message || 'Failed to fetch market history'
      };
      if (error.warnings && Array.isArray(error.warnings) && error.warnings.length > 0) {
        response.warnings = error.warnings;
      }
      return res.status(statusCode).json(response);
    }
  });

  // News feed endpoint (aggregated & normalized from CafeF RSS)
  app.get('/api/news', async (req, res) => {
    try {
      const news = await getNewsFeedFn();
      return res.json({
        status: 'ok',
        count: news.length,
        data: news
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch news feed',
        details: error.message
      });
    }
  });

  // Personalized news feed endpoint (Feature 13 — deterministic relevance to user holdings and watchlist)
  app.get('/api/news/personalized', async (req, res) => {
    try {
      const result = await getPersonalizedNewsFeedFn({
        getNewsFeedFn,
        getHoldingsFn,
        getWatchlistFn
      });
      return res.json({
        status: 'ok',
        count: result.news.length,
        data: result.news,
        userAssetCount: result.userAssetCount,
        userAssets: result.userAssets
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch personalized news feed',
        details: error.message
      });
    }
  });

  // Portfolio overview endpoint (combines profile, holdings, and delayed market prices)
  app.get('/api/portfolio/overview', async (req, res) => {
    try {
      const overview = await getPortfolioOverviewFn();
      return res.json({
        status: 'ok',
        data: overview
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to generate portfolio overview',
        details: error.message
      });
    }
  });

  // Portfolio composition endpoint (derived exclusively from portfolio overview valuation)
  app.get('/api/portfolio/composition', async (req, res) => {
    try {
      const composition = await getPortfolioCompositionFn({ getPortfolioOverviewFn });
      return res.json({
        status: 'ok',
        data: composition
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to generate portfolio composition',
        details: error.message
      });
    }
  });

  // Deterministic asset analysis endpoint
  app.get('/api/analysis/:symbol', async (req, res) => {
    const { symbol } = req.params;
    try {
      const analysis = await getAssetAnalysisFn(symbol, {
        getAnalysisHistoryFn,
        getMarketSnapshotFn
      });
      return res.json({
        status: 'ok',
        data: analysis
      });
    } catch (error) {
      const statusCode = error.status || 500;
      const response = {
        status: 'error',
        message: error.message || 'Failed to generate asset analysis'
      };
      if (error.warnings && Array.isArray(error.warnings) && error.warnings.length > 0) {
        response.warnings = error.warnings;
      }
      return res.status(statusCode).json(response);
    }
  });

  // Watchlist endpoints (Feature 08)
  app.get('/api/watchlist', async (req, res) => {
    try {
      const items = await getWatchlistFn();
      return res.json({
        status: 'ok',
        count: items.length,
        data: items
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch watchlist',
        details: error.message
      });
    }
  });

  app.post('/api/watchlist', async (req, res) => {
    try {
      const { asset_id, symbol } = req.body || {};
      const errors = [];

      if (
        (!asset_id || typeof asset_id !== 'string' || asset_id.trim() === '') &&
        (!symbol || typeof symbol !== 'string' || symbol.trim() === '')
      ) {
        errors.push('Either asset_id or symbol is required and must be a non-empty string');
      }

      if (errors.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid watchlist payload',
          errors
        });
      }

      const item = await addToWatchlistFn({
        asset_id: typeof asset_id === 'string' ? asset_id.trim() : undefined,
        symbol: typeof symbol === 'string' ? symbol.trim() : undefined
      });

      return res.status(201).json({
        status: 'ok',
        data: item
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to add to watchlist',
        details: error.message
      });
    }
  });

  app.delete('/api/watchlist/:assetId', async (req, res) => {
    const { assetId } = req.params;
    try {
      if (!assetId || typeof assetId !== 'string' || assetId.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid asset ID or symbol is required'
        });
      }

      const result = await removeFromWatchlistFn(assetId.trim());
      return res.json({
        status: 'ok',
        message: 'Asset removed from watchlist',
        data: result
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to remove from watchlist',
        details: error.message
      });
    }
  });

  // Price Alerts endpoints (Feature 12)
  app.get('/api/alerts', async (req, res) => {
    try {
      const alerts = await getAlertsFn();
      return res.json({
        status: 'ok',
        count: alerts.length,
        data: alerts
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch price alerts',
        details: error.message
      });
    }
  });

  app.post('/api/alerts', async (req, res) => {
    try {
      const { asset_id, symbol, direction, target_price } = req.body || {};
      const errors = [];

      if (
        (!asset_id || typeof asset_id !== 'string' || asset_id.trim() === '') &&
        (!symbol || typeof symbol !== 'string' || symbol.trim() === '')
      ) {
        errors.push('Either asset_id or symbol is required and must be a non-empty string');
      }

      if (typeof direction !== 'string' || !['above', 'below'].includes(direction.trim().toLowerCase())) {
        errors.push("direction must be 'above' or 'below'");
      }

      if (!isValidFinancialNumber(target_price, { allowZero: false })) {
        errors.push('target_price must be a positive finite number');
      }

      if (errors.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid price alert payload',
          errors
        });
      }

      const alert = await createAlertFn({
        asset_id: typeof asset_id === 'string' ? asset_id.trim() : undefined,
        symbol: typeof symbol === 'string' ? symbol.trim() : undefined,
        direction: direction.trim().toLowerCase(),
        target_price
      });

      return res.status(201).json({
        status: 'ok',
        data: alert
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to create price alert',
        details: error.message
      });
    }
  });

  app.delete('/api/alerts/:id', async (req, res) => {
    const { id } = req.params;
    try {
      if (!id || typeof id !== 'string' || id.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid alert ID is required'
        });
      }

      const result = await deleteAlertFn(id.trim());
      return res.json({
        status: 'ok',
        message: 'Price alert deleted',
        data: result
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to delete price alert',
        details: error.message
      });
    }
  });

  app.post('/api/alerts/evaluate', async (req, res) => {
    try {
      const summary = await evaluateAndPersistAlertsFn({
        getMarketSnapshotFn
      });
      return res.json({
        status: 'ok',
        data: summary
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to evaluate price alerts',
        details: error.message
      });
    }
  });

  app.post('/api/alerts/:id/reactivate', async (req, res) => {
    const { id } = req.params;
    try {
      if (!id || typeof id !== 'string' || id.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid alert ID is required'
        });
      }

      const alert = await reactivateAlertFn(id.trim());
      return res.json({
        status: 'ok',
        message: 'Price alert reactivated',
        data: alert
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Failed to reactivate price alert',
        details: error.message
      });
    }
  });

  return app;
}

const app = createApp();

import { fileURLToPath } from 'node:url';

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

export { app };
