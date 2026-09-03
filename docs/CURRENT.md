# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Release Status**: V1.1 BATCH 2 ACTIVE / VERIFIED IN PRODUCTION
- **Branch**: `main`
- **Architecture**: Cloudflare Workers Static Assets frontend + Render Node.js Express backend + Supabase PostgreSQL database
- **Security & Authorization**:
  - Production security activated via PostgreSQL permissions (`20260901000000_feature_30b1_single_owner_security.sql` & `20260901010000_v1_1_cross_currency_accounting_foundation.sql`)
  - Direct Supabase `anon` access denied for all private financial tables (`investor_profile`, `holdings`, `position_opening_baselines`, `portfolio_transactions`, `cash_ledger_entries`, `watchlist_items`, `price_alerts`) and sensitive RPCs
  - Public canonical metadata (`assets`, `asset_provider_mappings`) remains accessible to `anon`
  - Single-owner authentication enforced with trusted device sessions: 30-day first-party HttpOnly cookie (`vn_invest_owner_session`) + bearer auth fallback (`OWNER_ACCESS_TOKEN`); unauthenticated requests return 401, invalid tokens return 403
  - Background price-alert scheduler protected via `ALERT_SCHEDULER_TOKEN` (cron trigger `*/15 * * * *` on Cloudflare Worker)
  - Service-role key / database secret key (`SUPABASE_SECRET_KEY`) is strictly backend-only and never exposed to the client bundle
- **Multi-Asset, Onboarding & Navigation Activation (V1.1 Batch 2)**:
  - Feature 27 SBV Money-Market Data Reliability: Adapter and parser hardened for diverse Vietnamese date patterns; upstream WAF blocking detected and mapped to truthful `OFFICIAL_DATA_UNAVAILABLE` degradation without fabricating rates
  - State-Aware Portfolio Onboarding: Dynamic 3-state presentation machine (State A no capital, State B cash ready with 20M display, State C holdings active) with zero financial mutations and clear action routing
  - Browser History & Asset Deep Linking: Canonical hash routing (`#{tab}`, `#assets/{symbol}` with `XAU/USD` $\leftrightarrow$ `#assets/XAU%2FUSD` encoding), browser Back/Forward, origin tab preservation, and safe error fallbacks
  - Market Breadth: Retained as `status: 'unavailable'`, `reason: 'SOURCE_NOT_PROVISIONED'`
  - Feature 19 VND-basis dual-settlement cross-currency accounting foundation active in production DB
  - Feature 25 performance integration honors external settlements as external capital flows
- **Feature 12B/12C/12D Web Push Alert Delivery Backend & Client (LOCAL ONLY — NOT PRODUCTION-ACTIVE)**:
  - Outbound notification architecture: First-party Web Push delivery engine (`web-push`, RFC 8291 / RFC 8292)
  - Protected subscription API: `GET /api/push/config` (exposes public key only), `POST /api/push/subscriptions` (endpoint-unique device registration), `DELETE /api/push/subscriptions` (endpoint-targeted removal with ON DELETE CASCADE)
  - Multi-device delivery model: `BOUNDED_RETRY_BEST_EFFORT` with per-subscription delivery jobs in `public.alert_notification_deliveries` and device subscriptions in `public.push_subscriptions`
  - Atomic trigger & fanout RPC: `trigger_price_alert_atomic` updates alert status and fans out one pending delivery per registered push subscription of the profile in a single ACID transaction
  - Zero-device semantics: Triggering an alert when profile has zero push devices records the trigger authoritatively with zero outbox rows; no retroactive delivery upon later device registration
  - Atomic claim RPC: `claim_pending_alert_deliveries` claims eligible jobs with 120-second leases, `SKIP LOCKED`, defensive bounds clamping (`batchSize` in `[1, 25]`, `leaseSeconds` in `[30, 600]`), and zombie recovery for expired attempts (auto-terminalizing to `failed_permanent` when `attempt_count >= 3`)
  - Web Push dispatcher: Bounded sequential dispatcher (`dispatchPendingWebPushDeliveries`, batch size 5, 120s lease, explicit 10s request timeout per send leaving 70s lease margin) claiming and dispatching factual alert notifications with canonical deep links (`/#assets/{symbol}`, `/#assets/XAU%2FUSD`)
  - Error classification & cleanup: HTTP 404/410 permanently expired subscriptions deleted immediately (cascading all delivery history); HTTP 429 rate limit parses `Retry-After` header safely into future `next_attempt_at`; HTTP 5xx and network errors retry up to 3 attempts with 15-minute backoff; terminal failures safely marked `failed_permanent`
  - Scheduler integration: Integrated directly into `POST /api/internal/alerts/evaluate` without extra crons or mutating alert states; failure-isolated
  - Service Worker: `client/public/sw.js` (dedicated strictly to push event notification display and same-origin window focus/navigation; preserves canonical deep links including `/#assets/BTC` and `/#assets/XAU%2FUSD`; no caching/offline/financial logic)
  - Web App Manifest: `client/public/manifest.webmanifest` (standalone display, root scope/start_url, linked in `client/index.html` with apple-mobile-web-app metadata for iOS Home Screen compatibility)
  - Client Push Engine: `client/src/utils/webPush.js` (native capability detection, VAPID key conversion, PushManager subscription enable/disable flow with backend synchronization and cleanup rollback on failure)
  - Explicit Vietnamese UX: `DeviceAlertNotificationControl` embedded in Alert Center (`client/src/components/AlertCenterSection.jsx`); read-only inspection on mount with zero permission prompt on load; non-guaranteed wording on initial state (`"Thông báo đang được bật trên trình duyệt này."`) and session-verified state (`"Thông báo đã bật trên thiết bị này."`); explicit "Bật thông báo" / "Tắt thông báo" controls; iOS Home Screen guidance; in-app alert fallback remains truthful and unaffected
  - Hardened limits: max 3 attempts per device delivery; rare duplicate push delivery accepted/documented; zero guaranteed delivery claims
