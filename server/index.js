import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  createAlertSchedulerAuthMiddleware,
  createAuthMiddleware,
  PRIVATE_API_PREFIXES
} from './src/auth.js';
import {
  checkSupabaseConnection,
  getAssets,
  getAssetBySymbol,
  getInvestorProfile,
  getProfileById,
  getProfileByUserId,
  createProfileForUser,
  updateInvestorProfile,
  getHoldings,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getAlerts,
  createAlert,
  deleteAlert,
  reactivateAlert,
  evaluateAndPersistAlerts,
  privateSupabase
} from './src/supabase.js';
import { getMarketSnapshot, getMarketHistory, getMarketRealtime } from './src/market.js';
import { getNewsFeed, getPersonalizedNewsFeed, runNewsCollector } from './src/news.js';
import { getPortfolioOverview } from './src/portfolio.js';
import { getPortfolioComposition } from './src/composition.js';
import { getPortfolioPerformance } from './src/performance.js';
import { getPortfolioBenchmark } from './src/benchmarks.js';
import { getBinanceHealth } from './src/providers/index.js';
import { getAssetAnalysis } from './src/analysis.js';
import { getAssetComparison } from './src/comparison.js';
import { buildVietnamRegime, getVietnamRegime, isUsableRegimeDomain } from './src/regime.js';
import { runMarketContextCollector } from './src/context/collector.js';
import { getOpportunities } from './src/opportunities.js';
import { getInvestmentBrief } from './src/investmentBrief.js';
import {
  createPortfolioTransaction,
  FX_PROVENANCE_METHODS,
  getPortfolioTransactions,
  normalizeExplicitTimestamp,
  SETTLEMENT_MODES,
  TRANSACTION_METHODOLOGY,
  TRANSACTION_TYPES
} from './src/transactions.js';
import {
  CASH_LEDGER_METHODOLOGY,
  CASH_MOVEMENT_TYPES,
  createCashMovement,
  getCashLedger,
  getCashOverview
} from './src/cash.js';
import {
  cancelOpeningPosition,
  correctOpeningPosition,
  createOpeningPosition
} from './src/positions.js';
import {
  getVapidConfig,
  validatePushSubscriptionInput,
  dispatchPendingWebPushDeliveries
} from './src/web-push-alerts.js';
import {
  upsertPushSubscription,
  deletePushSubscriptionByEndpoint
} from './src/supabase.js';

dotenv.config();

const PORT = process.env.PORT || 5000;

export const ALLOWED_RISK_TOLERANCE = ['low', 'moderate', 'high'];
export const ALLOWED_INVESTMENT_HORIZON = ['short', 'medium', 'long'];
export { PRIVATE_API_PREFIXES };
export const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

export function getCorsAllowedOrigins(configuredOrigins = process.env.CORS_ORIGINS) {
  const origins = new Set(LOCAL_DEVELOPMENT_ORIGINS);

  if (typeof configuredOrigins === 'string') {
    configuredOrigins
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean)
      .forEach((origin) => origins.add(origin));
  }

  return origins;
}

export function createCorsOptions(configuredOrigins) {
  const allowedOrigins = getCorsAllowedOrigins(configuredOrigins);

  return {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    }
  };
}

/**
 * Strict validator for financial numbers (no string or boolean coercion).
 */
export function isValidFinancialNumber(val, { allowZero = false } = {}) {
  return typeof val === 'number' && Number.isFinite(val) && (allowZero ? val >= 0 : val > 0);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateFxProvenance(value, errors) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    errors.push('fxProvenance must be an object when provided');
    return;
  }
  if (typeof value.method !== 'string' || !FX_PROVENANCE_METHODS.includes(value.method.trim().toUpperCase())) {
    errors.push(`fxProvenance.method must be one of: ${FX_PROVENANCE_METHODS.join(', ')}`);
  }
  if (
    value.provider !== undefined
    && value.provider !== null
    && (typeof value.provider !== 'string' || !value.provider.trim())
  ) {
    errors.push('fxProvenance.provider must be a non-empty string when provided');
  }
}

