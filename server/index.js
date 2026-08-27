import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { checkSupabaseConnection, getAssets, getAssetBySymbol } from './src/supabase.js';
import { getMarketSnapshot } from './src/market.js';
import { getNewsFeed } from './src/news.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

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
