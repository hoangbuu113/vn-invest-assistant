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
  - Financial/news detection target around every 30–60 seconds.
  - Important news should be analyzed promptly using AI.
- **Project Philosophy**: Learning project for full-stack/vibe coding, but must remain practically usable in real life.
- **Scoring Methodology**: Quantitative scoring should be evidence/data-driven (derived from data, rules, or quantitative models) rather than invented by AI intuition alone.
