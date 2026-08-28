# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `cec1971`
- **Branch**: `main`
- **Feature 19 Commit**: `7a2129d`
- **Feature 20A Commit**: `caf1414`
- **Feature 20B Commit**: `cec1971`
- **Automated Test Suite**:
  - Latest Full Backend Regression: 265/265 PASS (at Feature 19 high-risk gate)
  - Feature 20B Targeted Final Gate: 52/52 PASS + Live End-to-End Application & Remote Provider Verification
- **Client Build**: Production build clean
- **Git Working Tree**: Clean
- **GitHub Remote**: No origin configured / remote state not verified (local git authority)

## CURRENT PHASE
MULTI-ASSET FOUNDATION & UNIVERSE

## CURRENT NEXT PROJECT TASK
Feature 21 — Asset-Class Market & Historical Semantics (class-specific calendar rules, trading session hours, 24/7 crypto candles, NAV strike points, and bar completion logic). See `docs/ROADMAP.md`.

---

## PRODUCTION & LIVE PROVIDER VERIFIED PATHS
- **Yahoo Finance**: Vietnamese listed equities & exchange-traded ETFs (`VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`)
- **CoinGecko**: Cryptocurrency spot snapshots (40 canonical assets: `BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `TRX`, `HYPE`, `ZEC`, `DOGE`, `RAIN`, `XMR`, `LINK`, `WBT`, `ADA`, `XLM`, `BCH`, `GRAM`, `LTC`, `HBAR`, `AVAX`, `SHIB`, `SUI`, `UNI`, `NEAR`, `TAO`, `PUMP`, `AAVE`, `ASTER`, `WLFI`, `ONDO`, `ENA`, `MORPHO`, `PEPE`, `DOT`, `WLD`, `ETC`, `POL`, `LIT`, `ATOM`, `JUP`) via explicit immutable coin IDs
- **Alpha Vantage**: Gold Spot snapshot (`XAU/USD`) via `GOLD_SILVER_SPOT` with `symbol=XAU`
- **Twelve Data**: Direct `USD -> VND` FX exchange rate resolution

## FINANCIAL DEVELOPMENT BASELINE
- Authoritative Holdings: 2 rows (`E1VFVN30`: 111,003 @ 35,000 VND; `FPT`: 12 @ 35,000 VND)
- Authoritative Transactions: 1 row (`SELL` `E1VFVN30`: 12,121 @ 40,000 VND)
- Authoritative Cash Ledger: 3 rows (`OPENING_BALANCE`: 100,000,000; `SELL`: 484,840,000; `DEPOSIT`: 21,212,112)
- Authoritative Current Cash: 606,052,112 VND
- Remote Canonical Universe: 49 assets total (40 crypto, 7 VN stocks/ETFs, 1 gold spot, 1 FX context) across 4 verified providers

---

## COMPLETED FEATURES SUMMARY (01–20)

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
  - **20B**: Controlled Crypto Universe Expansion (Audited Top 100 Market Cap $\cap$ Top 100 24h Volume snapshot with deterministic exclusions; expanded to exactly 40 liquid canonical crypto assets with explicit CoinGecko provider mappings, fail-fast migration identity preflight assertions, and preserved financial baseline).
