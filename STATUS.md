# dsh-memento

- **Long horizon:** OFF
- **Phase:** plan complete — user testing
- **cwd:** `/home/hagbard/dev/dsh-memento`
- **Updated:** 0s ago

## Now

- **In flight:** user testing
- **Next 3:**
  1. —

## Done (recent)

- ✓ M5 — history search: memory_history_search shipped (v0.6.0). accept-m5 9/9 green on live :3090 (M5 bundle), M2 7/7 + M3 10/10 + M4 7/7 re-run green, 93/93 unit tests, tsc clean. :3090 restarted via agent/boot-3090.sh (human-approved), tracked as dsh-memento-3090. · verify: node agent/accept-m5.mjs → exit 0 (9 PASS); node --test test/*.test.mjs → 93/93; git log → 7fc2843 + 333247d · 1h ago
- ✓ M2+M3+M4 chunk committed (9fc1647): 34 files, 5686 insertions — inbox capture/Undo + memory_recover tool, ritual compliance + /compliance, Memory rightbar (host PUT /file, DELETE /inbox/line, /state inbox+text, /compliance history; client tab dsh-memento), 3 acceptance scripts, standalone test cores, v0.5.0 · verify: git log -1 = 9fc1647 (main); git status clean after commit (except auto-regenerated root STATUS.md); all acceptance re-runnable against live :3090 (M4 bundle) — M2 7/7, M3 10/10, M4 7/7; 70/70 node --test; tsc --noEmit clean; plan/STATUS.md rewritten with compliance rate note (0/0 first observation) · 2h ago
- ✓ M4 acceptance green: node agent/accept-m4.mjs 7/7 PASS against live :3090 · verify: exit 0; atomic PUT sha256-exact (2 concurrent-read states, all old-or-new, no temp litter); traversal/malformed → 400; 40-line over-cap accepted (overCap:true, never refused); DELETE /inbox/line/N byte-identical + tail renumbering (n slides into freed slot); Create no-wipe; CJS strict-require (react + jsx-runtime only, seats + tab type dsh-memento); 30s client poll loop: 34 store emissions, state+compliance clean, 0 pending intervals after unmount. 70/70 node --test, tsc clean. Vault restored: ME.md = template (sha-identical), inbox emptied, probe project removed · 2h ago
- ✓ M3 acceptance green: node agent/accept-m3.mjs 10/10 PASS (9 synthetic + LIVE probe) · verify: exit 0; LIVE: :3090 milestone=M4, GET /compliance ok:true; first observed compliance rate = 0/0 (no session ended under the M3+ build; .compliance.log absent) — recorded in plan/STATUS.md per M3 spec ("write the observed rate into STATUS.md when M3 lands") · 2h ago
- ✓ M2 acceptance green: node agent/accept-m2.mjs 7/7 PASS against live :3090 (M4 bundle) · verify: exit 0; trigger units (Remember:/remember this: match, please remember:/I will remember do not); capture format [--key--] + ISO ts parseable; undo byte-identical (sha256); double-undo no-op; multi-line → single line; 200× capture/undo restore byte-identical + state.inject.chars unchanged; ME.md sha256 invariant across run · 2h ago

*Last write branch:* `main`
