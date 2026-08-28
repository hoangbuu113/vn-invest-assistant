# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `caf1414`
- **Branch**: `main`
- **Feature 19 Commit**: `7a2129d`
- **Feature 20A Commit**: `caf1414`
- **Automated Test Suite**:
  - Latest Full Backend Regression: 265/265 PASS (at Feature 19 high-risk gate)
  - Feature 20A Targeted Final Gate: 25/25 PASS + Live End-to-End Application & Provider Verification
- **Client Build**: Production build clean
- **Git Working Tree**: Clean
- **GitHub Remote**: No origin configured / remote state not verified (local git authority)

## CURRENT PHASE
MULTI-ASSET FOUNDATION & UNIVERSE

## CURRENT NEXT PROJECT TASK
Feature 20B — Controlled Crypto Universe Expansion (expanding toward Top 40 liquid crypto assets with explicit CoinGecko IDs). See `docs/ROADMAP.md`.

---

## PRODUCTION & LIVE PROVIDER VERIFIED PATHS
- **Yahoo Finance**: Vietnamese listed equities & exchange-traded ETFs (`VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`)
- **CoinGecko**: Cryptocurrency spot snapshots (`BTC`, `ETH`, `SOL`) via explicit immutable coin IDs (`bitcoin`, `ethereum`, `solana`)
- **Alpha Vantage**: Gold Spot snapshot (`XAU/USD`) via `GOLD_SILVER_SPOT` with `symbol=XAU`
- **Twelve Data**: Direct `USD -> VND` FX exchange rate resolution

## FINANCIAL DEVELOPMENT BASELINE
- Authoritative Holdings: 2 rows (`E1VFVN30`: 111,003 @ 35,000 VND; `FPT`: 12 @ 35,000 VND)
- Authoritative Transactions: 1 row (`SELL` `E1VFVN30`: 12,121 @ 40,000 VND)
- Authoritative Cash Ledger: 3 rows (`OPENING_BALANCE`: 100,000,000; `SELL`: 484,840,000; `DEPOSIT`: 21,212,112)
- Authoritative Current Cash: 606,052,112 VND
- Remote Canonical Universe: 12 assets total across 4 verified asset classes

---

## COMPLETED FEATURES SUMMARY (01–20A)

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
- **Feature 19**: FX & Cross-Currency Valuation Foundation:
  - Universal reporting currency is strictly `VND`.
  - Native valuation and VND reporting valuation are decoupled.
  - VND assets bypass FX; non-VND assets require exact direct `quoteCurrency -> VND` quote.
  - Missing/unavailable FX produces explicit `valuationStatus: 'partial'`, never 1:1 fallback or fake 0s.
  - Non-VND cost basis and unrealized P/L remain unavailable until acquisition-time FX accounting exists.
- **Feature 20A**: Representative Real Multi-Asset Providers:
  - Integrated production providers: Twelve Data (FX `USD/VND`), CoinGecko (`BTC`, `ETH`, `SOL`), Alpha Vantage (`XAU/USD` Gold Spot), Yahoo Finance (`FUEVFVND`, `FUESSVFL`).
  - Migration applied remotely: 12 canonical assets total, 12 explicit provider mappings, zero duplicate symbols.
  - Preserved original 5 canonical UUIDs and financial development state.
  - Explicit unsupported history status for crypto and gold until Feature 21.
  - Non-VND BUY/SELL remains strictly blocked at database trigger level.
