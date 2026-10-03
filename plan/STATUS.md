# STATUS — dsh-memento

Updated: 2026-10-03T12:05+02:00 · Phase: **M2+M3+M4 accepted → chunk commit**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file,
**this file wins**. Keep ≤45 lines; rewrite at every working block.

## Next 3

1. **Chunk-commit M2+M3+M4** (one commit, full description of all three):
   M2 7/7, M3 10/10 (incl. live), M4 7/7 — all against live :3090 (M4 bundle).
2. **M5 — history search.** `plan/M5-history-search.md`: design, then build.
3. **Compliance rate follow-up**: first determined session to end →
   `.compliance.log` gets entries → update the M3 rate note below.

## Milestones

- [x] M0 (`7d6dd36`) · [x] M1 (`9e1ad61`) · [x] M2 (7/7) · [x] M3 (10/10) ·
  [x] M4 (7/7) · [ ] M5 history search

## Blockers

- None. `:3090` runs the M4 bundle (v0.5.0) — human-owned, reuse only.
- Host sandbox backend unusable (AppArmor/bwrap) → accept turns use
  read/glob/grep steps.

## Done log

- 2026-10-03 — **M4 accepted (7/7)**: atomic PUT sha256-exact (2 observed
  states, no temp litter), traversal→400, over-cap accepted (40 lines,
  `overCap:true`), DELETE /inbox/line byte-identical + tail renumber, Create
  no-wipe, CJS strict-require bundle, 30s poll loop (34 emissions, 0 leaks).
  70/70 tests, tsc clean. Vault restored: ME.md=template, inbox empty.
- 2026-10-03 — **M3 accepted (10/10)** incl. LIVE probe (:3090 /compliance ok).
  **First observed compliance rate: 0/0** — no session ended under the M3+
  build yet (`.compliance.log` absent). Rate is per-ended-session (rolling
  500, pane strip via /compliance history); first determined session lands a
  real number — update this note then.
- 2026-10-03 — **M2 accepted (7/7)**: capture format/key/ISO ts, undo
  byte-identical, double-undo no-op, multi-line collapse, trigger units,
  200× capture/undo byte-identical restore, ME.md invariant.
- 2026-10-03 — M1 committed (`9e1ad61`); M0 committed (`7d6dd36`).

## Reminders

- Never touch `:3080` / `:8080` / `:11434`. Never spawn/kill `dsh web`
  from agent. Accept **reuses** `:3090`; teardown keeps vault backup on FAIL.
- M3 is observation-only: never block/retry/re-prompt; never surface
  compliance as memory; missing project file is never a violation.
