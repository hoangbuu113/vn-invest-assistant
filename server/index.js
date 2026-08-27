import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { checkSupabaseConnection, getAssets, getAssetBySymbol, getInvestorProfile, updateInvestorProfile } from './src/supabase.js';
import { getMarketSnapshot } from './src/market.js';
import { getNewsFeed } from './src/news.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const ALLOWED_RISK_TOLERANCE = ['low', 'moderate', 'high'];
const ALLOWED_INVESTMENT_HORIZON = ['short', 'medium', 'long'];

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
  const result = await checkSupabaseConnection();

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
    const profile = await getInvestorProfile();
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

    // Validate cash_available
    const numericCash = Number(cash_available);
    if (
      cash_available === undefined ||
      cash_available === null ||
      cash_available === '' ||
      isNaN(numericCash) ||
      !isFinite(numericCash) ||
      numericCash < 0
    ) {
      errors.push('cash_available must be a non-negative number');
    }

    // Validate risk_tolerance
    if (
      !risk_tolerance ||
      typeof risk_tolerance !== 'string' ||
      !ALLOWED_RISK_TOLERANCE.includes(risk_tolerance.toLowerCase().trim())
    ) {
      errors.push("risk_tolerance must be one of: 'low', 'moderate', 'high'");
    }

    // Validate investment_horizon
    if (
      !investment_horizon ||
      typeof investment_horizon !== 'string' ||
      !ALLOWED_INVESTMENT_HORIZON.includes(investment_horizon.toLowerCase().trim())
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

    const updated = await updateInvestorProfile({
      cash_available: numericCash,
      risk_tolerance: risk_tolerance.toLowerCase().trim(),
      investment_horizon: investment_horizon.toLowerCase().trim()
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

// Assets list endpoint
app.get('/api/assets', async (req, res) => {
  try {
    const assets = await getAssets();
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
    const asset = await getAssetBySymbol(symbol);
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
    const snapshot = await getMarketSnapshot(symbol);
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

// News feed endpoint (aggregated & normalized from CafeF RSS)
app.get('/api/news', async (req, res) => {
  try {
    const news = await getNewsFeed();
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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
