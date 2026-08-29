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

## 2. Completed Features (01–23)

- **Feature 01**: Asset Browser
- **Feature 02**: Market Snapshot
- **Feature 03**: News Feed
- **Feature 04**: Investor Profile
- **Feature 05**: Portfolio Overview
- **Feature 06**: Historical Price & Trend
- **Feature 07**: Deterministic Asset Analysis
- **Feature 08**: Watchlist / Danh sách theo dõi
- **Feature 09**: Personal Investment Dashboard / Tổng quan
- **Feature 10**: Portfolio Composition & Concentration
- **Feature 11**: Asset Comparison / So sánh tài sản
- **Feature 12**: Price Alerts V1 / Cảnh báo giá
- **Feature 13**: Personalized Relevant News / Tin của tôi
- **Feature 14**: Transaction Ledger / Sổ lệnh giao dịch
- **Feature 15**: Cash / Capital Ledger / Sổ dòng tiền
- **Feature 16**: Canonical Multi-Asset Foundation
- **Feature 17**: Ledger Authority & Position Integrity
- **Feature 18**: Market Provider Abstraction
- **Feature 19**: FX & Cross-Currency Valuation Foundation (COMPLETE)
- **Feature 20**: Real Multi-Asset Providers & Controlled Universe (COMPLETE)
  - **Feature 20A**: Representative Real Multi-Asset Providers (COMPLETE)
  - **Feature 20B**: Controlled Crypto Universe Expansion (COMPLETE)
- **Feature 21**: Asset-Class Market & Historical Semantics (COMPLETE)
- **Feature 22**: Deterministic Asset Analysis V2 (COMPLETE)
- **Feature 23**: Multi-Asset News Foundation (COMPLETE)

---

## 3. Current Next Feature: Feature 24

### Feature 24 — Existing Feature Multi-Asset Integration
- **Status**: NEXT IN SEQUENCE.
- **Scope**: Adapt Dashboard, Watchlist, Portfolio Overview, Portfolio Composition, Asset Comparison, and Price Alerts to render and handle canonical multi-asset records and mixed portfolios cleanly without breaking single-asset assumptions.

---

## 4. Ordered Roadmap (Features 24–30)

- **Feature 24 — Existing Feature Multi-Asset Integration (NEXT)**: Adapt Dashboard, Watchlist, Portfolio, Composition, Comparison, and Alerts to support multi-asset rendering cleanly.
- **Feature 25 — Portfolio Performance & Benchmarking**: Auditable capital-weighted returns (TWR/MWR), realized/unrealized P/L performance tracking, drawdowns, and benchmark comparison (VN-Index, S&P 500).
- **Feature 26 — Risk & Exposure Analytics**: Multi-dimensional portfolio risk analysis (asset class, currency, sector, concentration risk, historical drawdown, volatility).
- **Feature 27 — Market Regime Engine**: Deterministic macro and market regime indicators (interest rate environment, inflation trends, market breadth).
- **Feature 28 — Opportunity Engine**: Evidence-driven screening and candidate ranking based on transparent quantitative rules and user profile fit.
- **Feature 29 — AI Investment Brief**: Deterministic-first AI synthesis explaining evidence, portfolio risks, macro factors, and scenario uncertainty without inventing financial scores.
- **Feature 30 — Release Hardening**: Test data cleanup, full ledger/cash reconciliation, security auditing, production build verification, final documentation freeze, and remote backup.

---

## 5. Token & Cost Efficiency Policy

### Verification Tiers
Verification must match the risk level of the change to avoid wasteful token expenditure and redundant execution loops:

- **LOW RISK** (Isolated frontend polish, UI copy, local styling, presentation-only components):
  - *Verification*: Targeted UI checks, client build (`npm run build`), manual visual check.
  - *Rule*: Do NOT automatically run full backend regression suites or spawn Codex reviewer agents.
- **MEDIUM RISK** (API/state integration, component data plumbing, non-financial provider adapters, news parsing/caching):
  - *Verification*: Affected route/unit tests, integration check, client build, and git diff check.
  - *Rule*: Broader regression is run only if cross-module dependencies are touched.
