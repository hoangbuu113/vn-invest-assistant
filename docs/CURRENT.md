# Current Project Status

## LATEST VERIFIED CHECKPOINT
- **Release Status**: V1.3 CLOSED LOCALLY (READY FOR MIGRATION & DEPLOYMENT)
- **Production Status**: Production runs V1.1/V1.2 baseline (`origin/main` at commit `b998e10`). V1.3 changes are staged and verified locally across 27 commits ahead of `origin/main`. No remote push or deployment has been performed.
- **Final Local Baseline**: `356d5c2 fix: separate opportunity health and explanation grounding`
- **Branch**: `main`
- **Architecture**: Cloudflare Workers Static Assets frontend (with API proxy and 15m scheduled cron) + Render Node.js Express backend + Supabase PostgreSQL database
- **Automated Test Suite**:
  - Full Backend & Integration Regression: **1,327 / 1,327 PASS** across **163 test suites** (`npm test --prefix server`)
  - Focused Critical Suites:
    - Historical As-Of Replay (`historical-as-of-replay.test.js`): 30/30 PASS
    - Strategy Stability Production Integrity (`strategy-stability-phase2-1.test.js`): 32/32 PASS
    - Strategy Stability Memory Fallback Removal (`strategy-stability-phase2-2.test.js`): 15/15 PASS
    - Strategy Shadow Replay (`strategy-shadow-replay.test.js`): 16/16 PASS
    - Observability & Data Health (`data-health-observability.test.js`): 22/22 PASS
    - Vietnam Equity Evidence (`equity-evidence.test.js`): 18/18 PASS
    - Deterministic Equity Opportunity Engine (`equity-opportunity-engine.test.js`): 24/24 PASS
  - Client Build: PASS (Vite production bundle & Cloudflare SSR worker built in ~250ms, 0 errors, 0 warnings)
  - Git Diff & Formatting: `git diff --check` PASS (clean)
- **Working Tree**: CLEAN (with untracked `server/artifacts/` preserved untouched)

---

## CURRENT PHASE
V1.3 — Advanced Market Intelligence, Evidence Replay & Stability Engine (LOCAL COMPLETE)

---

## V1.3 COMPLETED FEATURES SUMMARY

### 1. Strategy Stability & Publication Safety (01C)
- **Two-Clock Lifecycle**: Decoupled continuous fast-clock evidence evaluation from patient slow-clock strategy publication. Lifecycle state machine: `STABLE`, `WATCH`, `REVIEW_REQUIRED`, `EVALUATING`.
- **Deterministic Materiality**: State changes occur strictly upon evaluated evidence changes, verified shocks, or confirmed multi-source consensus. Unchanged evidence or identical evaluations yield deterministic `KEEP`.
- **Atomic Publication RPC**: Created `publish_strategy_version_atomic(p_new_version, p_expected_current_strategy_id)` in PostgreSQL. Guarantees transactional supersession of the expected current strategy and insertion of the new version with zero-published prevention, concurrency locking (`FOR UPDATE`), and automatic rollback on failure.
- **Production Memory Fallback Removal**: Database failure (`PGRST202` or connection error) in production throws explicit errors and halts; never silently seeds or falls back to in-memory strategy publication.
- **Shadow Replay & Calibration Framework**: Replay harness simulates chronological evidence sequences with zero lookahead bias.
- **Hysteresis Thresholds Policy**: Numeric hysteresis thresholds were intentionally **NOT** calibrated due to partial historical coverage across complete economic cycles; quantitative stability is governed deterministically without arbitrary fabricated thresholds.

### 2. Historical As-Of Evidence Replay (01D)
- **Replay Safety Contract**: Implemented historical as-of evidence projection engine. All evidence evaluations evaluate state strictly as-of an explicit timestamp $T$ with zero lookahead bias.
- **System-Knowable Timestamp Authority**: An observation is knowable to the system strictly when `asOf >= max(sourceAvailableAt, firstSeenAt)`. Publication timestamps alone cannot bypass system ingestion time, and future corrections or backfills never alter prior historical fingerprints.
- **Claim Corroboration & Contradiction**: Structured claims track independent corroboration and contradictory evidence without discarding minority sources.

### 3. Observability & Data Health (01E)
- **Deterministic Health States**: `HEALTHY`, `DEGRADED`, `FAILED`, `UNKNOWN` with strict precedence (`FAILED` > `DEGRADED` > `UNKNOWN` > `HEALTHY`).
- **Core Observed Pipelines (9 jobs)**:
  1. `vn_market_context_collector`
  2. `official_macro_monetary_collector`
  3. `customs_trade_collector`
  4. `news_refresh_collector`
  5. `claims_reconciliation`
  6. `market_strategist_refresh`
  7. `alert_scheduler`
  8. `vn_equity_evidence_refresh`
  9. `vn_opportunity_engine_refresh`
- **Domain vs Operational Health Invariant**: `job execution health != domain / data conclusion`. A collector or engine completing valid evaluation reporting empty or insufficient data is operationally `HEALTHY`. `DEGRADED` is strictly reserved for operational anomalies (partial persistence, WAF quarantine). `FAILED` is reserved for pipeline crashes, unhandled exceptions, or fatal DB failures.
- **Durable Checkpoints**: State persists to `public.market_context_collector_checkpoints`. Production DB is strictly authoritative; memory store is used only in explicit offline/test mode.
- **Public Observability Route**: `GET /api/system/data-health` reads durable checkpoints without external provider calls and returns HTTP 200 (or 503 if system status is `FAILED`), exposing zero secrets.

