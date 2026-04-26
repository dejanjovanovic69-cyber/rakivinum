# Phase 5 Owner Gates How-To

This guide closes the final owner-controlled gates for formal Phase 5 enable.

## Gate #1 - SLO Targets Accepted

### Goal

Confirm that SLO targets from `docs/CLOUDFLARE-PHASE5-OPS-GOVERNANCE.md` are accepted.

### Steps

1. Review SLO section in `docs/CLOUDFLARE-PHASE5-OPS-GOVERNANCE.md`.
2. If accepted, update `docs/PHASE5-ENABLE-CHECKLIST.md` gate #1:
   - mark `[x]`
   - set owner/date
   - set evidence to this file + governance doc
3. Optional: add one-line acceptance note in `docs/STATUS-ZADATAKA.md`.

### Suggested Evidence Text

`Accepted SLO targets from docs/CLOUDFLARE-PHASE5-OPS-GOVERNANCE.md on <date> by <owner>.`

## Gate #2 - Budget Alerts Configured (50/70/90)

### Goal

Enable monthly budget alerts with thresholds 50%, 70%, and 90%.

### Steps (Google Cloud Billing)

1. Open Google Cloud Console -> Billing -> Budgets & alerts.
2. Create or edit budget for the production billing account.
3. Set alert thresholds:
   - 50% (warning)
   - 70% (elevated)
   - 90% (critical)
4. Ensure notification emails are added.
5. Save and take screenshots (or note alert IDs).
6. Update `docs/PHASE5-ENABLE-CHECKLIST.md` gate #2:
   - mark `[x]`
   - set owner/date
   - add evidence path/link (screenshots or alert IDs)

### Suggested Evidence Text

`Budget alerts configured at 50/70/90 for production billing account; screenshot references: <paths or links>.`

## Finalization

After gate #1 and #2 are complete:

1. Update `docs/PHASE5-ACTIVATION-STATUS-2026-04-26.md`:
   - Completed gates: `7 / 7`
   - Decision: `GO`
2. Update `docs/PHASE5-ENABLE-CHECKLIST.md`:
   - Fill Go/No-Go block
3. Add short closure note in `docs/STATUS-ZADATAKA.md`.
