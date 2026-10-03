# STATUS — dsh-memento

Updated: 2026-10-03T13:45+02:00 · Phase: **M0–M5 shipped · review fixes open**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file,
**this file wins**. Keep ≤45 lines; rewrite at every working block.

## Next 3

Source: `plan/REVIEW-01.md` — read the item in full first. Items are
independent; stopping after any one leaves a working build.

1. **R1 — lost update.** Pane clobbers hand edits to `ME.md`: sticky draft +
   precondition-free `PUT`. Adopt external changes when not dirty; add
   `mtimeMs` + `409`. Extend `accept-m4.mjs` (3 new checks). **Data loss — first.**
2. **R2 — no on/off.** Nothing can stop inject/capture/compliance. One master
   switch via `~/.dsh/memory/.off`; no settings system. New `accept-m6.mjs`
   (5 checks). **Human's stated priority.**
3. **R4 — the pane explains nothing.** Two tooltips exist in the whole client.
   Add section help, a collapsible "What is this?", and tooltips using the
   **exact copy in REVIEW-01 §R4** — do not invent wording.

Then, in order: R3 (show the injected text — trust), R5, R6, R7, R8.
The "written judgement" task is deferred until the review items are closed.

## Milestones

- [x] M0 (`7d6dd36`) · [x] M1 (`9e1ad61`) · [x] M2+M3+M4 (`9fc1647`) ·
  [x] M5 (`7fc2843`, v0.6.0) · [ ] REVIEW-01 (R1–R8)

## Blockers

- None. `:3090` runs v0.6.0 via `./agent/boot-3090.sh` (tracked process
  `dsh-memento-3090`; kill+relaunch the same way if stale).

## Done log

- 2026-10-03 — **REVIEW-01 received** (design author). Verdict: correct build,
  ritual held, but opaque to any user who has not read `DESIGN.md`.
- 2026-10-03 — M5 accepted 9/9; M2 7/7, M3 10/10, M4 7/7 re-run green.
  93/93 tests, tsc clean. M3 compliance rate still **0/0** (no session has
  *ended* under an M3+ build).

## Reminders

- Run `plan/SMOKE.md` before claiming a review item is done.
- Never touch `:3080` / `:8080` / `:11434`; kill only pids verified by number.
- Plugin never writes `ME.md` / project `MEMORY.md` except via explicit pane action.
- No settings system, no configurable caps, no new deps, no CSS pipeline.
