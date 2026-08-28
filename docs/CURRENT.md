# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `2dbdf2cb788e83f78b173fc8976083fb99de1041`
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
Pre-Feature-07 hardening is complete and verified at checkpoint `2dbdf2cb788e83f78b173fc8976083fb99de1041`.
Feature 07 (Opportunities & Ranking Engine) is **READY TO START**.

