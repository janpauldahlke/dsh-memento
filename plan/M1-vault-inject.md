# M1 — vault + cache-stable inject

**This is the milestone that carries the idea.** If the project ships only M1 it
is still a win: a cold session already knows who the operator is.

## Deliverables

```text
src/host/vault.ts     paths, cwd-key derivation, read + line counting, cap report
src/host/inject.ts    build the session-start block (pure function, testable)
src/host/index.ts     + GET /api/dsh-memento/state, + session-start inject
assets/ME.template.md the seed file (see below)
agent/accept-m1.mjs
test/vault.test.mjs   node --test, pure unit tests for key derivation + caps
```

### Vault bootstrap (host `apply`)

- Ensure `~/.dsh/memory/` and `~/.dsh/memory/projects/` exist (`recursive: true`).
- If `ME.md` is **absent**, write `assets/ME.template.md`.
- If `ME.md` **exists**, never touch it. Not a merge, not a header fix, nothing.
- Project `MEMORY.md` is **not** auto-created. Absent is a valid state (inject
  omits the project section).

### cwd key

Derive from the session `cwd`, matching DSH's own session-directory naming,
verified on disk: `/home/hagbard/dev/overnite` → `--home-hagbard-dev-overnite--`
(lowercase, every run of non-alphanumeric chars → single `-`, wrapped in `--`).
Unit-test this against at least: `/home/hagbard/dev/overnite`,
`/tmp/lh-toy-hello`, `/home/hagbard/dev/dsh-agent-processes`, and `/`.

### `ME.template.md` content

Must open with the three rules so they sit in front of the model on every turn,
then a short seeded identity block, then a cap marker. Keep the whole template
**under 30 lines**:

```markdown
# ME — operator profile (cap: 30 lines, hand-edited only)
<!-- Rules: 1) never record what `rg` can find  2) must still be true in 3 months
     3) if you had to say it twice, it belongs here -->

- Jan Dahlke (`janpauldahlke`), solo developer. Author of Eris (Rust, Apache 2.0).
- Sacred ports: never bounce :3080 (dsh web), :8080 (llama), :11434 (ollama).
- Local-only agents. Small models. Precision over recall in every prompt.
- Prefers: direct answers, no fluff, peer tone, no test theater.
```

### `GET /api/dsh-memento/state`

```json
{ "ok": true,
  "me":      { "path": "...", "lines": 9,  "cap": 30, "overCap": false, "exists": true },
  "project": { "key": "--home-hagbard-dev-dsh-memento--", "path": "...",
               "lines": 0, "cap": 45, "overCap": false, "exists": false },
  "inject":  { "chars": 612, "budget": 4000, "truncated": false } }
```

### Inject contract

- Fires **once per session** (session start / first pre-step). Compute the block
  once, cache it on the session, return identical bytes for every subsequent
  step. Never recompute, never reorder.
- Content: `ME.md` verbatim, then project `MEMORY.md` verbatim if it exists.
- Ceiling 4000 chars. Over it: inject `ME.md` only, set `inject.truncated: true`.
  **Never** mid-file truncate.
- Delivered as a plugin-attributed `UserMessage`. Not a system-prompt mutation.
- If the vault is unreadable: inject nothing, log once, keep the session healthy.
  Fail-open is mandatory.

## Acceptance — `node agent/accept-m1.mjs` exits 0

Deterministic; **no model judgment anywhere**:

1. Fresh-vault bootstrap: against a temp `HOME`, `ME.md` is created from the
   template and is < 30 lines. Run again → file bytes **unchanged** (idempotent).
2. Cap report: write a 40-line `ME.md` → `state.me.overCap === true`, `lines === 40`,
   and the file is **not** modified by the plugin.
3. cwd keys match the real directories under `~/.dsh/sessions/` for at least two
   existing projects.
4. **Sentinel-in-log (the real test).** Append
   `SENTINEL-M1-<random>` to `ME.md`, run one turn on `:3090`, then
   `zstd -dc` the newest `~/.dsh/sessions/--home-hagbard-dev-dsh-memento--/session-*/session.v3.jsonl.zstd`
   and assert the sentinel string appears in an injected/user event. This proves
   the block actually reached the model without asking a model anything.
5. **Cache stability.** In a session with ≥3 steps, the sentinel-bearing block
   appears with identical surrounding bytes each time it is present; assert the
   injected payload is not duplicated per step and not reordered.
6. Fail-open: `chmod 000` the vault dir → one turn still completes, `state`
   returns `ok:true` with `exists:false`, nothing throws. Restore perms after.

## Do not

- Do not write, trim, reformat, or reorder `ME.md` / project `MEMORY.md`.
- Do not auto-create project `MEMORY.md`.
- Do not add frontmatter, ids, tags, or types to anything.
- Do not inject per-step or rebuild the block on tool results.
- Do not raise the caps or the 4000-char ceiling because "128k fits". See
  `DESIGN.md` §2.

## Done

accept-m1 green + local `git commit` + `STATUS.md` rewritten.
