# STATUS — dsh-memento
Updated: 2026-10-03T14:05+02:00 · Phase: **REVIEW-01 + compliance flush**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file,
**this file wins**. Keep ≤45 lines; rewrite at every working block.
## Next 3
1. **Human glance** on `:3080` after restart (host is start-once).
2. **Commit** when asked — local only, never push.
3. **Smoke §3.6** re-check in UI: strip should leave 0/0 (history ≥1).
## Milestones
- [x] M0–M5 · [x] REVIEW-01 R1–R7 · [x] compliance live flush (was 0/0)
## Blockers
- None. `:3090` relaunch after this block for v0.6.1 host.
## Done this block
- **Compliance fix (M3 intent):** root listeners use `{ global: true }`;
  tracker starts on `session/created`; idempotent flush on `session/disposed`
  + fiber unload. Live headless → `.compliance.log` line + history 1/1.
- Root cause: scoped session carriers filtered out untagged observers while
  agent/pre-step inject still worked — scorecard never flushed.
- REVIEW-01 R1–R7 still in tree (mtime/off/inject.text/pane help).
## Reminders
- No settings system, no configurable caps, no new deps.
- Never write ME.md / project MEMORY.md except via explicit pane action.
- Cap STATUS ≤45 lines.
