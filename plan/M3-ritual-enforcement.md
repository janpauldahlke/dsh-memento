# M3 — ritual enforcement

**The differentiator.** No memory plugin on the shelf does this. Everything
before M3 is files and plumbing; this milestone addresses the actual failure
mode, named in the operator's own overnight prompt: *"or you forget and lie."*

The design depends on the agent re-reading memory at the start of a working
block. A small local model will sometimes skip it. So: **observe whether the
ritual happened, and make the violation visible.** No model is involved in the
check — it is a mechanical pass over the event stream.

## Deliverables

```text
src/host/compliance.ts   session-scoped state machine + classifier for events
src/host/index.ts        + hook session events, + GET /api/dsh-memento/compliance
assets/ritual.md         the directive appended to the M1 inject block
agent/accept-m3.mjs
test/compliance.test.mjs pure unit tests over synthetic event sequences
```

### The directive (appended to the M1 inject, stays cache-stable)

Keep it to three lines or fewer. Something like:

```markdown
<!-- ritual -->
Before your first file edit in this session, read
`~/.dsh/memory/projects/<key>/MEMORY.md` (if it exists). If it contradicts this
chat, the file wins.
```

The `<key>` is resolved at inject time. If the project file does not exist, omit
the directive entirely — do not instruct a read of a missing file.

### The check

Per session, track:

- `memoryReadAt` — first tool call that reads any path under `~/.dsh/memory/`
  (file-read tools, and shell invocations whose command string contains the
  vault path — `cat`, `rg`, `head`, etc.).
- `firstMutationAt` — first tool call that writes or edits a file, or a shell
  command that plausibly mutates (`>`/`>>`, `tee`, `git commit`, `sed -i`,
  `node build.mjs`). Keep the mutation list in one exported constant so it is
  reviewable and testable.
- `compliant` — `true` if `memoryReadAt` exists and precedes `firstMutationAt`,
  **or** if `firstMutationAt` never happened (a read-only session is compliant),
  **or** if no project `MEMORY.md` exists (no ritual was asked for → `null`, not `false`).

`GET /api/dsh-memento/compliance`:

```json
{ "ok": true, "sessionId": "...", "projectKey": "--home-hagbard-dev-dsh-memento--",
  "ritualRequired": true, "memoryReadAt": "2026-10-03T00:51:02+02:00",
  "firstMutationAt": "2026-10-03T00:52:40+02:00", "compliant": true,
  "violations": [] }
```

Persist nothing but a rolling tail: append one line per ended session to
`~/.dsh/memory/.compliance.log` (dot-prefixed, never injected, never shown as
memory). Cap it at 500 lines by rotation. This is the only file the plugin owns
and may write freely.

### Explicitly: observe, do not block

M3 does **not** reject or delay tool calls, and does not re-prompt the model.
Blocking changes agent behaviour and risks deadlocking a local model mid-task.
The decision to block is the human's, to be made after the compliance numbers
exist. Write the observed rate into `STATUS.md` when M3 lands.

## Acceptance — `node agent/accept-m3.mjs` exits 0

All checks run against **synthetic event sequences** — fully deterministic, no
live model:

1. read-then-mutate → `compliant: true`.
2. mutate-then-read → `compliant: false`, one entry in `violations`.
3. read-only session (no mutation) → `compliant: true`.
4. no project `MEMORY.md` → `ritualRequired: false`, `compliant: null`.
5. Vault read detected via **shell** (`rg SENTINEL ~/.dsh/memory/ME.md`) counts
   as `memoryReadAt`, not just via the file-read tool.
6. Mutation classifier unit tests: `node build.mjs`, `sed -i`, `echo x > f`
   classify as mutations; `ls`, `rg`, `git status`, `curl` do not.
7. `.compliance.log` gains exactly one line per ended session; at 500 lines it
   rotates and does not grow unbounded.
8. `ME.md` sha256 unchanged across the run (carried forward from M2).
9. The injected block with the directive is still **byte-identical across steps**
   (M1 check 5 must still pass — the directive must not break cache stability).

## Do not

- Do not block, retry, or re-prompt. Observation only.
- Do not surface compliance as a memory record or inject it back into the chat.
- Do not use a model to decide whether a tool call was a mutation; the constant
  list is the spec.
- Do not treat a missing project file as a violation.

## Done

accept-m3 green + local `git commit` + `STATUS.md` rewritten, including the
first observed compliance rate.
