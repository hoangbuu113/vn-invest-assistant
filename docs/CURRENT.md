# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `20ae997`
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

## CURRENT STATE
Feature 06 (Historical Price & Trend) is complete and verified at checkpoint `20ae997`.

