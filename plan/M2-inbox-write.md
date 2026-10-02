# M2 — inbox write + Undo

**Goal:** make capture free and ungated. The inbox is never injected and nobody
reads it unprompted, which is exactly why appending to it needs no judgment.

This is a convenience milestone. It must not grow a classifier.

## Deliverables

```text
src/host/inbox.ts     append + undo (last entry only)
src/host/index.ts     + trigger detection on user messages
                      + POST /api/dsh-memento/capture
                      + POST /api/dsh-memento/undo
src/host/tools.ts     memory_remember (escape hatch, writes inbox only)
agent/accept-m2.mjs
test/inbox.test.mjs
```

### Trigger

Case-insensitive, at the **start** of a user message only:
`Remember this:` / `Remember:` / `Note this:`

Anything else is not a trigger. No "always / never / from now on" detection in
this milestone — measured at 9 real hits in 838 messages, it is not worth the
false positives (`DESIGN.md` §1).

**Do not strip or rewrite the user's message.** It reaches the model unchanged
(`archive/ORIGIN.md` §12 Q2 is answered: leave it).

### Entry format — one line, nothing else

```text
2026-10-03T00:42:11+02:00 [--home-hagbard-dev-dsh-memento--] the thing after the trigger
```

No id, no type, no scope, no tags, no frontmatter, no multi-line blocks. If the
captured text contains newlines, collapse them to single spaces.

### Undo

- `POST /api/dsh-memento/undo` removes **only the last appended entry**, and
  only if this plugin instance appended it (hold the last byte offset in memory).
- After undo, `inbox.md` must be **byte-identical** to its pre-append state.
- Undo twice in a row: second call returns `{ ok: true, undone: false }`. Not an error.
- A quiet confirmation is surfaced to the human in M4's pane, not as a toast now.

## Acceptance — `node agent/accept-m2.mjs` exits 0

1. `POST /capture` with body text → `inbox.md` gains **exactly one** line
   matching the format regex, with a parseable ISO timestamp and the correct cwd key.
2. `POST /undo` → `inbox.md` byte-identical (compare sha256) to the snapshot
   taken before the capture.
3. Second `/undo` → `ok: true, undone: false`, file still unchanged.
4. Multi-line input → exactly one line written, no embedded `\n`.
5. Trigger unit tests: `Remember: x` and `remember this: x` match;
   `please remember: x` (not at start) and `I will remember` do **not** match.
6. `ME.md` sha256 is **unchanged** across the entire run. This assertion is
   mandatory in every future acceptance script too.
7. 200 sequential captures → 200 lines, no corruption, no truncation, and
   `state.inject.chars` is **unchanged** (proves inbox is never injected).

## Do not

- Do not classify, tag, score, or route entries anywhere.
- Do not write to `ME.md` or project `MEMORY.md` — including "promoting" an
  inbox line. Promotion is a human edit in the pane (M4), never code.
- Do not cap or rotate `inbox.md`.
- Do not call a model to clean up or summarise the captured text.

## Done

accept-m2 green + local `git commit` + `STATUS.md` rewritten.
