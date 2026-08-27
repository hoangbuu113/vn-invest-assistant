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