- **Feature 13B & 13C Multi-User Profile Ownership & Supabase Auth Backend Foundation (LOCAL ONLY — NOT PRODUCTION-ACTIVE)**:
  - Database multi-user ownership foundation prepared via migration `supabase/migrations/20260904000000_feature_13b_multi_user_ownership_foundation.sql` (UNAPPLIED):
    - Replaces singleton architecture with strict multi-user profile model linked to Supabase Auth (`auth.users.id`).
    - Added `user_id UUID NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT` to `public.investor_profile` (enforcing financial data safety against accidental cascade deletion).
    - Dropped legacy singleton constraints (`investor_profile_singleton_check`, `investor_profile_singleton_unique`, and column `singleton_key`).
    - Added partial unique index `uq_investor_profile_legacy_unowned ON public.investor_profile ((user_id IS NULL)) WHERE user_id IS NULL` guaranteeing at most one unowned legacy profile can exist.
    - Preserves existing production profile (`e4ae09df-3a4a-48eb-b08d-5334687207b1`, `cash_available = 20,000,000 VND`) in place with `user_id = NULL` without row copy, ID changes, or synthetic records.
    - Atomic one-time legacy profile claiming RPC `claim_legacy_profile(p_user_id UUID)` (checks `IP004` null parameter, `IP005` user already has profile, `IP006` legacy profile already claimed/unavailable).
    - Rewrote all 9 financial RPCs to accept authoritative `p_profile_id UUID` parameter, strictly enforcing `IF p_profile_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';`:
      1. `get_cash_overview(p_profile_id UUID)`
      2. `list_cash_ledger_entries(p_profile_id UUID)`
      3. `create_cash_movement(p_profile_id UUID, p_entry_type TEXT, p_amount NUMERIC)`
      4. `update_investor_profile_preferences(p_profile_id UUID, p_risk_tolerance TEXT, p_investment_horizon TEXT)`
      5. `create_portfolio_transaction(p_profile_id UUID, ...)`
      6. `list_portfolio_transactions(p_profile_id UUID, p_symbol TEXT)`
      7. `create_opening_position(p_profile_id UUID, ...)`
      8. `correct_opening_position(p_profile_id UUID, p_opening_position_id TEXT, ...)`
      9. `cancel_opening_position(p_profile_id UUID, p_opening_position_id TEXT)`
    - Revoked all execution permissions on financial & claim RPCs from `PUBLIC, anon, authenticated` and granted exclusively to backend `service_role`.
  - Feature 13C Backend Auth & Ownership Scoping:
    - Implemented dual-auth middleware `createAuthMiddleware`: parses credentials, validates Supabase Auth JWT via `supabaseAuthClient.auth.getUser`, and resolves `req.user = { id, email, profileId, isLegacyOwner }`.
    - Transitional coexistence: Legacy `OWNER_ACCESS_TOKEN` bearer and trusted owner session cookie continue to authenticate smoothly.
    - All private endpoints scoped strictly to `req.user.profileId` (`requireProfile(req, res)` returns 403 `PROFILE_REQUIRED` if profile missing). Body/query spoofed profile IDs are completely ignored.
    - `POST /api/profile`: Authenticated users create isolated investor profile (`cash_available = 0`, idempotent via `UNIQUE(user_id)`).
    - `POST /api/auth/claim-legacy-profile`: Atomic legacy profile claim requiring valid Supabase user JWT and constant-time proof of `OWNER_ACCESS_TOKEN`.
    - `GET /api/auth/legacy-claim-status`: Capability discovery returning `legacyClaimAvailable: boolean` without leaking financial numbers or profile details.
    - Scheduler authentication via `ALERT_SCHEDULER_TOKEN` remains independent and unchanged.
  - Status: 13C Backend local complete; migration UNAPPLIED in production; no legacy claim executed; production legacy owner auth still active.
