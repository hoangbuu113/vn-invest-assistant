# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `b4a89ac`
- **Branch**: `main`

## CURRENT PHASE
BUILD

## COMPLETED FEATURES
- **Feature 01 — Asset Browser**
  - Real asset list (`GET /api/assets`)
  - Single asset detail (`GET /api/assets/:symbol`)
- **Feature 02 — Market Snapshot**
  - Delayed market snapshot via Yahoo Finance (`GET /api/market/:symbol`)
  - Snapshot UI displaying price, change, volume, high/low, last updated time
  - Manual and 5-minute automatic snapshot refresh
- **Feature 03 — News Feed**
  - Real CafeF RSS integration across 4 categories (`GET /api/news`)
  - Deterministic investment relevance filtering (removes accidents, crime, lifestyle, and non-financial noise)
  - Polished News Feed UI with loading, error, and empty states
  - Manual news refresh control
- **Feature 04 — Investor Profile**
  - Core single-user investor profile with real Supabase persistence (`GET`/`PUT /api/profile`)
  - Profile preferences: available investment cash (`cash_available`), risk tolerance (`risk_tolerance`: `low`/`moderate`/`high`), and horizon (`investment_horizon`: `short`/`medium`/`long`)
  - Current asset portfolio holdings management with server validation (`GET`/`POST`/`PUT`/`DELETE /api/holdings`)
  - Vietnamese localized user interface ("Hồ sơ đầu tư" & "Danh mục hiện có") with full CRUD support
- **Feature 05 — Portfolio Overview**
  - Portfolio overview endpoint (`GET /api/portfolio/overview`) combining investor profile + holdings + delayed market prices
  - Calculates cost basis, market value, unrealized P/L and total portfolio value on demand
  - Supports partial valuation when some market prices are unavailable
  - Derived portfolio metrics are computed on demand, not persisted
  - UI System Upgrade (Passes 1–5: design token system, motion & depth, interactive 3D constellation orb, magnetic controls, market ticker, and wealth orbit) complete
- **Feature 06 — Historical Price & Trend**
  - Daily historical price API endpoint (`GET /api/market/:symbol/history?range=...`)
  - Supported V1 ranges: `1W`, `1M`, `3M`, `6M`, `1Y`
  - Daily interval only (`1d`)
  - Yahoo Finance remains the historical data source
  - Historical bars are fetched and calculated on demand
  - No historical-price warehouse is persisted
  - Asset Detail includes interactive historical price chart and period summary (start price, latest price, absolute change, % change, period high, period low)
  - Data remains labeled as delayed with latest timestamp
- **Feature 07 — Deterministic Asset Analysis**
  - Dedicated asset analysis endpoint (`GET /api/analysis/:symbol`)
  - Analyzes completed historical daily bars across 5 standard lookback windows (`1W`, `1M`, `3M`, `6M`, `1Y`)
  - Shared authoritative `analysisPrice` and `analysisAsOf` from the last completed daily close (excludes current-day Vietnam calendar session)
  - Full precision metrics: `priceChangePct`, `rangePositionPct`, `distanceBelowHighPct`, `validSessionCount`
  - Cross-period positive breadth ratio (`crossPeriod`) and descriptive data completeness assessment (`dataCompleteness`)
  - Market snapshot context kept strictly separated without polluting historical calculations
  - Pure deterministic quantitative engine with explicit `options.now` contract (no hidden system clocks)
  - Asset Detail "Phân tích tài sản" UI: 5-period scannable view, interactive tabs, animated range position track & dot, breadth indicator, comparison table, methodology transparency disclosure, and non-alarming disclaimer
  - All 106 automated tests passing
- **Feature 08 — Watchlist / Danh sách theo dõi**
  - Minimal persistent watchlist table `public.watchlist_items` (`profile_id`, `asset_id`, `created_at`, unique per profile-asset)
  - Dedicated Supabase migration applied (`supabase/migrations/20260828083000_create_watchlist_items_table.sql`)
  - Backend endpoints: `GET /api/watchlist`, `POST /api/watchlist`, `DELETE /api/watchlist/:assetId`
  - Strictly scoped to singleton investor profile (client `profile_id` ignored)
  - Conflict-safe and idempotent additions; deterministic removals
  - Asset Detail compact toggle action: "＋ Theo dõi" / "✓ Đang theo dõi" with loading state and double-click prevention
  - Watchlist page ("Theo dõi") with failure-isolated delayed market snapshots ("Chưa có dữ liệu giá" on failure), empty state, quick view action, and removal action
  - 121/121 automated tests passing
- **Feature 09 — Personal Investment Dashboard / Tổng quan**
  - Main landing dashboard ("Tổng quan") coordinating cross-app data
  - Single compact portfolio summary card with cash, total value, unrealized P/L, and holding count directly derived from real holdings collection
  - Side-by-side "Đang theo dõi" section with descriptive watchlist movers highlights ("Biến động nổi bật") and up to 5 followed assets
  - Balanced 4-column responsive news preview with localized Vietnamese category chips (`Vĩ mô`, `Thị trường`, `Doanh nghiệp`, `Quốc tế`)
  - Parallel client data coordination with section-level failure isolation and global background refresh
  - 127/127 automated tests passing
