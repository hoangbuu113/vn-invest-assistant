import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { checkSupabaseConnection, getAssets } from './src/supabase.js';

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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