- **Canonical Universe & Remote Baseline**:
  - Canonical Universe: 49 assets (40 crypto, 7 VN stocks/ETFs, 1 gold spot, 1 FX context) across 5 verified providers (89 provider mappings)
  - Authoritative Cash Ledger: 1 legitimate DEPOSIT entry (`20,000,000 VND`)
  - Singleton Investor Profile: 1 record (`cash_available = 20,000,000 VND`, moderate risk tolerance, medium horizon)
- **Automated Test Suite**:
  - Full Backend & Client Contract Regression: 843/843 PASS (142 test suites, including 23/23 in `supabase-auth-backend.test.js`, 19/19 in `multi-user-ownership.test.js`, 19/19 in `single-owner-security.test.js`)
  - Dependencies: `npm audit` 0 vulnerabilities on both server and client
  - Client Build: PASS (~222ms, 0 errors, 0 warnings; `dist/sw.js` and `dist/manifest.webmanifest` verified at root)
  - Git Diff & Formatting: `git diff --check` PASS
- **Production Endpoints**:
  - Frontend: `https://vn-invest-assistant.vn-invest-assistant.workers.dev` (Cloudflare Workers Static Assets + API Proxy + 15m Cron)
  - Backend: `https://vn-invest-assistant-api.onrender.com` (Render Node.js Express, health `ok`, db-health `ok`)
- **Working Tree**: CLEAN

## CURRENT PHASE
V1.1 RELEASE ACTIVATION — BATCH 2 (COMPLETE)

## RELEASE STATUS
V1.1 BATCH 2 ACTIVE / VERIFIED IN PRODUCTION

---

