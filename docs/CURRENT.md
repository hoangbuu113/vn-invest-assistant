# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Release Status**: V1.1 COMPLETE / PRODUCTION VERIFIED
- **Branch**: `main`
- **Architecture**: Cloudflare Workers Static Assets frontend + Render Node.js Express backend + Supabase PostgreSQL database
- **Security & Multi-User Authorization**:
  - Authoritative authentication: Supabase Auth (email/password) is the sole browser authentication mechanism.
  - Completely retired: `OwnerGate`, `OWNER_ACCESS_TOKEN` browser auth, HMAC session tokens, and session cookies (`vn_invest_owner_session`).
  - Strict multi-user profile model: Each authenticated user has an isolated `investor_profile` (`user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id)`).
  - Clean onboarding: New profiles start empty with `cash_available = 0`, 0 holdings, 0 transactions, and 0 synthetic records.
  - Direct Supabase `anon` and `authenticated` roles have NO direct SELECT/INSERT/UPDATE/DELETE access to private financial tables (`investor_profile`, `holdings`, `position_opening_baselines`, `portfolio_transactions`, `cash_ledger_entries`, `watchlist_items`, `price_alerts`, `push_subscriptions`, `alert_notification_deliveries`); access is guarded exclusively through backend Express API using Supabase Bearer JWT and backend `service_role`.
  - Public canonical metadata (`assets`, `asset_provider_mappings`) remains accessible for public showcase browsing.
  - Background alert scheduler is protected via `ALERT_SCHEDULER_TOKEN` (cron trigger `*/15 * * * *` on Cloudflare Worker to `POST /api/internal/alerts/evaluate`).
  - Service-role key (`SUPABASE_SECRET_KEY`) is strictly backend-only and never exposed to the client bundle.
- **Web Push Alert Delivery Engine (PRODUCTION ACTIVE & VERIFIED)**:
  - First-party Web Push delivery engine (`web-push`, RFC 8291 / RFC 8292) with per-device subscriptions (`public.push_subscriptions`) and per-device delivery jobs (`public.alert_notification_deliveries`).
  - Evaluated on background schedule (Cloudflare Worker cron `*/15 * * * *` -> Render backend `POST /api/internal/alerts/evaluate`), not refresh-only.
  - Delivery model: Bounded retry, best-effort per device delivery (max 3 attempts, 15-minute backoff, automatic cleanup of 404/410 expired subscriptions). Push service acceptance (`sent`) is verified; notification display is subject to OS/browser delivery semantics without guaranteed display claims.
  - Service Worker (`client/public/sw.js`): Strictly handles push display and same-origin window focus/navigation; no offline caching or financial logic.
  - Web App Manifest (`client/public/manifest.webmanifest`): Standalone display and Apple mobile web app metadata for iOS Home Screen support.
- **Multi-Asset Architecture & Financial Foundations**:
  - Project Purpose: Public multi-asset market intelligence and tracking showcase application; portfolio accounting is a supporting capability.
  - Dual-settlement VND-basis accounting: Base currency remains VND. Crypto and Gold spot current VND valuations work through current USD/VND FX authority.
  - Historical non-VND portfolio performance remains truthful unavailable when historical FX authority is missing.
  - Feature 27 Vietnam Market Regime: CPI reliability improvement active (NSO CPI). SBV money-market rates remain truthful unavailable under WAF (`OFFICIAL_DATA_UNAVAILABLE`) without fabricating rates. Market breadth remains `NOT_DEFENSIBLE_FOR_V1.1` (`status: 'unavailable'`, `reason: 'SOURCE_NOT_PROVISIONED'`).
  - Disposable test data cleanup: The legacy 20,000,000 VND test profile and its child rows were permanently purged; no stale 20M baseline exists in production.
- **Production Endpoints**:
  - Frontend: `https://vn-invest-assistant.vn-invest-assistant.workers.dev` (Cloudflare Workers Static Assets + API Proxy + 15m Cron)
  - Backend: `https://vn-invest-assistant-api.onrender.com` (Render Node.js Express, health `ok`, db-health `ok`)
- **Automated Test Suite**:
  - Full Backend & Client Contract Regression: 853/853 PASS across 148 test suites
  - Dependencies: `npm audit` 0 vulnerabilities on both server and client
  - Client Build: PASS (~186ms, 0 errors, 0 warnings)
  - Git Diff & Formatting: `git diff --check` PASS
- **Working Tree**: CLEAN

---

## CURRENT PHASE
V1.1 PRODUCTION ACCEPTANCE & CLOSEOUT (COMPLETE)

## RELEASE STATUS
V1.1 COMPLETE / PRODUCTION VERIFIED

---

## PRODUCTION & LIVE PROVIDER VERIFIED PATHS
- **Yahoo Finance**: Vietnamese listed equities & exchange-traded ETFs (`VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`). Completed daily OHLCV history with `Asia/Ho_Chi_Minh` timezone semantics.
- **CoinGecko**: Canonical `USD` valuation-snapshot authority for all 40 Crypto assets. Feeds portfolio/accounting valuation and canonical snapshot consumers.
- **Binance Spot**: Native `USDT` authority for realtime reference, completed daily OHLCV history, and Analysis V2 across 40 explicit Spot mappings. Realtime uses shared miniTicker WebSocket; history uses multiplexed Binance WebSocket API for completed UTC daily klines. Binance `USDT` is never treated as canonical `USD` accounting quote.
- **Current VND Reference**: Asset Detail displays `≈VND` computed server-side from Binance `USDT` and explicit `USD/VND` rate. Marked approximate, reference-only, non-accounting, and non-historical.
- **Alpha Vantage**:
  - Gold Spot snapshot and completed daily close-only history (`XAU/USD`) via `GOLD_SILVER_SPOT`.
  - Multi-asset global news acquisition (`NEWS_SENTIMENT`).
