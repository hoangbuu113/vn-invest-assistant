# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Commit**: `61ca0b9`
- **Branch**: `main`
- **Feature 22 Implementation Commit**: `61ca0b9`
- **Asset Explorer UI Patch Commit**: `ef694d2`
- **Automated Test Suite**:
  - Latest Full Backend Regression: 345/345 PASS (Features 01–22 complete test coverage)
- **Client Build**: Production build clean
- **Git Working Tree**: Clean
- **GitHub Remote**: No origin configured / remote state not verified (local git authority)

## CURRENT PHASE
MULTI-ASSET FOUNDATION, HISTORY & QUANTITATIVE ANALYSIS

## CURRENT NEXT PROJECT TASK
Feature 23 — Multi-Asset News Foundation. See `docs/ROADMAP.md`.

---

## PRODUCTION & LIVE PROVIDER VERIFIED PATHS
- **Yahoo Finance**: Vietnamese listed equities & exchange-traded ETFs (`VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`). Completed daily OHLCV history with `Asia/Ho_Chi_Minh` timezone semantics.
- **CoinGecko**: Cryptocurrency spot snapshots and completed daily close-only history (40 canonical assets: `BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `TRX`, `HYPE`, `ZEC`, `DOGE`, `RAIN`, `XMR`, `LINK`, `WBT`, `ADA`, `XLM`, `BCH`, `GRAM`, `LTC`, `HBAR`, `AVAX`, `SHIB`, `SUI`, `UNI`, `NEAR`, `TAO`, `PUMP`, `AAVE`, `ASTER`, `WLFI`, `ONDO`, `ENA`, `MORPHO`, `PEPE`, `DOT`, `WLD`, `ETC`, `POL`, `LIT`, `ATOM`, `JUP`) via explicit immutable coin IDs. `UTC` daily calendar semantics; completed periods only; close-only (`open`, `high`, `low`, `volume` are `null`).
- **Alpha Vantage**: Gold Spot snapshot and completed daily close-only history (`XAU/USD`) via `GOLD_SILVER_SPOT` with `symbol=XAU`. `UTC` daily calendar semantics; completed periods only; close-only.
- **Twelve Data**: Direct `USD -> VND` FX exchange rate resolution. Current snapshot supported; history intentionally UNSUPPORTED because provider daily timezone boundary cannot currently be reconciled confidently with canonical asset timezone.

## CURRENT PUBLIC HISTORY CAPABILITIES
- **Supported Ranges**: `1W`, `1M`, `3M`, `6M`, `1Y`
- **Range Semantics**: Canonical calendar lookback windows (`1W` = 7 days, `1M`/`3M`/`6M` = calendar months, `1Y` = calendar year) with upper bound strictly exclusive of the current uncompleted market date.
- **Analysis Invariant**: Feature 22 consumes completed canonical history and provider-neutral history capabilities; assets without trustworthy completed history remain explicitly unsupported.

## CURRENT FEATURE 22 ANALYSIS CAPABILITIES
- **Methodology**: `methodologyVersion = "v2"`; deterministic, metrics-only, and provider-neutral.
- **VN Stocks**: Supported with completed canonical daily history.
- **VN ETFs**: Supported with completed canonical daily history.
- **Crypto**: Supported with completed close-only canonical history.
- **Gold Spot (`XAU/USD`)**: Supported with completed close-only canonical history.
- **USD/VND FX**: Analysis unsupported because trustworthy completed historical series remains unavailable.
- **Interpretation Boundary**: No recommendation, score, confidence percentage, prediction, or forecast.

## ASSET BROWSER UI STATE
- Asset Browser is organized as a unified Asset Explorer grouped by asset class (`Cổ phiếu Việt Nam`, `ETF`, `Crypto`, `Vàng`, `Ngoại hối`).
- Top filter bar with live dynamic counts (`Tất cả`, `Cổ phiếu`, `ETF`, `Crypto`, `Vàng`, `Ngoại hối`) and integrated search.
- Compact Crypto preview (initial 8 items + expand/collapse CTA) in "Tất cả" view.
- Responsive mobile card rows without horizontal table overflow while preserving 5-column table layout on desktop.

## FINANCIAL DEVELOPMENT BASELINE
- Authoritative Holdings: 2 rows (`E1VFVN30`: 111,003 @ 35,000 VND; `FPT`: 12 @ 35,000 VND)
- Authoritative Transactions: 1 row (`SELL` `E1VFVN30`: 12,121 @ 40,000 VND)
- Authoritative Cash Ledger: 3 rows (`OPENING_BALANCE`: 100,000,000; `SELL`: 484,840,000; `DEPOSIT`: 21,212,112)
- Authoritative Current Cash: 606,052,112 VND
- Remote Canonical Universe: 49 assets total (40 crypto, 7 VN stocks/ETFs, 1 gold spot, 1 FX context) across 4 verified providers

---

## COMPLETED FEATURES SUMMARY (01–22)

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
  - Truthful representation: Yahoo OHLCV for VN equities/ETFs, CoinGecko close-only for 40 cryptos, Alpha Vantage close-only for Gold Spot, explicit unsupported error for USD/VND history. Missing candle fields are preserved as `null`.
- **Feature 22**: Deterministic Analysis V2 (COMPLETE):
  - Provider-neutral quantitative analysis over completed canonical daily history with `methodologyVersion = "v2"`.
  - VN stocks and ETFs support completed-close and capability-dependent OHLC metrics; crypto and Gold Spot support universal completed-close metrics without fabricated OHLCV.
  - USD/VND analysis remains explicitly unsupported until trustworthy completed historical capability exists.