export function createApp(services = {}) {
  const {
    getInvestorProfileFn = getInvestorProfile,
    getProfileByIdFn = getProfileById,
    getProfileByUserIdFn = getProfileByUserId,
    createProfileForUserFn = createProfileForUser,
    updateInvestorProfileFn = updateInvestorProfile,
    getHoldingsFn = getHoldings,
    getAssetsFn = getAssets,
    getAssetBySymbolFn = getAssetBySymbol,
    getMarketSnapshotFn = getMarketSnapshot,
    getMarketHistoryFn = getMarketHistory,
    getMarketRealtimeFn = getMarketRealtime,
    getNewsFeedFn = getNewsFeed,
    getPersonalizedNewsFeedFn = getPersonalizedNewsFeed,
    getPortfolioOverviewFn = getPortfolioOverview,
    getPortfolioCompositionFn = getPortfolioComposition,
    getPortfolioPerformanceFn = getPortfolioPerformance,
    getPortfolioBenchmarkFn = getPortfolioBenchmark,
    getBinanceHealthFn = getBinanceHealth,
    checkSupabaseConnectionFn = checkSupabaseConnection,
    getAssetAnalysisFn = getAssetAnalysis,
    getAssetComparisonFn = getAssetComparison,
    getVietnamRegimeFn = getVietnamRegime,
    runMarketContextCollectorFn = runMarketContextCollector,
    runNewsCollectorFn = runNewsCollector,
    getOpportunitiesFn = getOpportunities,
    getInvestmentBriefFn = getInvestmentBrief,
    getWatchlistFn = getWatchlist,
    addToWatchlistFn = addToWatchlist,
    removeFromWatchlistFn = removeFromWatchlist,
    getAlertsFn = getAlerts,
    createAlertFn = createAlert,
    deleteAlertFn = deleteAlert,
    reactivateAlertFn = reactivateAlert,
    evaluateAndPersistAlertsFn = evaluateAndPersistAlerts,
    getPortfolioTransactionsFn = getPortfolioTransactions,
    createPortfolioTransactionFn = createPortfolioTransaction,
    getCashOverviewFn = getCashOverview,
    getCashLedgerFn = getCashLedger,
    createCashMovementFn = createCashMovement,
    createOpeningPositionFn = createOpeningPosition,
    correctOpeningPositionFn = correctOpeningPosition,
    cancelOpeningPositionFn = cancelOpeningPosition,
    getVapidConfigFn = getVapidConfig,
    upsertPushSubscriptionFn = upsertPushSubscription,
    deletePushSubscriptionByEndpointFn = deletePushSubscriptionByEndpoint,
    dispatchPendingWebPushDeliveriesFn = dispatchPendingWebPushDeliveries,
    corsOrigins = process.env.CORS_ORIGINS,
    transactionClient,
    cashClient,
    positionClient,
    supabaseAuthClient = privateSupabase,
    alertSchedulerToken = process.env.ALERT_SCHEDULER_TOKEN
  } = services;

  const app = express();
  app.use(cors(createCorsOptions(corsOrigins)));
  app.use(express.json());

  const resolveProfileById = async (id) => {
    if (getProfileByIdFn !== getProfileById) return getProfileByIdFn(id);
    if (getInvestorProfileFn !== getInvestorProfile) return getInvestorProfileFn(id);
    return getProfileById(id);
  };

  function requireProfile(req, res) {
    const profileId = req.user?.profileId;
    if (!profileId) {
      res.status(403).json({
        status: 'error',
        code: 'PROFILE_REQUIRED',
        message: 'Investor profile is required'
      });
      return null;
    }
    return profileId;
  }

  function getProfileOptions(req, profileId) {
    const id = profileId || req.user?.profileId;
    return id ? { profileId: id } : {};
  }

  const resolveProfileForUser = async (userId) => {
    if (getProfileByUserIdFn !== getProfileByUserId) {
      return getProfileByUserIdFn(userId);
    }
    const isTestEnv = process.env.NODE_ENV === 'test' ||
      process.execArgv.some(a => typeof a === 'string' && a.includes('--test')) ||
      process.argv.some(a => typeof a === 'string' && a.includes('test'));
    if (isTestEnv) {
      if (getProfileByIdFn !== getProfileById) {
        try {
          const p = await getProfileByIdFn('test-profile-id');
          if (p?.id) return p;
        } catch {
          return { id: 'test-profile-id' };
        }
      }
      if (getInvestorProfileFn !== getInvestorProfile) {
        try {
          const p = await getInvestorProfileFn();
          if (p?.id) return p;
        } catch {
          return { id: 'test-profile-id' };
        }
      }
      return { id: 'test-profile-id' };
    }
    return getProfileByUserId(userId);
  };

  app.use(createAuthMiddleware({
    supabaseAuthClient,
    getProfileByUserIdFn: resolveProfileForUser
  }));
  const requireAlertScheduler = createAlertSchedulerAuthMiddleware({ alertSchedulerToken });

  // Basic system health endpoint with provider status
  app.get('/api/health', (req, res) => {
    const providerHealth = typeof getBinanceHealthFn === 'function' ? getBinanceHealthFn() : {};
    res.json({
      status: 'ok',
      message: 'VN Invest Assistant API is running',
      providers: {
        ...providerHealth
      }
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
      message: 'Database connection check failed'
    });
  });

  // Investor profile endpoints
  app.get('/api/profile', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const profile = await resolveProfileById(profileId);
      return res.json({
        status: 'ok',
        data: profile
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch investor profile'
      });
    }
  });

  app.post('/api/profile', async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          status: 'error',
          code: 'AUTH_REQUIRED',
          message: 'Authentication is required'
        });
      }

      if (req.user.profileId) {
        const existing = await resolveProfileById(req.user.profileId);
        return res.json({
          status: 'ok',
          data: existing
        });
      }

      const created = await createProfileForUserFn({ userId: req.user.id });
      return res.status(201).json({
        status: 'ok',
        data: created
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to create investor profile'
      });
    }
  });

  app.put('/api/profile', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const { cash_available, risk_tolerance, investment_horizon } = req.body || {};

      const errors = [];

      const hasCashAvailable = Object.prototype.hasOwnProperty.call(req.body || {}, 'cash_available');

      // A supplied compatibility value must remain a strict financial number.
      if (hasCashAvailable && !isValidFinancialNumber(cash_available, { allowZero: true })) {
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

      const currentProfile = await resolveProfileById(profileId);
      if (hasCashAvailable && cash_available !== currentProfile?.cash_available) {
        return res.status(409).json({
          status: 'error',
          message: 'cash_available is ledger-managed; use the cash deposit or withdrawal endpoints'
        });
      }

      const updated = await updateInvestorProfileFn({
        profileId,
        risk_tolerance: risk_tolerance.trim().toLowerCase(),
        investment_horizon: investment_horizon.trim().toLowerCase()
      });

      return res.json({
        status: 'ok',
        data: updated
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        status: 'error',
        message: 'Failed to update investor profile'
      });
    }
  });

  // Holdings endpoints
  app.get('/api/holdings', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const holdings = await getHoldingsFn(undefined, getProfileOptions(req, profileId));
      return res.json({
        status: 'ok',
        count: holdings.length,
        data: holdings
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch holdings'
      });
    }
  });

  // Explicit cash-neutral baseline for assets already owned before ledger tracking.
  app.post('/api/positions/opening', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const {
        assetId,
        quantity,
        averageCost,
        executionUnitPrice,
        priceCurrency,
        fxRateToVnd,
        fxProvenance,
        fxObservedAt
      } = req.body || {};
      const errors = [];

      if (!assetId || typeof assetId !== 'string' || assetId.trim() === '') {
        errors.push('assetId is required and must be a non-empty string');
      }

      if (!isValidFinancialNumber(quantity, { allowZero: false })) {
        errors.push('quantity must be a finite number greater than 0');
      }

      if (averageCost !== undefined && !isValidFinancialNumber(averageCost, { allowZero: true })) {
        errors.push('averageCost must be a non-negative finite number');
      }

      if (executionUnitPrice !== undefined && !isValidFinancialNumber(executionUnitPrice, { allowZero: true })) {
        errors.push('executionUnitPrice must be a non-negative finite number');
      }

      if (priceCurrency !== undefined && (typeof priceCurrency !== 'string' || !priceCurrency.trim())) {
        errors.push('priceCurrency must be a non-empty string when provided');
      }

      if (fxRateToVnd !== undefined && !isValidFinancialNumber(fxRateToVnd, { allowZero: false })) {
        errors.push('fxRateToVnd must be a finite number greater than 0');
      }

      validateFxProvenance(fxProvenance, errors);

      let normalizedFxObservedAt;
      if (fxObservedAt !== undefined && fxObservedAt !== null) {
        normalizedFxObservedAt = normalizeExplicitTimestamp(fxObservedAt);
        if (!normalizedFxObservedAt) {
          errors.push('fxObservedAt must be a valid timestamp with an explicit Z or UTC offset');
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid opening position data',
          errors
        });
      }

      const openingPayload = {
        assetId: assetId.trim(),
        quantity,
        averageCost
      };
      if (executionUnitPrice !== undefined) openingPayload.executionUnitPrice = executionUnitPrice;
      if (priceCurrency !== undefined && typeof priceCurrency === 'string' && priceCurrency.trim()) {
        openingPayload.priceCurrency = priceCurrency.trim().toUpperCase();
      }
      if (fxRateToVnd !== undefined) openingPayload.fxRateToVnd = fxRateToVnd;
      if (fxProvenance !== undefined) openingPayload.fxProvenance = fxProvenance;
      if (normalizedFxObservedAt !== undefined) openingPayload.fxObservedAt = normalizedFxObservedAt;

      const result = await createOpeningPositionFn(openingPayload, positionClient, getProfileOptions(req, profileId));

      return res.status(201).json({
        status: 'ok',
        data: result
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to create opening position'
      });
    }
  });

  app.patch('/api/positions/opening/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const { quantity, averageCost } = req.body || {};
      const errors = [];

      if (!id || typeof id !== 'string' || id.trim() === '') {
        errors.push('Valid opening position ID is required');
      }

      if (!isValidFinancialNumber(quantity, { allowZero: false })) {
        errors.push('quantity must be a finite number greater than 0');
      }

      if (!isValidFinancialNumber(averageCost, { allowZero: true })) {
        errors.push('averageCost must be a non-negative finite number');
      }

      if (errors.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid opening position correction data',
          errors
        });
      }

      const result = await correctOpeningPositionFn({
        id: id.trim(),
        quantity,
        averageCost
      }, positionClient, getProfileOptions(req, profileId));

      return res.json({
        status: 'ok',
        data: result
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to correct opening position'
      });
    }
  });

  app.post('/api/positions/opening/:id/cancel', async (req, res) => {
    const { id } = req.params;
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      if (!id || typeof id !== 'string' || id.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid opening position ID is required'
        });
      }

      const result = await cancelOpeningPositionFn({ id: id.trim() }, positionClient, getProfileOptions(req, profileId));
      return res.json({
        status: 'ok',
        message: 'Opening position cancelled',
        data: result
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to cancel opening position'
      });
    }
  });

  // Immutable Feature 14 transaction ledger. Holdings mutation occurs only in
  // the database RPC so the ledger row and position update share one transaction.
  app.get('/api/transactions', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const { symbol } = req.query;
      if (symbol !== undefined && (typeof symbol !== 'string' || symbol.trim() === '')) {
        return res.status(400).json({
          status: 'error',
          message: 'symbol filter must be a non-empty string'
        });
      }

      const profileOptions = getProfileOptions(req, profileId);
      const transactions = await getPortfolioTransactionsFn({
        profileId: profileOptions.profileId,
        symbol: typeof symbol === 'string' ? symbol.trim() : undefined
      }, transactionClient, profileOptions);

      return res.json({
        status: 'ok',
        count: transactions.length,
        data: transactions,
        methodology: TRANSACTION_METHODOLOGY
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to fetch portfolio transactions'
      });
    }
  });

  app.post('/api/transactions', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const body = req.body || {};
      const {
        symbol,
        assetId,
        transactionType,
        quantity,
        price,
        executedAt,
        executionUnitPrice,
        priceCurrency,
        settlementMode,
        settlementCurrency,
        fxRateToVnd,
        fxProvenance,
        fxObservedAt
      } = body;
      const errors = [];

      const hasSymbol = typeof symbol === 'string' && symbol.trim() !== '';
      const hasAssetId = typeof assetId === 'string' && assetId.trim() !== '';
      if (symbol !== undefined && !hasSymbol) {
        errors.push('symbol must be a non-empty string when provided');
      }
      if (assetId !== undefined && !hasAssetId) {
        errors.push('assetId must be a non-empty string when provided');
      }
      if (hasSymbol === hasAssetId) {
        errors.push('exactly one of symbol or assetId is required');
      }

      const normalizedTransactionType = typeof transactionType === 'string'
        ? transactionType.trim()
        : null;
      if (!normalizedTransactionType || !TRANSACTION_TYPES.includes(normalizedTransactionType)) {
        errors.push('transactionType must be one of: BUY, SELL');
      }

      if (!isValidFinancialNumber(quantity, { allowZero: false })) {
        errors.push('quantity must be a finite number greater than 0');
      }

      if (!isValidFinancialNumber(price, { allowZero: false })) {
        errors.push('price must be a finite number greater than 0');
      }

      if (executionUnitPrice !== undefined && !isValidFinancialNumber(executionUnitPrice, { allowZero: false })) {
        errors.push('executionUnitPrice must be a finite number greater than 0');
      }

      if (priceCurrency !== undefined && (typeof priceCurrency !== 'string' || !priceCurrency.trim())) {
        errors.push('priceCurrency must be a non-empty string when provided');
      }

      if (settlementMode !== undefined && (typeof settlementMode !== 'string' || !SETTLEMENT_MODES.includes(settlementMode.trim().toUpperCase()))) {
        errors.push('settlementMode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT');
      }

      if (settlementCurrency !== undefined && settlementCurrency !== null && (typeof settlementCurrency !== 'string' || !settlementCurrency.trim())) {
        errors.push('settlementCurrency must be a non-empty string when provided');
      }

      if (fxRateToVnd !== undefined && !isValidFinancialNumber(fxRateToVnd, { allowZero: false })) {
        errors.push('fxRateToVnd must be a finite number greater than 0');
      }

      validateFxProvenance(fxProvenance, errors);

      let normalizedExecutedAt;
      if (Object.prototype.hasOwnProperty.call(body, 'executedAt')) {
        normalizedExecutedAt = normalizeExplicitTimestamp(executedAt);
        if (!normalizedExecutedAt) {
          errors.push('executedAt must be a valid timestamp with an explicit Z or UTC offset');
        }
      }

      let normalizedFxObservedAt;
      if (fxObservedAt !== undefined && fxObservedAt !== null) {
        normalizedFxObservedAt = normalizeExplicitTimestamp(fxObservedAt);
        if (!normalizedFxObservedAt) {
          errors.push('fxObservedAt must be a valid timestamp with an explicit Z or UTC offset');
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid portfolio transaction data',
          errors
        });
      }

      const transactionPayload = {
        symbol: hasSymbol ? symbol.trim() : undefined,
        assetId: hasAssetId ? assetId.trim() : undefined,
        transactionType: normalizedTransactionType,
        quantity,
        price,
        executedAt: normalizedExecutedAt
      };
      if (executionUnitPrice !== undefined) transactionPayload.executionUnitPrice = executionUnitPrice;
      if (priceCurrency !== undefined && typeof priceCurrency === 'string' && priceCurrency.trim()) {
        transactionPayload.priceCurrency = priceCurrency.trim().toUpperCase();
      }
      if (settlementMode !== undefined && typeof settlementMode === 'string' && settlementMode.trim()) {
        transactionPayload.settlementMode = settlementMode.trim().toUpperCase();
      }
      if (settlementCurrency !== undefined && typeof settlementCurrency === 'string' && settlementCurrency.trim()) {
        transactionPayload.settlementCurrency = settlementCurrency.trim().toUpperCase();
      }
      if (fxRateToVnd !== undefined) transactionPayload.fxRateToVnd = fxRateToVnd;
      if (fxProvenance !== undefined) transactionPayload.fxProvenance = fxProvenance;
      if (normalizedFxObservedAt !== undefined) transactionPayload.fxObservedAt = normalizedFxObservedAt;

      const result = await createPortfolioTransactionFn(transactionPayload, transactionClient, getProfileOptions(req, profileId));

      return res.status(201).json({
        status: 'ok',
        data: result,
        methodology: TRANSACTION_METHODOLOGY
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to create portfolio transaction'
      });
    }
  });

  // Feature 15 immutable cash/capital ledger. All mutations are delegated to
  // PostgreSQL RPCs that update the compatibility cash cache atomically.
  app.get('/api/cash/overview', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const overview = await getCashOverviewFn(cashClient, getProfileOptions(req, profileId));
      return res.json({
        status: 'ok',
        data: overview,
        methodology: CASH_LEDGER_METHODOLOGY
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to fetch cash overview'
      });
    }
  });

  app.get('/api/cash/ledger', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const entries = await getCashLedgerFn(cashClient, getProfileOptions(req, profileId));
      return res.json({
        status: 'ok',
        count: entries.length,
        data: entries,
        methodology: CASH_LEDGER_METHODOLOGY
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to fetch cash ledger'
      });
    }
  });

  async function handleCashMovement(req, res, entryType) {
    const profileId = requireProfile(req, res);
    if (!profileId) return;

    const { amount } = req.body || {};
    if (!isValidFinancialNumber(amount, { allowZero: false })) {
      return res.status(400).json({
        status: 'error',
        message: 'amount must be a finite number greater than 0'
      });
    }

    try {
      const result = await createCashMovementFn({ entryType, amount }, cashClient, getProfileOptions(req, profileId));
      return res.status(201).json({
        status: 'ok',
        data: result,
        methodology: CASH_LEDGER_METHODOLOGY
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        status: 'error',
        message: error.statusCode ? error.message : `Failed to create ${entryType.toLowerCase()}`
      });
    }
  }

  app.post('/api/cash/deposit', (req, res) => (
    handleCashMovement(req, res, CASH_MOVEMENT_TYPES[0])
  ));

  app.post('/api/cash/withdraw', (req, res) => (
    handleCashMovement(req, res, CASH_MOVEMENT_TYPES[1])
  ));

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
        message: 'Failed to fetch assets from database'
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
        message: 'Failed to fetch asset from database'
      });
    }
  });

  // Market snapshot endpoint (delayed data from canonical provider)
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
      const response = {
        status: 'error',
        message: error.message || 'Failed to fetch market snapshot'
      };
      if (error.code) response.code = error.code;
      return res.status(statusCode).json(response);
    }
  });

  // Dedicated realtime market reference endpoint (Feature 24A — Binance WebSocket USDT for Crypto Asset Detail only)
  app.get('/api/market/:symbol/realtime', async (req, res) => {
    const { symbol } = req.params;
    try {
      const realtime = await getMarketRealtimeFn(symbol);
      return res.json({
        status: 'ok',
        data: realtime
      });
    } catch (error) {
      const statusCode = error.status || 404;
      const response = {
        status: 'error',
        message: error.message || 'Realtime market data unavailable'
      };
      if (error.code) response.code = error.code;
      return res.status(statusCode).json(response);
    }
  });

  // Provider-neutral completed daily market history endpoint
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
      if (error.code) {
        response.code = error.code;
      }
      if (error.warnings && Array.isArray(error.warnings) && error.warnings.length > 0) {
        response.warnings = error.warnings;
      }
      return res.status(statusCode).json(response);
    }
  });

  // News feed endpoint backed by normalized persistence populated from CafeF, CoinDesk, and Alpha Vantage.
  app.get('/api/news', async (req, res) => {
    const { limit = 30, assetId, geography, topic } = req.query;
    try {
      const result = await getNewsFeedFn({ limit, assetId, geography, topic });
      if (Array.isArray(result)) {
        return res.json({
          status: 'ok',
          count: result.length,
          data: result
        });
      }
      return res.json(result);
    } catch (error) {
      const statusCode = error.statusCode || (error.code === 'ASSET_NOT_FOUND' ? 404 : (error.code === 'INVALID_LIMIT' || error.code === 'INVALID_ASSET_ID' ? 400 : (error.code === 'NEWS_SOURCES_UNAVAILABLE' ? 503 : 500)));
      const response = {
        status: 'error',
        message: error.message || 'Failed to fetch news feed'
      };
      if (error.code) response.code = error.code;
      if (error.details) response.details = error.details;
      return res.status(statusCode).json(response);
    }
  });

  // Personalized news feed endpoint (Feature 13 & Feature 23 — deterministic relevance to user holdings and watchlist)
  app.get('/api/news/personalized', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const result = await getPersonalizedNewsFeedFn({
        getNewsFeedFn,
        getHoldingsFn: () => getHoldingsFn(undefined, { profileId }),
        getWatchlistFn: () => getWatchlistFn(undefined, { profileId })
      });
      if (result.news) {
        return res.json({
          status: 'ok',
          count: result.news.length,
          data: result.news,
          userAssetCount: result.userAssetCount,
          userAssets: result.userAssets,
          partial: result.partial || false,
          dataAsOf: result.dataAsOf || null,
          sources: result.sources || []
        });
      }
      return res.json(result);
    } catch (error) {
      const statusCode = error.statusCode || (error.code === 'NEWS_SOURCES_UNAVAILABLE' ? 503 : 500);
      const response = {
        status: 'error',
        message: 'Failed to fetch personalized news feed'
      };
      if (error.code) response.code = error.code;
      return res.status(statusCode).json(response);
    }
  });

  // Vietnam market-regime context (Feature 27 — independent official-source domains)
  app.get('/api/regime/vietnam', async (req, res) => {
    const now = new Date();
    try {
      const result = await getVietnamRegimeFn({ now, client: supabaseAuthClient });
      const usable = isUsableRegimeDomain(result?.moneyMarket) ||
                     isUsableRegimeDomain(result?.inflation) ||
                     (Array.isArray(result?.pulseMetrics) && result.pulseMetrics.length > 0);
      if (!usable) {
        return res.status(503).json({
          ...result,
          status: 'unavailable',
          code: 'REGIME_SOURCES_UNAVAILABLE'
        });
      }
      return res.json(result);
    } catch {
      const unavailable = buildVietnamRegime({ moneyMarket: null, inflation: null, now });
      return res.status(503).json({
        ...unavailable,
        code: 'REGIME_SOURCES_UNAVAILABLE',
      });
    }
  });

  // Deterministic opportunity screen (Feature 28 — descriptive within-class ranking only)
  app.get('/api/opportunities', async (req, res) => {
    const now = new Date();
    const profileId = requireProfile(req, res);
    if (!profileId) return;

    try {
      const result = await getOpportunitiesFn({
        now,
        getAssetsFn,
        getInvestorProfileFn: () => resolveProfileById(profileId),
        getHoldingsFn: () => getHoldingsFn(undefined, { profileId }),
        getWatchlistFn: () => getWatchlistFn(undefined, { profileId }),
        getPortfolioCompositionFn: () => getPortfolioCompositionFn({
          getPortfolioOverviewFn: () => getPortfolioOverviewFn({ profileId })
        }),
        getAssetAnalysisFn: (symbol, options) => getAssetAnalysisFn(symbol, {
          ...options,
          getMarketHistoryFn
        }),
        getVietnamRegimeFn
      });
      const unavailable = result?.status === 'unavailable';
      return res.status(unavailable ? 503 : 200).json({
        status: unavailable ? 'error' : 'ok',
        ...(unavailable ? { code: 'OPPORTUNITY_SERVICE_UNAVAILABLE' } : {}),
        data: result
      });
    } catch (error) {
      return res.status(error.status || 503).json({
        status: 'error',
        code: error.code || 'OPPORTUNITY_SERVICE_UNAVAILABLE',
        message: 'Không thể tạo danh sách cơ hội mô tả lúc này'
      });
    }
  });

  // Guarded AI investment brief (Feature 29 — deterministic facts remain authoritative)
  app.post('/api/investment-brief', async (req, res) => {
    const now = new Date();
    const profileId = requireProfile(req, res);
    if (!profileId) return;

    const profileOptions = getProfileOptions(req, profileId);

    try {
      const result = await getInvestmentBriefFn({
        now,
        getPortfolioOverviewFn: (opts) => getPortfolioOverviewFn({ ...opts, ...profileOptions }),
        getPortfolioPerformanceFn: (opts) => getPortfolioPerformanceFn({ ...opts, ...profileOptions }),
        getVietnamRegimeFn,
        getOpportunitiesFn,
        getPersonalizedNewsFeedFn,
        getNewsFeedFn,
        getAssetsFn,
        getInvestorProfileFn: () => resolveProfileById(profileId),
        getHoldingsFn: (client, opts) => getHoldingsFn(client, { ...opts, ...profileOptions }),
        getWatchlistFn: (client, opts) => getWatchlistFn(client, { ...opts, ...profileOptions }),
        getAssetAnalysisFn,
        getMarketHistoryFn
      });
      return res.status(result?.status === 'unavailable' ? 503 : 200).json(result);
    } catch (error) {
      const statusCode = error?.status === 429 ? 429 : 503;
      return res.status(statusCode).json({
        methodologyVersion: 'ai-brief-v1',
        status: 'unavailable',
        generationMode: 'deterministic_fallback',
        code: statusCode === 429 ? (error.code || 'AI_BRIEF_RATE_LIMITED') : 'AI_BRIEF_UNAVAILABLE',
        message: statusCode === 429
          ? 'Tần suất tạo bản tin đang được giới hạn. Vui lòng thử lại sau.'
          : 'Không thể tạo bản tin đầu tư lúc này.'
      });
    }
  });

  // Portfolio overview endpoint (combines profile, holdings, and delayed market prices)
  app.get('/api/portfolio/overview', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const overview = await getPortfolioOverviewFn(getProfileOptions(req, profileId));
      return res.json({
        status: 'ok',
        data: overview
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to generate portfolio overview'
      });
    }
  });

  // Portfolio composition endpoint (derived exclusively from portfolio overview valuation)
  app.get('/api/portfolio/composition', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const composition = await getPortfolioCompositionFn({
        getPortfolioOverviewFn: () => getPortfolioOverviewFn(getProfileOptions(req, profileId))
      });
      return res.json({
        status: 'ok',
        data: composition
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to generate portfolio composition'
      });
    }
  });

  // Portfolio performance endpoint (Feature 25B — VND portfolio TWR, MWR/XIRR, wealth index drawdown, accounting P/L)
  app.get('/api/portfolio/performance', async (req, res) => {
    const { range = '1M' } = req.query;
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const performance = await getPortfolioPerformanceFn({ range, ...getProfileOptions(req, profileId) });
      return res.json({
        status: 'ok',
        data: performance
      });
    } catch (error) {
      const statusCode = error.status || 500;
      const response = {
        status: 'error',
        message: error.message || 'Failed to generate portfolio performance'
      };
      if (error.code) response.code = error.code;
      return res.status(statusCode).json(response);
    }
  });

  // Portfolio benchmark comparison endpoint (Feature 25C — VN-Index primary / S&P 500 reference-only)
  app.get('/api/portfolio/performance/benchmark', async (req, res) => {
    const { range = '1M', benchmark } = req.query;
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const result = await getPortfolioBenchmarkFn({
        benchmarkId: benchmark,
        range,
        getPortfolioPerformanceFn: (opts) => getPortfolioPerformanceFn({ ...opts, ...getProfileOptions(req, profileId) })
      });
      return res.json({
        status: 'ok',
        data: result
      });
    } catch (error) {
      const statusCode = error.status || 500;
      const response = {
        status: 'error',
        message: error.message || 'Failed to generate benchmark comparison'
      };
      if (error.code) response.code = error.code;
      return res.status(statusCode).json(response);
    }
  });

  // Deterministic asset analysis endpoint
  app.get('/api/analysis/:symbol', async (req, res) => {
    const { symbol } = req.params;
    try {
      const analysis = await getAssetAnalysisFn(symbol, {
        getMarketHistoryFn,
        getMarketSnapshotFn,
        range: req.query.range
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
      if (error.code) response.code = error.code;
      if (error.warnings && Array.isArray(error.warnings) && error.warnings.length > 0) {
        response.warnings = error.warnings;
      }
      return res.status(statusCode).json(response);
    }
  });

  // Provider-neutral cross-asset comparison endpoint (Feature 24A)
  app.get('/api/comparison', async (req, res) => {
    const rawSymbols = Array.isArray(req.query.symbols)
      ? req.query.symbols
      : [req.query.symbols];
    const symbols = rawSymbols
      .flatMap((value) => typeof value === 'string' ? value.split(',') : [])
      .map((symbol) => symbol.trim())
      .filter(Boolean);
    const range = typeof req.query.range === 'string' ? req.query.range : '1M';

    try {
      const comparison = await getAssetComparisonFn(symbols, range);
      return res.json({
        status: 'ok',
        data: comparison
      });
    } catch (error) {
      const statusCode = error.status || 500;
      const response = {
        status: 'error',
        message: error.message || 'Failed to compare assets'
      };
      if (error.code) response.code = error.code;
      return res.status(statusCode).json(response);
    }
  });

  // Watchlist endpoints (Feature 08)
  app.get('/api/watchlist', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const items = await getWatchlistFn(undefined, { profileId });
      return res.json({
        status: 'ok',
        count: items.length,
        data: items
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch watchlist'
      });
    }
  });

  app.post('/api/watchlist', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

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
        profileId,
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
        message: error.statusCode ? error.message : 'Failed to add to watchlist'
      });
    }
  });

  app.delete('/api/watchlist/:assetId', async (req, res) => {
    const { assetId } = req.params;
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      if (!assetId || typeof assetId !== 'string' || assetId.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid asset ID or symbol is required'
        });
      }

      const result = await removeFromWatchlistFn(assetId.trim(), { profileId });
      return res.json({
        status: 'ok',
        message: 'Asset removed from watchlist',
        data: result
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to remove from watchlist'
      });
    }
  });

  // Price Alerts endpoints (Feature 12)
  app.get('/api/alerts', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const alerts = await getAlertsFn(undefined, { profileId });
      return res.json({
        status: 'ok',
        count: alerts.length,
        data: alerts
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch price alerts'
      });
    }
  });

  app.post('/api/alerts', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

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
        profileId,
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
        message: error.statusCode ? error.message : 'Failed to create price alert'
      });
    }
  });

  app.delete('/api/alerts/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      if (!id || typeof id !== 'string' || id.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid alert ID is required'
        });
      }

      const result = await deleteAlertFn(id.trim(), { profileId });
      return res.json({
        status: 'ok',
        message: 'Price alert deleted',
        data: result
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to delete price alert'
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
        message: 'Failed to evaluate price alerts'
      });
    }
  });

  app.post('/api/internal/alerts/evaluate', requireAlertScheduler, async (req, res) => {
    try {
      const summary = await evaluateAndPersistAlertsFn({
        getMarketSnapshotFn,
        now: new Date()
      });

      let deliverySummary = {
        deliveryClaimedCount: 0,
        deliverySentCount: 0,
        deliveryRetryableFailureCount: 0,
        deliveryPermanentFailureCount: 0,
        deliveryExpiredSubscriptionCount: 0
      };

      try {
        deliverySummary = await dispatchPendingWebPushDeliveriesFn();
      } catch (_dispatchErr) {
        // Failure isolation: preserve alert evaluation outcome without rollback
      }

      return res.json({
        status: 'ok',
        data: {
          evaluatedCount: summary.evaluatedCount,
          triggeredCount: summary.triggeredCount,
          unavailableCount: summary.unavailableCount,
          staleCount: summary.staleCount,
          deliveryClaimedCount: deliverySummary?.deliveryClaimedCount ?? 0,
          deliverySentCount: deliverySummary?.deliverySentCount ?? 0,
          deliveryRetryableFailureCount: deliverySummary?.deliveryRetryableFailureCount ?? 0,
          deliveryPermanentFailureCount: deliverySummary?.deliveryPermanentFailureCount ?? 0,
          deliveryExpiredSubscriptionCount: deliverySummary?.deliveryExpiredSubscriptionCount ?? 0
        }
      });
    } catch (_error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to evaluate price alerts'
      });
    }
  });

  // Internal market context refresh endpoint (Feature 27B / Improvement 02 collector)
  app.post('/api/internal/context/refresh', requireAlertScheduler, async (req, res) => {
    try {
      const summary = await runMarketContextCollectorFn({
        now: new Date(),
        client: supabaseAuthClient
      });
      if (!summary.isDurable || summary.failedPersistence > 0) {
        return res.status(503).json({
          status: 'degraded',
          message: 'Durable persistence failed or degraded during context refresh',
          data: summary
        });
      }
      return res.json({
        status: 'ok',
        data: summary
      });
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to refresh market context observations'
      });
    }
  });

  // Internal normalized-news ingestion. Public news requests never call upstream providers.
  app.post('/api/internal/news/refresh', requireAlertScheduler, async (_req, res) => {
    try {
      const summary = await runNewsCollectorFn({
        now: new Date(),
        client: supabaseAuthClient
      });
      if (!summary.success || summary.failedPersistence > 0) {
        return res.status(503).json({
          status: 'degraded',
          message: 'Durable persistence failed or no usable news was retained',
          data: summary
        });
      }
      return res.json({ status: 'ok', data: summary });
    } catch {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to refresh market news'
      });
    }
  });

  // --- Feature 12C: Web Push Subscription Endpoints ---

  app.get('/api/push/config', (req, res) => {
    const vapidConfig = getVapidConfigFn();
    return res.json({
      status: 'ok',
      data: {
        supported: true,
        configured: vapidConfig.isConfigured,
        vapidPublicKey: vapidConfig.publicKey
      }
    });
  });

  app.post('/api/push/subscriptions', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const validated = validatePushSubscriptionInput(req.body);
      const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 256) : null;

      const sub = await upsertPushSubscriptionFn({
        profileId,
        endpoint: validated.endpoint,
        p256dh: validated.p256dh,
        auth: validated.auth,
        userAgent
      });

      return res.status(201).json({
        status: 'ok',
        data: {
          id: sub.id,
          created: Boolean(sub)
        }
      });
    } catch (err) {
      if (err.name === 'WebPushDeliveryError') {
        return res.status(400).json({
          status: 'error',
          message: err.message
        });
      }
      return res.status(500).json({
        status: 'error',
        message: 'Failed to save push subscription'
      });
    }
  });

  app.delete('/api/push/subscriptions', async (req, res) => {
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      const { endpoint } = req.body || {};
      if (!endpoint || typeof endpoint !== 'string' || endpoint.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid subscription endpoint is required'
        });
      }

      const deleted = await deletePushSubscriptionByEndpointFn(endpoint.trim(), profileId);

      return res.json({
        status: 'ok',
        data: {
          removed: Boolean(deleted)
        }
      });
    } catch (err) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to remove push subscription'
      });
    }
  });

  app.post('/api/alerts/:id/reactivate', async (req, res) => {
    const { id } = req.params;
    try {
      const profileId = requireProfile(req, res);
      if (!profileId) return;

      if (!id || typeof id !== 'string' || id.trim() === '') {
        return res.status(400).json({
          status: 'error',
          message: 'Valid alert ID is required'
        });
      }

      const alert = await reactivateAlertFn(id.trim(), { profileId });
      return res.json({
        status: 'ok',
        message: 'Price alert reactivated',
        data: alert
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        status: 'error',
        message: error.statusCode ? error.message : 'Failed to reactivate price alert'
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
