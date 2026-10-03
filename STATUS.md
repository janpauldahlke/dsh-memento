# dsh-memento

- **Long horizon:** ON
- **Phase:** M2+M3+M4 accepted → chunk commit → M5
- **cwd:** `/home/hagbard/dev/dsh-memento`
- **Updated:** 0s ago

## Now

- **In flight:** M5 — history search: scanner core (src/host/history.ts) + memory_history_search tool written, tsc clean, scanner smoke-verified on live sessions; unit tests written, smoke test + acceptance pending
- **Next 3:**
  1. M5 — finish: update smoke test (2 tools), node --test green, agent/accept-m5.mjs (9 checks), restart :3090, accept M2/M3/M4/M5, commit + STATUS.md
  2. Compliance rate: first determined session ends → .compliance.log gets entries → update the M3 rate note in plan/STATUS.md (currently 0/0)
  3. If generated root STATUS.md drifts post-commit, fold the regenerated board into the next commit (no standalone hunk-split commits)

## Done (recent)

- ✓ M2+M3+M4 chunk committed (9fc1647): 34 files, 5686 insertions — inbox capture/Undo + memory_recover tool, ritual compliance + /compliance, Memory rightbar (host PUT /file, DELETE /inbox/line, /state inbox+text, /compliance history; client tab dsh-memento), 3 acceptance scripts, standalone test cores, v0.5.0 · verify: git log -1 = 9fc1647 (main); git status clean after commit (except auto-regenerated root STATUS.md); all acceptance re-runnable against live :3090 (M4 bundle) — M2 7/7, M3 10/10, M4 7/7; 70/70 node --test; tsc --noEmit clean; plan/STATUS.md rewritten with compliance rate note (0/0 first observation) · 41m ago
- ✓ M4 acceptance green: node agent/accept-m4.mjs 7/7 PASS against live :3090 · verify: exit 0; atomic PUT sha256-exact (2 concurrent-read states, all old-or-new, no temp litter); traversal/malformed → 400; 40-line over-cap accepted (overCap:true, never refused); DELETE /inbox/line/N byte-identical + tail renumbering (n slides into freed slot); Create no-wipe; CJS strict-require (react + jsx-runtime only, seats + tab type dsh-memento); 30s client poll loop: 34 store emissions, state+compliance clean, 0 pending intervals after unmount. 70/70 node --test, tsc clean. Vault restored: ME.md = template (sha-identical), inbox emptied, probe project removed · 46m ago
- ✓ M3 acceptance green: node agent/accept-m3.mjs 10/10 PASS (9 synthetic + LIVE probe) · verify: exit 0; LIVE: :3090 milestone=M4, GET /compliance ok:true; first observed compliance rate = 0/0 (no session ended under the M3+ build; .compliance.log absent) — recorded in plan/STATUS.md per M3 spec ("write the observed rate into STATUS.md when M3 lands") · 46m ago
- ✓ M2 acceptance green: node agent/accept-m2.mjs 7/7 PASS against live :3090 (M4 bundle) · verify: exit 0; trigger units (Remember:/remember this: match, please remember:/I will remember do not); capture format [--key--] + ISO ts parseable; undo byte-identical (sha256); double-undo no-op; multi-line → single line; 200× capture/undo restore byte-identical + state.inject.chars unchanged; ME.md sha256 invariant across run · 46m ago
- ✓ M4 code complete (uncommitted): host PUT /file (atomic temp+rename, allowlist + traversal guard, 512 KiB cap, me/project + key) and DELETE /inbox/line (1-based, text-preserving, over-cap-aware), /state extended (inbox tail-20 newest-first + me/project text), /compliance +history; client Memory rightbar (ME.md editor, project MEMORY.md editor with Create, inbox tail-20 read-only with per-line delete, compliance strip, cap warn/crit), CJS ModuleLoader bundle lib/client.js; agent/accept-m4.mjs written (7 checks, milestone-gated exit 2) · verify: npx tsc --noEmit clean; node --test test/*.test.mjs 70/70 pass; node build.mjs → lib/index.js contains M4 + dsh-memento/file + inbox/line markers; node agent/accept-m4.mjs → exit 2 "stale bundle (milestone=M1)" with restart instruction (gate verified against live :3090); local dry-run of checks 6+7 against lib/client.js: factory + strict require (react/jsx-runtime only) + both seats + tab type + render + 4 fetches over 4.6s + unmount leaves 0 pending intervals · 1h ago

*Last write branch:* `main`
