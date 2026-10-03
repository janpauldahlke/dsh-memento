# STATUS — dsh-memento

Updated: 2026-10-03T13:10+02:00 · Phase: **M5 accepted — plan complete**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file,
**this file wins**. Keep ≤45 lines; rewrite at every working block.

## Next 3

1. **Written judgement (the real "after M5")**: once ≥1 session ends under
   M5 (compliance rate determined) and some daily use has happened, judge in
   this file whether the ritual + cap pressure produced a warmer session.
   No feature work until that judgement exists.
2. **Compliance rate follow-up**: first determined session ends →
   `.compliance.log` entries → update the M3 rate note below (still 0/0).
3. **Daily-use check**: use `memory_history_search` on a real cold case;
   friction/failures here are the only gate for un-planned M6+ (FTS/repeats).

## Milestones

- [x] M0 (`7d6dd36`) · [x] M1 (`9e1ad61`) · [x] M2+M3+M4 (`9fc1647`) ·
  [x] M5 history search (v0.6.0, this commit)

## Blockers

- None. `:3090` runs the M5 build (v0.6.0). Human approved agent restart via
  `./agent/boot-3090.sh` (2026-10-03); it runs as tracked process
  `dsh-memento-3090` — kill+relaunch the same way if it goes stale.

## Done log

- 2026-10-03 — **M5 accepted (9/9)**: `memory_history_search` — zstd-CLI
  streaming scanner (multi-frame safe), literal+regex, 2 s/64 MiB/50-hit
  bounds, fail-open `degraded[]`, ≤400-char snippets, newest-first. All
  9 spec checks green incl. tool-wrapper scoping + read-only sha256 proof.
  M2 7/7, M3 10/10, M4 7/7 re-run green under M5. 93/93 tests, tsc clean.
- 2026-10-03 — **M2/M3/M4 accepted** (7/7, 10/10, 7/7) + chunk commit
  `9fc1647` (34 files, v0.5.0).
- 2026-10-03 — **M3 compliance rate: 0/0** — no session ended under the M3+
  build yet (`.compliance.log` absent). Per-ended-session (rolling 500);
  first determined session lands a real number — update this note then.
- 2026-10-03 — M1 committed (`9e1ad61`); M0 committed (`7d6dd36`).

## Reminders

- Never touch `:3080` / `:8080` / `:11434`; kill only pids verified by number.
- M3 is observation-only: never block/retry/re-prompt; never surface
  compliance as memory; missing project file is never a violation.
- M5 is read-only: hits are snippets, never copied into the vault; the tool
  is agent-invoked on demand, never auto-run from the inject path.
