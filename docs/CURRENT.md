# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `4608ddc`
- **Branch**: `main`
- **Feature 15 Backend Checkpoint**: `7fa3c7a`
- **Feature 15 UI Checkpoint**: `4608ddc`
- **Automated Test Suite**: 219/219 PASS
- **Client Build**: Production build clean
- **Git Working Tree**: Clean at baseline

## CURRENT PHASE
REBASELINE / MULTI-ASSET FOUNDATION PREPARATION

## CURRENT NEXT PROJECT TASK
Documentation reconciliation, then canonical multi-asset foundation.

---

## COMPLETED FEATURES SUMMARY (01–15)

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
- **Feature 15**: Cash / Capital Ledger / Sổ dòng tiền (`/api/cash/overview`, `/api/cash/ledger`, `/api/cash/deposit`, `/api/cash/withdraw`):
  - Immutable cash ledger table `public.cash_ledger_entries`.
  - Opening cash baseline preserving pre-Feature-15 balance without fabricated historical transactions.
  - DEPOSIT and WITHDRAWAL movements.
  - BUY cash outflow and SELL cash inflow reconciled atomically with transaction and holding mutations in PostgreSQL.
  - Current cash is strictly ledger-authoritative; profile cash field serves only as a synchronized read cache.
  - Frontend cash management UI in Portfolio ("Danh mục") with overview, deposit/withdraw modals, and filterable ledger history.
  - Direct cash editing removed from "Hồ sơ đầu tư" (profile form submits non-cash preferences only).
