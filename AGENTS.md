# Agent Instructions & Working Rules

All AI agents and contributors working in this repository must strictly adhere to the following rules:

## 1. Documentation & Source of Truth
- **Read First**: Always read relevant project documentation (`docs/CURRENT.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/PROJECT.md`, `docs/BACKLOG.md`) before undertaking significant work. Agents must read repository documentation rather than requiring the Project Director to repeat full project history in every prompt.
- **Multi-Asset Architecture Contract**: For any work involving assets, market data, history, portfolio valuation, transactions, cash, comparison, or alerts, agents must read `docs/ASSET_MODEL.md` before making architecture assumptions.
- **Source of Truth**: Current source code is the implementation source of truth. Documentation represents intended product decisions.
- **Conflict Resolution**: If code and documentation conflict, **STOP and report the conflict** immediately. Do not silently choose one.
- **No Hallucinations / Inventions**: Never invent missing requirements.
- **Information Classification**: When needed, explicitly classify information as:
  - `FACT`: Verified in code or verified external data.
  - `DECISION`: Explicitly recorded and confirmed product decision.
  - `UNKNOWN`: Unclear or unconfirmed requirement.
- **Clarification**: Important `UNKNOWN` requirements must be asked directly to the user.

## 2. Workflow & Token Efficiency
- **Lifecycle for Significant Work**:
  $$\text{AUDIT} \rightarrow \text{DECIDE} \rightarrow \text{PLAN} \rightarrow \text{USER APPROVAL} \rightarrow \text{IMPLEMENT} \rightarrow \text{REVIEW} \rightarrow \text{VERIFY}$$
- **Approval Gate**: Do not begin implementation for significant features before receiving an approved plan from the user.
- **No Duplicate Audits**: Do not re-audit an architecture when an approved architecture decision and audit already exist.
- **Scope Discipline**:
  - Preserve everything outside the requested scope.
  - Do not modify unrelated files.
  - Do not perform broad refactors unless explicitly approved.
- **Plan Deviation**: If implementation requires a major deviation from the approved plan, **STOP and explain first**.
- **Role Isolation**: Exactly **one active WRITER** per task. Independent review is optional for LOW/MEDIUM risk and preferred for HIGH-risk integrity work.
- **Prompt Efficiency**: Prompts should provide current task, strict scope boundaries, active invariants, and verification steps without re-pasting unrelated completed-feature history.

## 3. Verification & Git
- **Tiered Verification**: Follow the verification tier (LOW / MEDIUM / HIGH risk) outlined in `docs/ROADMAP.md`.
- **Honest Verification**: Never claim something was tested unless it was actually tested.
- **Git Discipline**: Do not commit Git changes unless explicitly requested by the user.

## 4. Completion Reporting
At completion, report:
- **Changed files**: List of all files created, modified, or deleted.
- **What changed**: Summary of changes made.
- **Verification performed**: Exact steps and tests executed.
- **Remaining risks**: Potential failure points or edge cases.
- **Assumptions / unknowns**: Any unresolved items or working assumptions.
