# STATUS — dsh-memento

Updated: 2026-10-03T00:30+02:00 · Phase: **plan approved, M0 not started**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file, **this file wins**.
Keep this file ≤45 lines. Rewrite it at the end of every working block.

## Next 3

1. **M0 — skeleton.** `plan/M0-skeleton.md`. Dual-face package that loads
   and answers `GET /api/dsh-memento/health`. No features.
2. **M1 — vault + inject.** `plan/M1-vault-inject.md`. `~/.dsh/memory/ME.md`
   from template, cache-stable inject, sentinel proven in the session log.
3. **M2 — inbox write.** `plan/M2-inbox-write.md`. `Remember:` → append to
   `inbox.md` + Undo. No classification.

## Milestones

- [ ] M0 skeleton — loads, `/health` green
- [ ] M1 vault + inject — **the milestone that matters**
- [ ] M2 inbox + undo
- [ ] M3 ritual enforcement — the differentiator
- [ ] M4 Memory rightbar
- [ ] M5 `memory_history_search`

## Blockers

- **Self-check, then clear this line:** run `git rev-parse --is-inside-work-tree`.
  If it fails, STOP — the human must `git init` (see `M0-skeleton.md` →
  *Prerequisite*); you must not init it yourself.

## Done log

- 2026-10-03 — plan written to `plan/` (human-approved direction: bounded
  files + cap-as-gate + ritual enforcement; session-log harvest rejected).

## Reminders

- Acceptance on `:3090` only. Never touch `:3080` (dsh) or `:8080` (llama).
  `:11434` / ollama was deliberately shut down 2026-10-03 — do **not** restart it.
- `node build.mjs` must produce **both** `lib/index.js` and `lib/client.js`.
- **A GitHub remote exists** (`origin`). Commit locally; **never push, never
  force-push, never change the remote.** The human publishes.
- Plugin never writes `ME.md` or project `MEMORY.md`. Inbox only.
- No embeddings, no FTS, no LLM calls, no frontmatter schema. Ever.
