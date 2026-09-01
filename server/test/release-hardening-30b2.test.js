import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculatePortfolioValuation } from '../src/portfolio.js';
import { getTwelveDataFxRate } from '../src/providers/twelvedata.js';
import { getSnapshot as getAlphaVantageSnapshot } from '../src/providers/alphavantage.js';
import { createApp } from '../index.js';
import { ownerFetch, TEST_OWNER_ACCESS_TOKEN } from './helpers/owner-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

process.env.OWNER_ACCESS_TOKEN = TEST_OWNER_ACCESS_TOKEN;

describe('Feature 30B2 — Release Cleanup & Error Hardening', () => {

  describe('1. Error Sanitization', () => {
    test('Twelve Data error payloads return sanitized code without leaking raw upstream strings', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          status: 'error',
          code: 401,
          message: 'api_key=secret_12345 is invalid at https://api.twelvedata.com/internal'
        })
      });

      const res = await getTwelveDataFxRate('USD', 'VND', {
        apiKey: 'secret_12345',
        fetchFn: mockFetch
      });

      assert.equal(res.availability, 'unavailable');
      assert.equal(res.reason, 'FX_PROVIDER_ERROR');
      assert.equal(JSON.stringify(res).includes('secret_12345'), false, 'Never leak raw upstream error with secrets');
      assert.equal(JSON.stringify(res).includes('https://api.twelvedata.com'), false, 'Never leak upstream URLs');
    });

    test('Alpha Vantage errors return sanitized messages and status codes without leaking stack or URLs', async () => {
      const mockFetch = async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:443 https://www.alphavantage.co/query?apikey=topsecret');
      };

      await assert.rejects(
        async () => {
          await getAlphaVantageSnapshot({ symbol: 'GOLD' }, { providerSymbol: 'XAU' }, {
            apiKey: 'topsecret',
            fetchFn: mockFetch
          });
        },
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.equal(err.message, 'Error fetching Alpha Vantage market data');
          assert.equal(err.message.includes('topsecret'), false);
          assert.equal(err.message.includes('ECONNREFUSED'), false);
          return true;
        }
      );
    });

    test('Express route errors do not return raw details or stack traces to clients', async () => {
      const app = createApp({
        getInvestorProfileFn: async () => {
          throw new Error('PostgreSQL syntax error at column x in table sensitive_schema');
        }
      });

      const server = app.listen(0);
      const port = server.address().port;

      try {
        const response = await ownerFetch(`http://127.0.0.1:${port}/api/profile`);
        const body = await response.json();

        assert.equal(response.status, 500);
        assert.equal(body.status, 'error');
        assert.equal(body.message, 'Failed to fetch investor profile');
        assert.equal(body.details, undefined, 'Raw error details must never be exposed');
        assert.equal(JSON.stringify(body).includes('sensitive_schema'), false);
      } finally {
        server.close();
      }
    });
  });

  describe('2. Numeric Safety in Portfolio Normalization', () => {
    test('Malformed holding quantity (NaN, string, negative) is handled explicitly without silent zero coercion', () => {
      const holdings = [
        {
          id: 'h1',
          asset_id: 'a1',
          quantity: NaN,
          average_cost: 100000,
          asset: { symbol: 'FPT', quote_currency: 'VND' }
        },
        {
          id: 'h2',
          asset_id: 'a2',
          quantity: 'invalid_qty',
          average_cost: 50000,
          asset: { symbol: 'VCB', quote_currency: 'VND' }
        },
        {
          id: 'h3',
          asset_id: 'a3',
          quantity: -10,
          average_cost: 50000,
          asset: { symbol: 'HPG', quote_currency: 'VND' }
        }
      ];

      const result = calculatePortfolioValuation(
        { cash_available: 500000 },
        holdings,
        {
          FPT: { price: 120000, priceAsOf: '2026-08-30T10:00:00Z' },
          VCB: { price: 90000, priceAsOf: '2026-08-30T10:00:00Z' },
          HPG: { price: 25000, priceAsOf: '2026-08-30T10:00:00Z' }
        }
      );

      for (const item of result.holdings) {
        assert.equal(item.quantity, null, 'Malformed quantity must normalize to null');
        assert.equal(item.valuationStatus, 'unavailable');
        assert.equal(item.valuationReason, 'MALFORMED_HOLDING_QUANTITY');
        assert.equal(item.marketValue, null);
        assert.equal(item.costBasis, null);
      }
    });

    test('Malformed average cost is marked MALFORMED_HOLDING_COST without breaking market value calculation', () => {
      const holdings = [
        {
          id: 'h1',
          asset_id: 'a1',
          quantity: 100,
          average_cost: NaN,
          asset: { symbol: 'FPT', quote_currency: 'VND' }
        }
      ];

      const result = calculatePortfolioValuation(
        { cash_available: 500000 },
        holdings,
        { FPT: { price: 120000, priceAsOf: '2026-08-30T10:00:00Z' } }
      );

      const item = result.holdings[0];
      assert.equal(item.averageCost, null);
      assert.equal(item.costBasis, null);
      assert.equal(item.valuationStatus, 'available');
      assert.equal(item.marketValue, 12000000);
      assert.equal(item.pnlStatus, 'unavailable');
      assert.equal(item.pnlReason, 'MALFORMED_HOLDING_COST');
    });

    test('Legitimate zero cash and positive numbers are preserved faithfully', () => {
      const holdings = [
        {
          id: 'h1',
          asset_id: 'a1',
          quantity: 50,
          average_cost: 0,
          asset: { symbol: 'FPT', quote_currency: 'VND' }
        }
      ];

      const result = calculatePortfolioValuation(
        { cash_available: 0 },
        holdings,
        { FPT: { price: 100000, priceAsOf: '2026-08-30T10:00:00Z' } }
      );

      assert.equal(result.summary.cashAvailable, 0);
      assert.equal(result.summary.totalMarketValue, 5000000);
      assert.equal(result.summary.totalPortfolioValue, 5000000);
      assert.equal(result.holdings[0].averageCost, 0);
      assert.equal(result.holdings[0].costBasis, 0);
      assert.equal(result.holdings[0].unrealizedPnL, 5000000);
    });
  });

  describe('3. Environment Contract & Config Hygiene', () => {
    test('.env.example contains placeholder names only and documents all required variables', () => {
      const exampleContent = readFileSync(resolve(__dirname, '../.env.example'), 'utf8');

      const requiredKeys = [
        'PORT',
        'NODE_ENV',
        'CORS_ORIGINS',
        'SUPABASE_URL',
        'SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_SECRET_KEY',
        'OWNER_ACCESS_TOKEN',
        'TWELVE_DATA_API_KEY',
        'ALPHA_VANTAGE_API_KEY',
        'AI_BRIEF_ENABLED'
      ];

      for (const key of requiredKeys) {
        assert.ok(exampleContent.includes(key), `Missing key ${key} in server/.env.example`);
      }

      assert.equal(exampleContent.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
      assert.equal(exampleContent.includes('supabase.co/rest/v1'), false);
    });
  });

  describe('4. Obsolete / Superseded Path Invariants', () => {
    test('ChatGPT Sites plugin is removed from client package and config', () => {
      const clientPkg = JSON.parse(readFileSync(resolve(__dirname, '../../client/package.json'), 'utf8'));
      assert.equal(clientPkg.devDependencies['@openai/sites-vite-plugin'], undefined);

      const viteConfig = readFileSync(resolve(__dirname, '../../client/vite.config.js'), 'utf8');
      assert.equal(viteConfig.includes('@openai/sites-vite-plugin'), false);
      assert.equal(viteConfig.includes('sites()'), false);
    });

    test('render.yaml contains only Cloudflare Workers Static Assets in CORS_ORIGINS', () => {
      const renderYaml = readFileSync(resolve(__dirname, '../../render.yaml'), 'utf8');
      assert.equal(renderYaml.includes('chatgpt.site'), false);
      assert.ok(renderYaml.includes('https://vn-invest-assistant.vn-invest-assistant.workers.dev'));
    });
  });
});