## PRODUCTION & LIVE PROVIDER VERIFIED PATHS
- **Yahoo Finance**: Vietnamese listed equities & exchange-traded ETFs (`VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`). Completed daily OHLCV history with `Asia/Ho_Chi_Minh` timezone semantics.
- **CoinGecko**: Canonical `USD` valuation-snapshot authority for all 40 Crypto assets. Its current snapshot feeds portfolio/accounting valuation and other canonical snapshot consumers. CoinGecko no longer supplies production Crypto history or Analysis V2.
- **Binance Spot**: Native `USDT` authority for realtime reference, completed daily OHLCV history, and Analysis V2 across 40 explicit Spot mappings (`BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `TRX`, `ZEC`, `DOGE`, `LINK`, `ADA`, `XLM`, `BCH`, `GRAM`, `LTC`, `HBAR`, `AVAX`, `SHIB`, `SUI`, `UNI`, `NEAR`, `TAO`, `PUMP`, `AAVE`, `ASTER`, `WLFI`, `ONDO`, `ENA`, `MORPHO`, `PEPE`, `DOT`, `WLD`, `ETC`, `POL`, `ATOM`, `JUP`, `APT`, `ARB`, `FET`, `INJ`, `FIL`). Realtime uses one shared server-side miniTicker stream WebSocket; history uses one shared multiplexed Binance WebSocket API connection for completed UTC daily klines, with cache, coalescing, stale fallback, and a circuit breaker. Binance `USDT` never becomes the canonical `USD` accounting quote.
- **Current VND Reference**: Asset Detail may display `≈VND` computed server-side from the Binance `USDT` observation and an explicit `USD/VND` rate. The result is marked approximate, reference-only, non-accounting, and non-historical; if FX is unavailable, the `USDT` quote remains available and the VND reference is omitted.
- **Alpha Vantage**:
  - Gold Spot snapshot and completed daily close-only history (`XAU/USD`) via `GOLD_SILVER_SPOT` with `symbol=XAU`. `UTC` daily calendar semantics; completed periods only; close-only.
  - Multi-asset global news acquisition (`NEWS_SENTIMENT` with broad topics `economy_macro,commodities,forex`) for Gold, FX, and global macroeconomic context. Upstream sentiment, sentiment labels, and relevance scores are strictly discarded.
  - Sanitized rate-limit / quota handling returning safe `PROVIDER_RATE_LIMITED` without exposing raw upstream marketing bodies or subscription URLs.
- **Twelve Data**: Direct `USD -> VND` FX exchange rate resolution. Current snapshot supported; history intentionally UNSUPPORTED because provider daily timezone boundary cannot currently be reconciled confidently with canonical asset timezone.
- **CafeF**: Official public RSS feeds for Vietnamese stock, company, macroeconomic, and international market news (4 feeds: `thi-truong-chung-khoan`, `doanh-nghiep`, `vi-mo-dau-tu`, `tai-chinh-quoc-te`).
- **CoinDesk**: Official public RSS feed for cryptocurrency news (`https://www.coindesk.com/arc/outboundfeeds/rss/`).

---

## CURRENT MULTI-ASSET INTEGRATION & FRONTEND CAPABILITIES (FEATURES 24–26)
- **Centralized Financial Formatter**: Exactly one authoritative formatting module (`client/src/utils/formatting.js`) managing native currency amounts (`formatNativeAmount`), market changes (`formatMarketChange`), market contexts (`formatMarketContext`), and asset types (`formatAssetType`).
- **Native Quote Currency Display Invariant**:
  - VN Stocks / ETFs: `VND`
  - Canonical Crypto valuation snapshots / portfolio accounting / alerts: `USD` via CoinGecko
  - Crypto realtime reference / completed history / Analysis V2: native `USDT` via Binance
  - Gold Spot (`XAU/USD`): `USD`
  - Portfolio Reporting Values: strictly `VND`
  - Zero hard-coded universal `₫`, `VND`, `USD`, `USDT`, or `HOSE`.
- **Capability-Aware History & Analysis**:
  - Range coverage (`5/5 kỳ có dữ liệu`) is strictly separated from metric capability (`Một số chỉ số nội ngày không áp dụng` when `ohlc = false`).
  - Legacy Feature 07 `Giai đoạn tăng giá: 0 / 0` presentation branch is retired; universal V2 metrics (range positions, distance below high, positive close transitions, daily volatility, max drawdown) are bound directly.
  - Completed history card badge displays *"Dữ liệu lịch sử đã hoàn tất"*; analysis badge displays *"Dựa trên dữ liệu đã hoàn tất"*.
- **Authoritative Multi-Asset Comparison**:
  - Direct consumption of backend `base100.series` across canonical common dates.
  - Zero client-side array-index matching, zero date borrowing, zero forward-filling, and zero synthetic interpolation.
  - Native quote currencies preserved in comparison table; raw prices across different currencies are not treated as directly comparable. Zero ranking, scoring, or recommendations.
- **Universal Watchlist & Dashboard**:
  - Column `THỊ TRƯỜNG` displays canonical market contexts (`HOSE`, `24/7`, `24/5`).
  - Stale universal `~15p` latency badges removed; replaced with provider-neutral wording: *"Dữ liệu theo thời điểm cập nhật của nhà cung cấp"*.
- **Price Alerts V1**:
  - Alert target price uses native `quote_currency` (e.g. `USD` for BTC, `VND` for FPT).
  - Informational notice clearly discloses: *"Cảnh báo được kiểm tra khi bạn làm mới dữ liệu trong ứng dụng. Thời điểm giá phụ thuộc nguồn dữ liệu của tài sản."*
- **Ledger Gating & Currency Notice**:
  - Transaction and Opening Position modals enforce VND-only trading authority before submit, with explicit visible informational banners: *"📌 Lưu ý: Hiện chỉ hỗ trợ ghi nhận giao dịch mua/bán cho tài sản định giá bằng VND."*

---

## FINANCIAL DEVELOPMENT BASELINE (CLEAN INITIAL STATE)
- Authoritative Holdings: 0 rows (clean first-use state)
- Authoritative Transactions: 0 rows
- Authoritative Position Opening Baselines: 0 rows
- Authoritative Cash Ledger: 0 rows (activation opening balance: 0 VND)
- Authoritative Current Cash: 0 VND
- Authoritative Watchlist: 0 rows
- Authoritative Price Alerts: 0 rows
- Remote Canonical Universe: 49 assets total (40 crypto, 7 VN stocks/ETFs, 1 gold spot, 1 FX context) across 5 verified market-data providers (89 provider mappings)

---

## COMPLETED FEATURES SUMMARY (01–29)

- **Features 01–03**: Asset Browser (`/api/assets`), Market Snapshot (delayed Yahoo Finance `/api/market/:symbol`), News Feed (CafeF RSS `/api/news`).
- **Feature 04**: Investor Profile (`GET`/`PUT /api/profile`), singleton enforcement, holdings management.
- **Feature 05**: Portfolio Overview (`/api/portfolio/overview`), on-demand full precision valuation, partial valuation handling, UI motion & visual tokens.
- **Feature 06**: Historical Price & Trend (`/api/market/:symbol/history`), standard ranges (`1W` to `1Y`), daily bars.
- **Feature 07**: Deterministic Asset Analysis (`/api/analysis/:symbol`), completed daily close lookback, breadth & range position metrics.
- **Feature 08**: Watchlist / Danh sách theo dõi (`/api/watchlist`), conflict-safe singleton tracking, failure-isolated market quotes.
- **Feature 09**: Personal Investment Dashboard / Tổng quan, cross-app overview, compact KPI summary, watchlist movers preview.
- **Feature 10**: Portfolio Composition & Concentration (`/api/portfolio/composition`), on-demand allocation, 2.5D Donut chart.
- **Feature 11**: Asset Comparison / So sánh tài sản, side-by-side deterministic metrics, normalized relative price chart.
- **Feature 12**: Price Alerts V1 / Cảnh báo giá (`/api/alerts`), one-shot lifecycle, deterministic batch evaluation.
- **Feature 13**: Personalized Relevant News / Tin của tôi (`/api/news/personalized`), dynamic holdings + watchlist token matching.
- **Feature 14**: Transaction Ledger / Sổ lệnh giao dịch (`/api/transactions`), immutable transaction log, atomic PostgreSQL RPC, weighted-average cost, realized P/L tracking.
- **Feature 15**: Cash / Capital Ledger / Sổ dòng tiền (`/api/cash/overview`, `/api/cash/ledger`, `/api/cash/deposit`, `/api/cash/withdraw`), atomic cash ledger, opening baseline, direct cash edit removed.
- **Feature 16**: Canonical Multi-Asset Foundation (authoritative asset UUID, decoupled provider mapping schema, VND transaction guard).
- **Feature 17**: Ledger Authority & Position Integrity (opening-position baselines without synthetic BUYs, locking upon subsequent trade, direct holdings DML denied).
- **Feature 18**: Market Provider Abstraction (provider-neutral snapshot/history boundary, adapter modularization).
- **Feature 19**: FX & Cross-Currency Valuation Foundation (VND universal reporting currency, decoupled native/reporting valuation, direct-to-VND conversion, partial valuation on missing FX, blocked non-VND transactions).
- **Feature 20**: Real Multi-Asset Providers & Controlled Universe (COMPLETE):
  - **20A**: Real Multi-Asset Provider Onboarding (Twelve Data FX, CoinGecko BTC/ETH/SOL, Alpha Vantage Gold Spot, Yahoo VN ETFs; 12 canonical assets total).
  - **20B**: Controlled Crypto Universe Expansion (Audited Top 100 Market Cap $\cap$ Top 100 24h Volume snapshot with deterministic exclusions; 40 liquid canonical crypto assets with explicit CoinGecko provider mappings).
- **Feature 21**: Asset-Class Market & Historical Semantics (COMPLETE):
  - Normalized multi-asset historical bar engine with asset-class specific calendar policies (`VN_EXCHANGE`, `CONTINUOUS_24_7`, `GLOBAL_24_5`).
  - Canonical calendar lookback windows (`1W`, `1M`, `3M`, `6M`, `1Y`) with current-date exclusivity.
  - Truthful representation: Yahoo OHLCV for VN equities/ETFs, Binance completed OHLCV for 40 cryptos (current authority after Feature 26), Alpha Vantage close-only for Gold Spot, explicit unsupported error for USD/VND history.
- **Feature 22**: Deterministic Analysis V2 (COMPLETE):
  - Provider-neutral quantitative analysis over completed canonical daily history with `methodologyVersion = "v2"`.
  - VN stocks and ETFs support completed-close and capability-dependent OHLC metrics; crypto and Gold Spot support universal completed-close metrics without fabricated OHLCV.
  - USD/VND analysis remains explicitly unsupported until trustworthy completed historical capability exists.
- **Feature 23**: Multi-Asset News Foundation (COMPLETE):
  - Ingestion across CafeF (4 feeds), CoinDesk RSS, and Alpha Vantage broad topic news with upstream sentiment/relevance scores strictly scrubbed.
  - Canonical UUID-authoritative relevance engine with ambiguous ticker protection.
  - In-memory caching with per-source TTLs, in-flight request coalescing, and stale-if-error fallback.
- **Feature 24**: Existing Feature Multi-Asset Integration (COMPLETE):
  - **24A**: Backend / Canonical Capability Integration (`e292f68`): Canonical CoinGecko USD snapshot authority, Binance Spot shared WebSocket realtime USDT reference for Asset Detail, and sanitized provider errors. Its CoinGecko history path was superseded by Feature 26.
  - **24B**: Frontend Capability-Aware Integration (`2e2edde`): Centralized native currency formatting, Base 100 common-date comparison, Analysis V2 presentation with clean coverage/capability separation, provider-neutral freshness badges, and VND-only ledger gating notices.
- **Feature 25**: Portfolio Performance & Benchmarking (COMPLETE):
  - Auditable portfolio performance engine, benchmark integration, and frontend performance dashboard (`dec06cd`, `34ec123`, `2c1be74`).
- **Feature 26**: Crypto Market Data Reliability & Hybrid Quote Authority (COMPLETE, implementation `d081fe8`, production backend `cf049da`, display-consistency closeout `5059467`):
  - CoinGecko remains canonical `USD` valuation-snapshot authority; Binance is native `USDT` realtime, completed daily OHLCV history, and Analysis V2 authority.
  - Exactly 40 explicit Binance Spot mappings and 40 CoinGecko valuation mappings cover the 40-asset Crypto universe; total active universe remains 49.
  - Migration `20260830000000_feature_26a_hybrid_crypto_authority.sql` is applied. Existing financial records are unchanged.
  - Asset Detail displays the Binance `USDT` current quote with an optional server-provided `≈VND` reference that is explicitly approximate and excluded from accounting.
- **Feature 27**: Vietnam Market Regime Foundation (COMPLETE, implementation `e38dcba`):
  - Official NSO CPI domain cross-checks archive publication/reference metadata against the official structured CPI chart series, exposes exact headline CPI YoY and three-month YoY delta when M and M-3 are available, and marks overdue official releases stale instead of presenting them as current.
  - Official SBV money-market domain exposes latest verified VND overnight interbank observation when parseable and derives 4-week trend only with 8 valid chronological official observations; otherwise it degrades to insufficient/unavailable without substitution.
  - Market breadth remains explicitly unavailable with reason `SOURCE_NOT_PROVISIONED`; no breadth is fabricated from the canonical asset universe.
- **Feature 28**: Deterministic Opportunity Engine (COMPLETE):
  - `GET /api/opportunities` produces transparent within-cohort descriptive ranking from completed Analysis V2 evidence, explicit capability states, and isolated profile/context information.
  - It introduces no database persistence, migration, opaque score, recommendation, prediction, confidence percentage, or cross-asset-class ranking.
- **Feature 29**: Guarded AI Investment Brief (COMPLETE):
  - `POST /api/investment-brief` generates an evidence-linked Vietnamese AI brief from deterministic portfolio, performance, composition, opportunity, regime, and personalized-news facts.
  - Live AI is disabled by default; deterministic fallback works without an API key. Live generation requires `AI_BRIEF_ENABLED=true` plus a configured server-side OpenAI key.
  - Cache and request budgets are process-local; no brief persistence, database migration, background generation, score, recommendation, prediction, or confidence percentage is introduced.
