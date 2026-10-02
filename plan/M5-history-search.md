# M5 — `memory_history_search` (archaeology)

**Goal:** one read-only tool that answers the single question nothing else can:
*"did we already try this, and what happened?"*

This is the **only** use of the DSH session logs in the whole design. They were
measured and rejected as a memory *source* (`DESIGN.md` §5): the free
`compaction/summary` events are task-shaped, the correction signal is 9/838, and
`session.v3` carries a schema version that will churn. But as a grep target they
are free — 41 sessions, 32 MB zstd, sub-second — and need no index, no schema,
and no write discipline.

**Nothing found here is ever copied into the vault.** The log is the episodic
record, the vault is the semantic one. Copying between them is what creates rot.

## Deliverables

```text
src/host/history.ts   scan + decompress + match, bounded
src/host/tools.ts     + memory_history_search
agent/accept-m5.mjs
test/history.test.mjs
```

### Tool contract

```jsonc
// memory_history_search
{ "query": "string, required, literal substring or simple regex",
  "project": "string, optional cwd key; default = current session's",
  "allProjects": "boolean, default false",
  "limit": "number, default 10, max 50" }
```

Returns, newest first:

```json
{ "ok": true, "scanned": 12, "hits": [
  { "projectKey": "--home-hagbard-dev-overnite--",
    "sessionId": "session-92a9804f-...",
    "time": "2026-09-24T22:07:11+02:00",
    "eventType": "user/message",
    "snippet": "...±200 chars around the match..." } ],
  "truncated": false, "degraded": [] }
```

### Robustness rules (these are the milestone, not the grep)

- **Read-only.** Never write, move, or delete anything under `~/.dsh/sessions/`.
  Never touch `session.lock`.
- **Schema-tolerant.** Glob `session.v*.jsonl.zstd` — not `v3`. Per line: parse
  JSON, read `type` and `time` if present, and otherwise search the *raw line
  text*. Never assume a payload shape. A line that fails to parse is searched as
  a string, not an error.
- **Bounded.** Hard caps: 2s total wall clock, 64 MB decompressed scanned, 50
  hits. On any limit, return what you have with `truncated: true`. Never
  unbounded-buffer a decompressed log — stream it line by line.
- **Fail-open.** Missing directory, unreadable file, corrupt zstd, zstd binary
  absent → that file is listed in `degraded[]` and skipped. The call still
  returns `ok: true`. Never throw.
- **Snippets, never transcripts.** Max 400 chars per hit. This tool must not
  become a way to pull a whole old session into context.

## Acceptance — `node agent/accept-m5.mjs` exits 0

1. Known-present string: search `"Disk is law"` across all projects → ≥1 hit,
   with a real `sessionId` that exists on disk and a non-empty snippet.
2. Known-absent string: search a random UUID → `hits: []`, `ok: true`, **exit 0**
   (an empty result is not an error).
3. `project` scoping: a search restricted to one cwd key returns hits only from
   that key's directory.
4. Missing dir: point the scanner at a non-existent path → `ok: true`,
   `hits: []`, `degraded` non-empty, no throw.
5. Corrupt file: write a truncated/garbage `.zstd` into a temp sessions tree →
   it appears in `degraded[]`, other files still searched.
6. Bounds: `limit: 100` is clamped to 50. A pathological broad query (`"e"`)
   returns within the 2s budget with `truncated: true`.
7. Snippets are ≤400 chars each.
8. Read-only proof: sha256 of every file under a temp sessions tree is unchanged
   after a search run.
9. `ME.md` sha256 unchanged (carried forward from M2).

## Do not

- Do not extract, distil, classify, or summarise log content.
- Do not copy hits into `inbox.md`, `ME.md`, or any project file.
- Do not build an index, cache, or warm store over the logs.
- Do not call this tool automatically on turn start or from the inject path. It
  is agent-invoked, on demand, for cold cases.
- Do not parse `compaction/summary` specially. It is just text to grep.

## Done

accept-m5 green + local `git commit` + `STATUS.md` rewritten.

---

## After M5

The plan is complete. **M6+ is deliberately not planned.** Repetition detection
and FTS are candidates only if M1–M5 demonstrably fail in daily use; vectors,
Qdrant, and embeddings are out of scope regardless (`DESIGN.md` §0). The next
artifact after M5 is not a feature — it is a written judgement in `STATUS.md`
about whether the ritual compliance rate and the cap pressure actually produced
a warmer session.
