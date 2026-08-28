# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `c2f75f6`
- **Branch**: `main`
- **Feature 16 Commit**: `c2f75f6`
- **Automated Test Suite**: 232/232 PASS
- **Client Build**: Production build clean
- **Git Working Tree**: Clean at baseline

## CURRENT PHASE
MULTI-ASSET FOUNDATION

## CURRENT NEXT PROJECT TASK
Feature 17 — Ledger Authority & Position Integrity (architecture approved; implementation next). See `docs/ROADMAP.md`.

---

## COMPLETED FEATURES SUMMARY (01–16)

- **Features 01–03**: Asset Browser (`/api/assets`), Market Snapshot (delayed Yahoo Finance `/api/market/:symbol`), News Feed (CafeF RSS `/api/news`).
- **Feature 04**: Investor Profile (`GET`/`PUT /api/profile`), singleton enforcement, holdings management (`GET`/`POST`/`PUT`/`DELETE /api/holdings`).
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
- **Feature 16**: Canonical Multi-Asset Foundation (COMPLETE):
  - Canonical asset UUID (`assets.id`) remains the authoritative internal asset identity.
  - Canonical asset metadata now includes `market_code`, `quote_currency`, `base_currency`, `market_policy`, `market_timezone`, `quantity_unit`, and `is_active`.
  - Provider-specific identity is cleanly decoupled via `public.asset_provider_mappings`.
  - Five existing VN assets (`E1VFVN30`, `FPT`, `HPG`, `VCB`, `VNM`) migrated in place with stable UUIDs and verified Yahoo `.VN` mappings.
  - Implicit `.VN` inference removed from market code; unknown assets without mappings fail safely.
  - VN market snapshot and historical bar behavior preserved through explicit provider mappings.
  - Non-VND BUY/SELL transactions blocked at database level until multi-currency FX accounting exists.
  - No gold/FX/crypto production assets onboarded yet (foundation preparation).
  - 100% of existing financial and user state (holdings, transactions, cash ledger, watchlist, alerts) preserved.