- **Twelve Data**: Direct `USD -> VND` FX exchange rate resolution. Current snapshot supported; history intentionally unsupported.
- **CafeF**: Official public RSS feeds for Vietnamese stock, company, macroeconomic, and international market news.
- **CoinDesk**: Official public RSS feed for cryptocurrency news.

---

## CANONICAL UNIVERSE & INITIAL FINANCIAL BASELINE
- **Canonical Universe**: 49 assets (40 crypto, 7 VN stocks/ETFs, 1 gold spot, 1 FX context) across 5 verified providers (89 provider mappings).
- **Initial State per User**:
  - Authoritative Holdings: 0 rows (clean first-use state)
  - Authoritative Transactions: 0 rows
  - Authoritative Position Opening Baselines: 0 rows
  - Authoritative Cash Ledger: 0 rows (opening balance: 0 VND)
  - Authoritative Current Cash: 0 VND
  - Authoritative Watchlist: 0 rows
  - Authoritative Price Alerts: 0 rows

---

## COMPLETED FEATURES SUMMARY (01–30) & V1.1 IMPROVEMENTS

### V1 Core Features (01–30)
- **Features 01–03**: Asset Browser (`/api/assets`), Market Snapshot (`/api/market/:symbol`), News Feed (`/api/news`).
- **Feature 04**: Investor Profile (`/api/profile`).
- **Feature 05**: Portfolio Overview (`/api/portfolio/overview`), full precision valuation, partial valuation handling.
- **Feature 06**: Historical Price & Trend (`/api/market/:symbol/history`).
- **Feature 07**: Deterministic Asset Analysis (`/api/analysis/:symbol`).
- **Feature 08**: Watchlist / Danh sách theo dõi (`/api/watchlist`).
- **Feature 09**: Personal Investment Dashboard / Tổng quan.
- **Feature 10**: Portfolio Composition & Concentration (`/api/portfolio/composition`).
- **Feature 11**: Asset Comparison / So sánh tài sản (`base100.series`).
- **Feature 12**: Price Alerts V1 / Cảnh báo giá (`/api/alerts`).
- **Feature 13**: Personalized Relevant News / Tin của tôi (`/api/news/personalized`).
- **Feature 14**: Transaction Ledger / Sổ lệnh giao dịch (`/api/transactions`), immutable log, atomic RPCs, weighted-average cost, realized P/L.
- **Feature 15**: Cash / Capital Ledger / Sổ dòng tiền (`/api/cash/*`), atomic cash ledger, opening baseline.
- **Feature 16**: Canonical Multi-Asset Foundation (authoritative asset UUID, decoupled provider mapping schema, VND transaction guard).
- **Feature 17**: Ledger Authority & Position Integrity (opening-position baselines without synthetic BUYs, locking upon subsequent trade).
- **Feature 18**: Market Provider Abstraction (provider-neutral snapshot/history boundary).
- **Feature 19**: FX & Cross-Currency Valuation Foundation (VND universal reporting currency).
- **Feature 20**: Real Multi-Asset Providers & Controlled Universe (49 assets: 40 crypto, 7 VN stocks/ETFs, 1 gold spot, 1 FX context).
- **Feature 21**: Asset-Class Market & Historical Semantics (`VN_EXCHANGE`, `CONTINUOUS_24_7`, `GLOBAL_24_5`).
- **Feature 22**: Deterministic Analysis V2 (`methodologyVersion = "v2"`).
- **Feature 23**: Multi-Asset News Foundation (CafeF, CoinDesk, Alpha Vantage).
- **Feature 24**: Existing Feature Multi-Asset Integration (Centralized formatting, Base 100 comparison, capability badges).
- **Feature 25**: Portfolio Performance & Benchmarking.
- **Feature 26**: Crypto Market Data Reliability & Hybrid Quote Authority (CoinGecko USD valuation + Binance USDT realtime/history).
- **Feature 27**: Vietnam Market Regime Foundation (NSO CPI, SBV money market, unprovisioned market breadth).
- **Feature 28**: Deterministic Opportunity Engine (`GET /api/opportunities`).
- **Feature 29**: Guarded AI Investment Brief (`POST /api/investment-brief`).
- **Feature 30**: Release Hardening & Production Gate.

### V1.1 Production Improvements
- **V1.1 Improvement 12 (Web Push Alerts Engine)**: First-party Web Push delivery via `web-push`, per-device subscriptions, background scheduler evaluation (`*/15 * * * *`), multi-device fanout, and bounded retry.
- **V1.1 Improvement 13 (Public Multi-User Supabase Auth)**: Cutover from single-owner model to public multi-user Supabase Auth (email/password). Independent isolated `investor_profile` per user initialized with `cash = 0`. Permanent retirement of `OwnerGate`, `OWNER_ACCESS_TOKEN`, and owner session cookies.
- **V1.1 Improvement 19/25 (Dual-Settlement Accounting Foundation)**: VND-basis dual-settlement cross-currency accounting foundation in PostgreSQL and portfolio performance models.
- **V1.1 Test Data Cleanup**: Purged unowned legacy 20M test data and enforced `investor_profile.user_id UUID NOT NULL UNIQUE`.
