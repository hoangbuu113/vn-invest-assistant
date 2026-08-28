# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `b83f75e`
- **Branch**: `main`
- **Feature 17 Backend Commit**: `ef0b936`
- **Feature 17 Frontend Commit**: `0fe8441`
- **Feature 18 Commit**: `b83f75e`
- **Automated Test Suite**:
  - Latest Full Backend Regression: 246/246 PASS (at Feature 17 high-risk gate)
  - Feature 18 Targeted Verification: 107/107 + 60/60 PASS
- **Client Build**: Production build clean
- **Git Working Tree**: Clean
- **GitHub Remote**: No origin configured / remote state not verified (local git authority)

## CURRENT PHASE
MULTI-ASSET FOUNDATION

## CURRENT NEXT PROJECT TASK
Feature 19 — FX & Cross-Currency Valuation Foundation (HIGH-RISK architecture/integrity audit next). See `docs/ROADMAP.md`.

---

## COMPLETED FEATURES SUMMARY (01–18)

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
- **Feature 16**: Canonical Multi-Asset Foundation:
  - Canonical asset UUID (`assets.id`) remains the authoritative internal asset identity.
  - Canonical asset metadata schema (`market_code`, `quote_currency`, `base_currency`, `market_policy`, `market_timezone`, `quantity_unit`, `is_active`).
  - Provider-specific identity decoupled via `public.asset_provider_mappings`.
  - Five existing VN assets (`E1VFVN30`, `FPT`, `HPG`, `VCB`, `VNM`) migrated with stable UUIDs and verified Yahoo `.VN` mappings.
- **Feature 17**: Ledger Authority & Position Integrity:
  - Immutable Transaction Ledger is the authoritative source of truth for ongoing position mutations; `holdings` is a synchronized projection/read model.
  - Dedicated opening-position baseline flow (`public.position_opening_baselines`, `POST /api/positions/opening`, `PATCH /api/positions/opening/:id`, `POST /api/positions/opening/:id/cancel`) for already-owned assets without creating BUY transactions or cash movements.
  - Baseline correction/cancellation locked upon first subsequent BUY/SELL transaction.
  - Legacy public holdings mutation REST endpoints retired (`POST`/`PUT`/`DELETE /api/holdings`); application-role direct DML on `holdings` table denied by PostgreSQL permissions.
  - Existing mixed legacy position (`E1VFVN30`: `111,003` @ `35,000` VND) preserved alongside historical SELL record without synthetic history fabrication.
- **Feature 18**: Market Provider Abstraction:
  - Market snapshot and history consumers decoupled behind a provider-neutral adapter contract (`server/src/market.js`).
  - Yahoo Finance-specific URLs, headers, response parsing, and error mapping encapsulated in dedicated adapter (`server/src/providers/yahoo.js`).
  - Market data acquisition routed strictly through canonical asset + `public.asset_provider_mappings` with zero implicit `.VN` inference.
  - Architecture ready for future non-equity providers without altering market consumers.