- **Feature 10 — Portfolio Composition & Concentration**
  - Dedicated composition endpoint (`GET /api/portfolio/composition`) derived purely on demand from portfolio overview valuation without re-fetching or recomputing pricing.
  - Objective allocation basis: `full_portfolio_value`, `known_value_only`, `cash_only`, or `no_known_value`.
  - Explicit valuation coverage: `complete`, `partial`, `unavailable`, `not_applicable`.
  - Holding allocations, asset-type group aggregations, largest holding, and top-3 concentration percentages.
  - Descriptive "Cơ cấu danh mục" UI in Portfolio page featuring interactive 2.5D Donut, clear numeric legends, unpriced holding visibility, and non-redundant concentration metrics.
  - Backend checkpoint `36fc24e`, UI checkpoint `a3ddedf`.
- **Feature 11 — Asset Comparison / So sánh tài sản**
  - Dedicated Vietnamese comparison view ("So sánh tài sản") accessible via clean secondary action from the Tài sản page.
  - Side-by-side comparison supporting 2 to 4 assets with duplicate prevention and search selection.
  - Shared period lookback (`1W`, `1M`, `3M`, `6M`, `1Y`) synchronizing deterministic metrics across all compared assets simultaneously.
  - Reuses existing verified endpoints (`GET /api/assets`, `GET /api/market/:symbol`, `GET /api/analysis/:symbol`, `GET /api/market/:symbol/history`) without formula modification or client-side recalculation.
  - Deterministic metrics displayed: Giá gần nhất, Biến động giá, Khoảng giá, Vị trí trong vùng giá (`rangePositionPct` slider track: `Thấp ───────●──── Cao`), Cách đỉnh giai đoạn (`distanceBelowHighPct`), Số phiên dữ liệu, Giai đoạn tăng giá (`crossPeriod`), and Mức độ đầy đủ dữ liệu (`dataCompleteness`).
  - Base-100 normalized relative price chart ("Diễn biến giá tương đối — mốc đầu kỳ = 100").
  - Pure descriptive comparison without scoring, ranking, winner/loser labels, or BUY/SELL/HOLD advice.
  - Full per-asset failure isolation and stale-response protection with `AbortController`.
  - 147/147 automated tests passing.
- **Feature 12 — Price Alerts V1 / Cảnh báo giá**
  - Minimal persistent price alerts table `public.price_alerts` (`profile_id`, `asset_id`, `direction`, `target_price`, `status`, `last_evaluated_price`, `last_evaluated_at`, `triggered_at`, `created_at`).
  - Dedicated Supabase migration applied (`supabase/migrations/20260828110000_create_price_alerts_table.sql`) with unique constraint on `(profile_id, asset_id, direction, target_price)`.
  - Backend endpoints: `GET /api/alerts`, `POST /api/alerts`, `DELETE /api/alerts/:id`, `POST /api/alerts/evaluate`, `POST /api/alerts/:id/reactivate`.
  - Pure deterministic evaluation engine in `server/src/alerts.js` with batch evaluation and failure isolation across assets.
  - Strict condition semantics: `above` triggers when `latestPrice >= targetPrice`, `below` triggers when `latestPrice <= targetPrice`.
  - One-shot lifecycle: `active` -> `triggered` upon explicit app evaluation. Triggered alerts persist and can be manually reactivated.
  - Compact modal ("Đặt cảnh báo giá") accessible from Asset Detail and Watchlist.
  - Dedicated Alert Center section ("Cảnh báo giá") featuring summary KPI cards, simplified tabs (Tất cả, Đang hoạt động, Đã kích hoạt), manual evaluation control ("⚡ Kiểm tra cảnh báo"), price evaluation context, and clear ~15m delay disclosure.
  - 166/166 automated tests passing.

## PRE-FEATURE-07 HARDENING (COMPLETED)
- **Historical Market Normalization Hardened** (Patch 06-2, checkpoint `d38ee60`): Deterministic deduplication, exact fractional volumes, robust boundary handling, clean null propagation for missing OHLCV.
- **Market Snapshot & Portfolio Integrity Hardened** (Patch A, checkpoint `8aa4e36`):
  - Strict numeric and timestamp validation; missing source timestamps remain null and are never substituted with server/request time.
  - Unavailable prices/percentages remain unavailable, never fabricated as zero.
  - Derived portfolio valuation calculations use full precision without intermediate rounding.
  - Stale frontend market/history responses are cancelled/guarded to prevent race conditions.
- **Investor Profile & Holdings Integrity Hardened** (Patch B/B1/B2/B3, checkpoint `2dbdf2cb788e83f78b173fc8976083fb99de1041`):
  - Investor profile singleton invariant is enforced at database level (`singleton_key SMALLINT NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE`) with reproducible Supabase migration (`supabase/migrations/20260827122345_add_investor_profile_singleton_key.sql`).
  - Strict uncoerced finite JSON numeric validation (no `Number(...)` coercion).
  - Strict enum validation for `risk_tolerance` and `investment_horizon`.
  - Holdings operations (`GET`, `POST`, `PUT`, `DELETE`) are strictly scoped to the singleton profile.
  - Correct error semantics: asset not-found returns client 400, while database/provider query failures propagate as 500.
  - Default server automated tests are fully isolated from real Supabase and exercise actual production-path query predicates.

## CURRENT STATE
Feature 12 (Price Alerts V1 / Cảnh báo giá) is **COMPLETE** (checkpoint `f9eb5ca`, 166/166 tests PASS, client build clean).
The next feature has not been selected yet; awaiting Project Director decision.
