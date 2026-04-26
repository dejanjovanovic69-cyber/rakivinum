# Cloudflare Phase 5 - Ops & Governance

## Scope

Phase 5 runs in parallel with Phase 4 and focuses on long-term operational maturity:

- SLO/SLA targets
- Cost guardrails and budget alerts
- Incident and rollback runbook
- Deploy quality gates
- Ownership and reporting cadence

This phase should not introduce risky production behavior changes by default.

## 1) SLO Baseline (initial targets)

Service-level targets for public read routes (`/api/public/*`):

- Availability SLO: `>= 99.5%` (30-day window)
- p50 latency target: `< 500ms` for most routes
- p95 latency target:
  - `< 1200ms` for standard list/detail routes
  - `< 1800ms` for heavier aggregate routes (`distilleries`, `ratings-feed`)
- Error budget policy:
  - If error budget burn exceeds 50% mid-window, freeze non-critical deploys
  - If burn exceeds 80%, deploy only reliability fixes

## 2) Cost Guardrails

Use billing and platform alerts with clear thresholds:

- Budget alerts (monthly):
  - Warning: 50%
  - Elevated: 70%
  - Critical: 90%
- Firestore trend checks (daily):
  - Reads and writes compared to previous day (same time window)
  - Trigger investigation on sustained >= 20% unexpected increase
- Kill-switch policy (already prepared in earlier phases):
  - Increase TTL
  - Temporarily reduce expensive feed limits
  - Disable non-essential analytics views

## 3) Incident Runbook (quick response)

### Severity model

- SEV-1: user-facing outage, repeated 5xx on public routes
- SEV-2: significant latency regression or partial route failure
- SEV-3: non-critical degradation, no broad user impact

### First 15 minutes

1. Confirm blast radius (`cf:smoke:edge`, quick app path test)
2. Identify route(s) with highest impact
3. Check recent deploy/config changes
4. Apply mitigation:
   - rollback deploy if clear regression
   - reduce load via temporary TTL/limit adjustments

### Recovery and follow-up

- Confirm route health with repeated smoke checks
- Record timeline and root cause
- Add prevention action item to `docs/STATUS-ZADATAKA.md`

## 4) Rollback Strategy

For any production regression:

- Worker rollback:
  - redeploy last known-good commit
- Pages rollback:
  - redeploy previous stable artifact/commit
- Post-rollback verification:
  - run `npm run cf:smoke:edge`
  - check top 3 user flows manually

## 5) Deploy Quality Gates

Before production deploy:

1. `npm run lint`
2. `npm run build`
3. `npm run cf:smoke:edge`
4. Quick latency sanity check against latest Phase 4 baseline

Optional (recommended when traffic grows):

- block deploy if:
  - smoke check fails any route
  - p95 latency regression > 30% on key routes without approved exception

## 6) Ownership and Cadence

- Daily (while Phase 4 active):
  - 1 short checkpoint in `docs/STATUS-ZADATAKA.md`
- Weekly:
  - one summary of latency/read trend and incidents
- Monthly:
  - SLO attainment review + budget guardrail review

## 7) Exit Criteria for Phase 5 "enabled"

Phase 5 is considered enabled when:

- SLO targets are documented and accepted
- Budget alert thresholds are active
- Incident and rollback runbook is in use
- Deploy quality gates are consistently applied
- At least one weekly ops summary is produced

## 8) Reporting Templates

Use these templates to keep operations consistent:

- Incident report template:
  - `docs/PHASE5-INCIDENT-REPORT-TEMPLATE.md`
- Incident drill example:
  - `docs/PHASE5-INCIDENT-DRILL-2026-04-26.md`
- Weekly ops report template:
  - `docs/PHASE5-WEEKLY-OPS-REPORT-TEMPLATE.md`
- Phase-5 enable checklist:
  - `docs/PHASE5-ENABLE-CHECKLIST.md`
- Quality gate run evidence:
  - `docs/PHASE5-QUALITY-GATE-RUN-2026-04-26.md`
- Activation status snapshot:
  - `docs/PHASE5-ACTIVATION-STATUS-2026-04-26.md`
- Owner gate completion guide:
  - `docs/PHASE5-OWNER-GATES-HOWTO.md`

## Quick Commands

- Health and route smoke:
  - `npm run cf:smoke:edge`
- Multi-run hotspot monitor (median/p95 + CSV log):
  - `npm run cf:monitor:edge`
- Example (8 runs, 10s pause):
  - `npm run cf:monitor:edge -- -Runs 8 -DelaySec 10`
- Local quality checks:
  - `npm run lint`
  - `npm run build`
