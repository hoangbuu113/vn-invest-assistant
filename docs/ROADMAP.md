# Project Strategic Roadmap & Execution Policy

This document serves as the durable strategic memory for project sequencing, feature dependencies, token/verification policies, and release milestones for the VN Invest Assistant.

---

## 1. Document Roles & Hierarchy

- **`docs/ROADMAP.md`**: Strategic memory, long-term feature sequencing, verification policy, and batching strategy.
- **`docs/CURRENT.md`**: Live operational state, immediate checkpoint, active task, and recent completed summaries.
- **`docs/DECISIONS.md`**: Authoritative, durable architectural and product decisions.
- **`docs/ASSET_MODEL.md`**: Cross-feature contract for multi-asset identity, calendars, prices, FX, and ledger authority.
- **`docs/PROJECT.md`**: Core product identity, target audience, stack, and non-goals.

---

## 2. Completed Historical V1 Features (01–30)

All 30 planned V1 roadmap features have been designed, implemented, hardened, and verified:

- **Feature 01**: Asset Browser (`/api/assets`)
- **Feature 02**: Market Snapshot (`/api/market/:symbol`)
- **Feature 03**: News Feed (`/api/news`)
- **Feature 04**: Investor Profile (`/api/profile`)
- **Feature 05**: Portfolio Overview (`/api/portfolio/overview`)
- **Feature 06**: Historical Price & Trend (`/api/market/:symbol/history`)
- **Feature 07**: Deterministic Asset Analysis (`/api/analysis/:symbol`)
- **Feature 08**: Watchlist / Danh sách theo dõi (`/api/watchlist`)
- **Feature 09**: Personal Investment Dashboard / Tổng quan
- **Feature 10**: Portfolio Composition & Concentration (`/api/portfolio/composition`)
- **Feature 11**: Asset Comparison / So sánh tài sản (`base100.series`)
- **Feature 12**: Price Alerts V1 / Cảnh báo giá (`/api/alerts`)
- **Feature 13**: Personalized Relevant News / Tin của tôi (`/api/news/personalized`)
- **Feature 14**: Transaction Ledger / Sổ lệnh giao dịch (`/api/transactions`)
- **Feature 15**: Cash / Capital Ledger / Sổ dòng tiền (`/api/cash/*`)
- **Feature 16**: Canonical Multi-Asset Foundation
- **Feature 17**: Ledger Authority & Position Integrity
- **Feature 18**: Market Provider Abstraction
- **Feature 19**: FX & Cross-Currency Valuation Foundation
- **Feature 20**: Real Multi-Asset Providers & Controlled Universe (49 canonical assets)
  - **Feature 20A**: Representative Real Multi-Asset Providers
  - **Feature 20B**: Controlled Crypto Universe Expansion
- **Feature 21**: Asset-Class Market & Historical Semantics (`VN_EXCHANGE`, `CONTINUOUS_24_7`, `GLOBAL_24_5`)
- **Feature 22**: Deterministic Asset Analysis V2 (`methodologyVersion = "v2"`)
- **Feature 23**: Multi-Asset News Foundation (CafeF, CoinDesk, Alpha Vantage)
- **Feature 24**: Existing Feature Multi-Asset Integration
  - **Feature 24A**: Backend / Canonical Capability Integration
  - **Feature 24B**: Frontend Capability-Aware Integration
- **Feature 25**: Portfolio Performance & Benchmarking
- **Feature 26**: Crypto Market Data Reliability & Hybrid Quote Authority (CoinGecko USD + Binance USDT)
- **Feature 27**: Vietnam Market Regime Foundation (NSO CPI, SBV money market, unprovisioned market breadth)
- **Feature 28**: Deterministic Opportunity Engine (`GET /api/opportunities`)
- **Feature 29**: Guarded AI Investment Brief (`POST /api/investment-brief`)
- **Feature 30**: Release Hardening & Production Gate

---

## 3. V1.1 Production Improvements (Post-V1 Architecture Upgrades)

Post-V1 engineering is structured as targeted **V1.1 Improvements** (NOT Feature 31+):

### V1.1 Improvement 12: Web Push Alert Delivery Engine
- **Scope**: Transitioned price alerts from refresh-only evaluation to background scheduler evaluation (Cloudflare Worker cron `*/15 * * * *` -> `POST /api/internal/alerts/evaluate` with `ALERT_SCHEDULER_TOKEN`).
- **Engine**: First-party Web Push delivery engine (`web-push`, RFC 8291 / RFC 8292).
- **Per-Device Delivery**: Multi-device subscriptions (`public.push_subscriptions`) with fanout deliveries (`public.alert_notification_deliveries`).
- **Resilience**: Bounded retry (up to 3 attempts, 15m backoff, automatic cleanup of 404/410 expired subscriptions).
- **Delivery Semantics**: Push service acceptance (`sent`) verified; best-effort display without unrealistic delivery guarantees.

### V1.1 Improvement 13: Public Multi-User Supabase Authentication & Profile Isolation
- **Scope**: Replaced single-owner access control with public multi-user Supabase Auth (email/password).
- **Retirement**: Completely retired `OwnerGate`, `OWNER_ACCESS_TOKEN` browser auth, HMAC session tokens, and session cookies (`vn_invest_owner_session`).
- **Isolation**: Each authenticated user maps 1:1 to an isolated `investor_profile` (`user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id)`).
- **Clean Start**: Every new user starts with `cash_available = 0`, 0 holdings, 0 transactions, and 0 synthetic records.
- **Cleanup**: The unowned 20,000,000 VND legacy profile was treated as disposable test data and permanently purged.

### V1.1 Improvement 19 & 25: Cross-Currency Accounting Foundation
- **Scope**: Dual-settlement VND-basis cross-currency accounting foundation.
- **Valuation**: Crypto and Gold spot current VND valuations operate through current USD/VND authority.
- **Historical Invariant**: Historical non-VND portfolio performance remains truthfully unavailable when historical FX authority is missing.

### V1.1 Improvement 27: Macro & Regime Hardening
- **Scope**: CPI reliability improvements active (NSO CPI archive cross-checks).
- **Truthful Degradation**: SBV money-market rates remain truthfully unavailable under upstream WAF (`OFFICIAL_DATA_UNAVAILABLE`) without fabricating fake interest rates.
- **Market Breadth**: Retained as `NOT_DEFENSIBLE_FOR_V1.1` (`status: 'unavailable'`, `reason: 'SOURCE_NOT_PROVISIONED'`).

---

## 4. Product Purpose & Non-Goals

- **Core Product Purpose**: Public multi-asset market intelligence and tracking showcase application.
- **Supporting Role**: Portfolio accounting is a supporting capability within the broader market intelligence workflow.
- **Non-Goals**:
  - Direct broker execution or automated trading.
  - Opaque speculative trading signals or fabricated confidence scores.
  - Fabricating rates when official data sources degrade or block under WAF.
  - Multi-hop FX conversions without authoritative rate sources.

---

## 5. Token & Cost Efficiency Policy

### Verification Tiers
- **LOW RISK**: Targeted UI checks, client build (`npm run build`).
- **MEDIUM RISK**: Affected route/unit tests, integration check, client build, git diff check.
- **HIGH RISK**: Full regression suite (`npm test`), migration history verification, remote database state checks, `git diff --check`.

### Golden Regression Batching
Comprehensive cross-feature golden regression tests are executed at strategic intervals:
- At major phase boundaries.
- Prior to production releases.
- Immediately following any change to core financial invariants.