### 4. Vietnam Equity Evidence (01F)
- **Canonical Stock Evidence Foundation**: Model and repository (`public.vn_equity_evidence_observations`) storing immutable evidence vintages for canonical Vietnam equities (`VCB`, `FPT`, `HPG`, `VNM`, `E1VFVN30`, `FUEVFVND`, `FUESSVFL`).
- **Replay-Safe Timestamp Invariants**: Enforces `system_knowable_at >= first_seen_at` and `system_knowable_at >= source_available_at`.
- **Market Price Evidence**: Completed daily OHLCV bars ingested via backend collector with delayed freshness provenance.
- **Unprovisioned Domains**: Stock fundamentals and official corporate disclosures remain truthfully declared as `SOURCE_NOT_PROVISIONED` without fabricating missing data.
- **Public Route**: `GET /api/equity-evidence/:symbol` provides read-only access to persisted evidence vintages.

### 5. Deterministic Equity Opportunity Engine (01G)
- **Deterministic Authority**: Evaluates Vietnam equity universe against persisted evidence into explicit categories: `QUALIFIED`, `WATCH`, `INSUFFICIENT_EVIDENCE`, `REJECTED`.
- **Policy Invariant**: Because no calibrated numeric qualification policy exists, `QUALIFIED` remains intentionally unused/reserved; current valid completed closes support `WATCH` only. Inactive assets evaluate to `REJECTED`.
- **No Opaque Opportunity Scores**: Zero opaque numerical scoring, zero buy/sell/hold ratings, zero price targets, and zero probability estimates.
- **AI Explanation Boundary**: AI generates explanations bounded strictly by candidate evidence. Any ungrounded numbers, schema violations, speculative language, or forbidden actions (`buy`, `sell`, `hold`, `mua`, `bán`, `giữ`, `target price`, `giá mục tiêu`, `probability`, `xác suất`, `confidence`, `expected return`) are deterministically rejected and fall back to evidence-linked deterministic prose.
- **Qualification Immutability**: AI explanation failure or rejection never alters or promotes `candidate.qualificationStatus`.
- **Route Namespace Preservation**: Public deterministic engine operates on `GET /api/equity-opportunities` and `GET /api/equity-opportunities/:symbol`. The existing private portfolio-aware `GET /api/opportunities` is fully preserved without modification.

---

## UNAPPLIED MIGRATION AUDIT (LOCAL SEQUENCE)
The following 6 migrations are created, verified, and committed locally, but remain **UNAPPLIED** on the remote Supabase database:

1. `20260905010000_create_collector_checkpoints.sql`
   - Creates `public.market_context_collector_checkpoints` for pipeline observability and due-gating.
2. `20260905020000_create_market_claims_and_evidence_links.sql`
   - Creates `public.market_claims` and `public.claim_evidence_links` for claim corroboration.
3. `20260906000000_create_strategy_stability_foundation.sql`
   - Creates `public.strategy_versions` and append-only `public.strategy_assessments`.
4. `20260906010000_harden_strategy_stability_publication.sql`
   - Creates atomic RPC function `public.publish_strategy_version_atomic(p_new_version, p_expected_current_strategy_id)`.
5. `20260906020000_create_vn_equity_evidence.sql`
   - Creates `public.vn_equity_evidence_observations` for immutable equity evidence vintages.
6. `20260906030000_create_vn_equity_opportunities.sql`
   - Creates `public.vn_equity_opportunity_evaluations` for deterministic opportunity evaluations.

---

## KNOWN BLOCKERS & LIMITATIONS
1. **Remote Migrations Pending**: Backend code in V1.3 requires the 6 migrations above. Migrations must be applied to Supabase before deploying backend code to Render.
2. **Equity Fundamentals & Disclosures Unprovisioned**: No official provider for Vietnamese corporate financial statements (balance sheet, income statement) or regulatory filings is provisioned. Candidates report `OFFICIAL_FUNDAMENTALS_SOURCE_NOT_PROVISIONED`.
3. **Strategy Stability Hysteresis Thresholds Uncalibrated**: Numeric thresholds remain intentionally uncalibrated; the engine enforces structural state machine stability without fabricating numeric thresholds.
4. **USD/VND Historical Bars**: Daily history remains intentionally unsupported pending verified timezone boundary reconciliation.
5. **Gold Spot History**: Remains close-only; OHLC metrics remain unavailable.

---

## NEXT RELEASE STEPS
When ready to release V1.3 to production:
1. Apply the 6 migrations to Supabase production in exact chronological order (010000 -> 020000 -> 000000 -> 010000 -> 020000 -> 030000).
2. Verify created database tables, unique constraints, append-only triggers, RLS policies, and RPC function `publish_strategy_version_atomic`.
3. Push local commits to remote `origin/main` (`git push origin main`).
4. Trigger or observe Render backend deployment; verify health at `https://vn-invest-assistant-api.onrender.com/api/health`, `/api/db-health`, and `/api/system/data-health`.
5. Deploy Cloudflare Worker frontend (`npx wrangler deploy`); verify static assets and API proxy.
6. Execute production smoke tests against public routes (`/api/system/data-health`, `/api/equity-opportunities`, `/api/market-context/vietnam`).
7. Verify background scheduler evaluation runs cleanly via Cloudflare Worker cron (`*/15 * * * *`).
8. Mark V1.3 production checkpoint complete.
