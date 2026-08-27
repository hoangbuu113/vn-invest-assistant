# Confirmed Decisions

The following architectural and product decisions are confirmed:

- **Target User**: Single-user application (personal use only).
- **Supported Asset Classes**:
  - Vietnamese stocks
  - ETFs / funds
  - Gold
  - Bank deposits
  - Bonds
- **Scope of Execution**: No trade execution and no broker integration; analysis and ranking only.
- **Investor Profile (Feature 04)**:
  - **V1 Model**: Exactly ONE singleton investor profile without authentication or multi-user accounts.
  - **Available Capital**: Stored as `cash_available` (money currently available to deploy into investments).
  - **Risk Tolerance Values**: `low`, `moderate`, `high`.
  - **Investment Horizon Values**: `short`, `medium`, `long`.
  - **Holdings Model**: Stored in `public.holdings` referencing profile and asset (`asset_id`, `quantity` > 0, `average_cost` >= 0) with unique asset-per-profile constraint.
  - **Localization**: All user-facing UI is in Vietnamese; internal code, API routes, and database identifiers remain in English.
- **Personalization Factors**: Analysis personalized using:
  - Available capital
  - Risk tolerance
  - Investment horizon
  - Current portfolio
- **Market Data Strategy**:
  - **V1**: Uses Yahoo Finance delayed market snapshots (~15 min delay) with manual and 5-minute auto-refresh.
  - **Realtime**: Sub-second broker/provider realtime streaming remains a long-term goal, deferred until stable broker/API access is established.
- **News Ingestion & Processing**:
  - **V1 News Source**: CafeF RSS feeds across 4 key categories (`thi-truong-chung-khoan`, `doanh-nghiep`, `vi-mo-dau-tu`, `tai-chinh-quoc-te`).
  - **V1 Relevance Filtering**: Deterministic keyword and context filtering to eliminate non-investment noise (accidents, crimes, entertainment, sports, lifestyle) and require positive economic/market signals for global items.
  - **AI Analysis**: Deferred to subsequent phase/feature.
  - Financial/news detection target around every 30–60 seconds in later iterations.
- **Project Philosophy**: Learning project for full-stack/vibe coding, but must remain practically usable in real life.
- **Scoring Methodology**: Quantitative scoring should be evidence/data-driven (derived from data, rules, or quantitative models) rather than invented by AI intuition alone.
