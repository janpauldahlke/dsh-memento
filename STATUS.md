# dsh-memento

- **Long horizon:** ON
- **Phase:** M2+M3+M4 accepted → chunk commit → M5
- **cwd:** `/home/hagbard/dev/dsh-memento`
- **Updated:** 0s ago

## Now

- **In flight:** —
- **Next 3:**
  1. Chunk-commit M2+M3+M4 (single commit, full M2/M3/M4 description; vault restored to pristine: ME.md=template, inbox empty)
  2. M5 — history search: read plan/M5-history-search.md, design then build (next milestone)
  3. Compliance rate: first determined session ends → .compliance.log gets entries → update the M3 rate note in plan/STATUS.md (currently 0/0)

## Done (recent)

- ✓ M4 acceptance green: node agent/accept-m4.mjs 7/7 PASS against live :3090 · verify: exit 0; atomic PUT sha256-exact (2 concurrent-read states, all old-or-new, no temp litter); traversal/malformed → 400; 40-line over-cap accepted (overCap:true, never refused); DELETE /inbox/line/N byte-identical + tail renumbering (n slides into freed slot); Create no-wipe; CJS strict-require (react + jsx-runtime only, seats + tab type dsh-memento); 30s client poll loop: 34 store emissions, state+compliance clean, 0 pending intervals after unmount. 70/70 node --test, tsc clean. Vault restored: ME.md = template (sha-identical), inbox emptied, probe project removed · 28s ago
- ✓ M3 acceptance green: node agent/accept-m3.mjs 10/10 PASS (9 synthetic + LIVE probe) · verify: exit 0; LIVE: :3090 milestone=M4, GET /compliance ok:true; first observed compliance rate = 0/0 (no session ended under the M3+ build; .compliance.log absent) — recorded in plan/STATUS.md per M3 spec ("write the observed rate into STATUS.md when M3 lands") · 28s ago
- ✓ M2 acceptance green: node agent/accept-m2.mjs 7/7 PASS against live :3090 (M4 bundle) · verify: exit 0; trigger units (Remember:/remember this: match, please remember:/I will remember do not); capture format [--key--] + ISO ts parseable; undo byte-identical (sha256); double-undo no-op; multi-line → single line; 200× capture/undo restore byte-identical + state.inject.chars unchanged; ME.md sha256 invariant across run · 28s ago
- ✓ M4 code complete (uncommitted): host PUT /file (atomic temp+rename, allowlist + traversal guard, 512 KiB cap, me/project + key) and DELETE /inbox/line (1-based, text-preserving, over-cap-aware), /state extended (inbox tail-20 newest-first + me/project text), /compliance +history; client Memory rightbar (ME.md editor, project MEMORY.md editor with Create, inbox tail-20 read-only with per-line delete, compliance strip, cap warn/crit), CJS ModuleLoader bundle lib/client.js; agent/accept-m4.mjs written (7 checks, milestone-gated exit 2) · verify: npx tsc --noEmit clean; node --test test/*.test.mjs 70/70 pass; node build.mjs → lib/index.js contains M4 + dsh-memento/file + inbox/line markers; node agent/accept-m4.mjs → exit 2 "stale bundle (milestone=M1)" with restart instruction (gate verified against live :3090); local dry-run of checks 6+7 against lib/client.js: factory + strict require (react/jsx-runtime only) + both seats + tab type + render + 4 fetches over 4.6s + unmount leaves 0 pending intervals · 41m ago
- ✓ M3 code complete: src/host/compliance.ts (session-scoped state machine, exported MUTATION list, observation-only fail-open), assets/ritual.md directive appended to M1 inject when project MEMORY.md exists, GET /compliance route, rolling .compliance.log (cap 500), v0.4.0 · verify: 66/66 node --test green; npx tsc --noEmit clean; node agent/accept-m3.mjs → 9/9 PASS exit 0; bundle loads with 0 runtime harness imports, exports COMPLIANCE_ROUTE; smoke test drives built bundle against mock ctx · 5h ago

*Last write branch:* `main`
