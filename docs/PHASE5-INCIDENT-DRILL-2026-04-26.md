# Phase 5 Incident Drill Report

## Incident Meta

- Incident ID: `DRILL-2026-04-26-001`
- Date (UTC/local): `2026-04-26 (local)`
- Severity: `SEV-2` (simulated)
- Status: `resolved`
- Owner: `AI agent (drill), owner review pending`

## Impact

- Affected routes/features: simulated latency regression on `distilleries` and `ratings-feed`
- User impact summary: potential slower load on key discovery screens
- Start time: `16:40`
- End time (if resolved): `16:55`
- Total duration: `15 min` (simulation window)

## Detection

- How detected (smoke, alert, user report): repeated smoke trend review
- First signal time: `16:42`
- Key metrics observed:
  - intermittent spikes on `distilleries`
  - intermittent spikes on `ratings-feed`
  - all routes still `200 OK`

## Timeline

- `16:40` - drill scenario started (assume latency spike alert trigger)
- `16:42` - blast radius check initiated with `npm run cf:smoke:edge`
- `16:47` - mitigation decision simulated: no rollback, continue short-interval monitoring
- `16:55` - route set confirmed healthy, drill closed

## Root Cause

- Primary cause: simulated edge/cold-start timing variance under low but bursty request pattern
- Contributing factors: low traffic makes spikes visually larger per sample
- Why it was not caught earlier: single-run smoke snapshots can overstate transient spikes

## Mitigation and Recovery

- Immediate mitigation: run repeated smoke checks, compare median instead of one-off peak
- Rollback used: `no` (simulation)
- Verification steps executed:
  - `npm run cf:smoke:edge`
  - manual top-flow checks (home -> distillery -> product -> menu/community)

## Preventive Actions

- [x] Add weekly trend interpretation note to ops process (median over single run)
- [x] Keep `distilleries` and `ratings-feed` as explicit watch routes in Phase 4/5
- [x] Require 2-3 repeated runs before declaring latency regression

## Communication

- Internal updates sent to: project status document and phase 5 artifacts
- External/user-facing notice needed: `no`

## Closure

- Final resolution summary: no real outage/regression; drill confirms runbook response is actionable
- Residual risk: transient spikes still possible; handled via monitoring policy
- Follow-up review date: `next weekly ops report`
