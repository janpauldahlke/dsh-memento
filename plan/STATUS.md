# STATUS — dsh-memento

Updated: 2026-10-03T03:50+02:00 · Phase: **M1 — accept reuse fixed; headless checks still red**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file,
**this file wins**. Keep ≤45 lines; rewrite at every working block.

## Next 3

1. **Finish M1 green.** `:3090` human-owned (`./agent/boot-3090.sh` from this
   repo). `node agent/accept-m1.mjs` must PASS all checks (4/5 headless
   sentinel + cache; do not spawn dsh; do not dig harness). Then local commit.
2. **M2 — inbox write.** `plan/M2-inbox-write.md`.
3. **M3 — ritual enforcement.** `plan/M3-ritual-enforcement.md`.

## Milestones

- [x] M0 · [ ] M1 · [ ] M2 · [ ] M3 · [ ] M4 Memory rightbar · [ ] M5 history search

## Blockers

- None infra. Keys = `LLAMACPP_API_KEY` (settled). Accept **reuses** `:3090`
  (no kill/spawn). Last run: PASS 1+3; FAIL 4 (headless stdout empty despite
  exit 0), 5 (depends on 4), 2 was cwd-wrong (fixed: boot cds to repo), 6
  fetch failed after vault chmod — re-run after headless fix.

## Done log

- 2026-10-03 — M0 committed (`7d6dd36`).
- 2026-10-03 — M1 code on disk; accept rewritten to **reuse** human `:3090`;
  stub renamed `LLAMACPP_API_KEY`; `boot-3090.sh` strips `DSH_*` + cds to repo.
- 2026-10-03 — plan written to `plan/`.

## Reminders

- Never touch `:3080` / `:8080` / `:11434`. Never spawn `dsh web` from agent.
- Never push. No key talk. No `deepseek-harness` archaeology.