- **HIGH RISK** (Financial accounting, PostgreSQL migrations, ledger mutations, access controls, FX math, core quantitative formulas):
  - *Verification*: Immediate focused production-path tests, full regression suite (`npm test`), migration history verification, remote database state checks, and `git diff --check`.
  - *Rule*: One independent reviewer check is valuable; avoid repeated reviewer loops unless a HIGH or CRITICAL defect is found.

### Golden Regression Batching
Comprehensive cross-feature golden regression tests are executed at strategic intervals:
- After every 2–4 related completed features.
- At major phase boundaries.
- Prior to production releases.
- Immediately following any change to core financial invariants.
- *Golden Scenario Scope*: Opening cash $\rightarrow$ Deposit $\rightarrow$ Opening position $\rightarrow$ BUY $\rightarrow$ Partial SELL $\rightarrow$ Full SELL $\rightarrow$ Ledger consistency $\rightarrow$ Portfolio valuation $\rightarrow$ Missing price/FX partial valuation.

### Documentation Batching
To eliminate documentation churn:
- Comprehensive documentation reconciliation occurs by default after every 2 completed features or at phase boundaries.
- Immediate doc updates are made only when a feature introduces or modifies a durable architectural invariant required by subsequent tasks.
- `docs/CURRENT.md` receives brief operational checkpoint updates when needed.

---

## 6. Git & GitHub Checkpoint Strategy

- **Local Git**:
  - Exactly one verified feature = one clean, scoped, reversible local commit.
  - Do not bundle multiple feature implementations into one mega-commit.
- **GitHub Remote Push**:
  - Default: Batch approximately 2–5 verified features per remote push.
  - Push earlier upon:
    - High-risk financial/accounting milestones.
    - Major database schema migrations.
    - Security / access control milestones.
    - Before high-risk refactoring or machine/environment changes.
    - When remote backup is becoming stale.
  - *Pre-Push Invariant*: Full test suite passing, build passing, `git diff --check` clean, working tree clean. Never assume remote state without verification.

---

## 7. Prompt & AI Collaboration Rules

- **Documentation First**: Agents must read repository documentation (`docs/CURRENT.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/ASSET_MODEL.md`) rather than requiring prompts to duplicate complete historical context.
- **Concise Prompts**: Prompts focus on current task, strict scope boundaries, active invariants, required verifications, and reporting structure.
- **Role Discipline**: Exactly one active WRITER agent per implementation task. Independent review is optional for low/medium risk and targeted for high-risk integrity tasks.
- **No Duplicate Audits**: Do not re-audit an architecture that already has an approved architectural decision and audit in place.

---

## 8. Frozen & Low-Value Scope

To maintain engineering focus, the following items are strictly frozen or deferred:
- Duplicate top-level dashboards or redundant portfolio pages.
- Gamification, community features, or social feeds.
- Arbitrary AI confidence percentages or unexplained "health scores".
- Decorative charts that do not aid financial decision-making.
- Sprawling technical indicator collections without proven methodology.
- Direct broker order execution or autonomous trading.
- Massive uncurated crypto token ingestion (scope restricted to ~Top 40 liquid assets).
- Multi-user authentication complexity in V1.
- Deep bond coupon/maturity and bank deposit modeling until future phases.

> [!TIP]
> **Feature Value Rule**: A feature must materially improve the investor's understanding of **money, assets, risk, market conditions, or investment decisions**. Otherwise, it is deferred.

---

## 9. Project Director Checkpoint Cadence

The Project Director proactively restates a structured operational checkpoint:
- After every 2 completed features.
- At major architectural phase boundaries.
- When conversation context approaches token limits.
- Before embarking on high-risk financial work.

### Checkpoint Structure
```text
PROJECT CHECKPOINT
- DONE: [Recent completed features and commits]
- CURRENT: [Active feature and implementation status]
- NEXT: [Next 1-2 features in roadmap sequence]
- CORE INVARIANTS: [Key non-negotiable rules for current phase]
- UNKNOWN: [Explicit unresolved items preserved without guessing]
- GITHUB: [Verified local commit vs remote push status]
```
