# Design decisions

Read once. These are settled. Do not re-litigate during implementation; if a
decision blocks you, write the blocker in `STATUS.md` and stop.

## 0. What this supersedes in `archive/ORIGIN.md`

| SPEC said | Now |
| --- | --- |
| §5 `Remember this:` is the **primary** write path | It is a convenience (M2). The primary path is a human hand-editing `ME.md`. |
| §5 "persist immediately to vault (preference or project scope by heuristic)" | Persist to **inbox only**, no scope heuristic, no type. |
| §6 record frontmatter (`id/type/scope/pinned/source/...`) | **Dropped.** Plain lines. Location is the category. |
| §9 v1 FTS, v2 embeddings/Qdrant | **Out of scope entirely.** |
| §5 pending-approve distill | **Dropped.** No LLM calls in the plugin. |
| §12 Q1 project key | **Answered**: DSH's own cwd key (§2). |
| §12 Q2 strip trigger sentence | **Answered**: do not strip. Leave the message untouched. |
| §12 Q3 ambiguous scope | **Answered**: no scope decision exists. Inbox is global. |
| §12 Q4 pending-approve in v0 | **Answered**: no. |

Still open: §12 Q5 (package name). Assume `dsh-memento` until the human says otherwise.

## 1. Why not a store

Every store-based design dies the same way: it must decide, at write time,
whether a fact is durable. That is an absolute judgment about the future.
A local 8–26B model answers it badly, a human finds it tedious, and Eris's
stage→promote→commit ladder is what that judgment looks like once you take it
seriously. The fix is to **never ask the question**. See §3.

Evidence from the operator's own corpus (41 sessions, 838 user messages,
~/.dsh/sessions, measured 2026-10-03):

- 248 `compaction/summary` events, all on one fixed 8-section template. Seven of
  the eight sections are task/code state (`Files and Code`, `Current Work`,
  `Pending Jobs`, `Next Step`, …). It is a **handoff template**, not memory.
- Explicit correction phrasing: **9 hits in 838 user messages**, and the sampled
  hits were false positives ("no we stop the experiment here").
- Durable personal facts in the whole corpus: on the order of a dozen.

A dozen facts does not justify an extraction pipeline. It justifies a file.

## 2. The vault

```text
~/.dsh/memory/
  ME.md                       # human identity + standing prefs. CAP 30 lines. ALWAYS injected.
  inbox.md                    # append-only. NO cap. NEVER injected. Nobody reads it unprompted.
  projects/
    <dsh-cwd-key>/
      MEMORY.md               # project lore. CAP 45 lines. Injected when cwd matches.
```

**Project key = DSH's own session-directory naming**, verified on disk:
`/home/hagbard/dev/overnite` → `--home-hagbard-dev-overnite--`. Lowercase,
non-alphanumerics → `-`, wrapped in `--`. Match the host's convention exactly;
do not invent a git-origin scheme. Derive it from the session `cwd` field.

**Caps are load-bearing.** 30 and 45 lines are not budget guesses — the cap *is*
the curation mechanism (§3). Note the 128k context window does **not** justify
raising them: capacity was never the constraint, attention is. A small local
model degrades with irrelevant context even when it fits. Precision over recall.

Caps are enforced as **visible pressure, never silent truncation**. Over-cap is
reported by the state route and shown in the pane. The plugin does not trim files.

## 3. The add policy (the core of the design)

Two tiers, two different gates:

**Inbox — no gate.** Anything lands here. Appending is free *because the file is
never injected*; being wrong costs nothing. One line, ISO timestamp, no type,
no scope, no tags.

**Injected tier (`ME.md`, project `MEMORY.md`) — the cap is the gate.** Nothing
enters except when the human edits the file. If the file is at cap, adding a
line means choosing one to evict. That converts an impossible absolute judgment
("is this durable?") into a cheap comparison ("is this in the top 30?"). The
cost of deciding scales with *pressure*, not with volume: if you never hit the
cap, no decision is ever made.

**The agent may write the inbox. The agent may never write the injected tier.**
Weak judgment is kept away from the expensive surface. This is a code-level
invariant, see `PROTOCOL.md`.

Three rules for the human, stated in `ME.md`'s own header so they are always in
front of the model too:

1. **Never remember what you can grep.** File paths, function names, module
   layout, current code shape — that is an index lookup, not memory, and it will
   be wrong in two weeks. This is the largest source of rot in coding memory.
2. **The three-month test.** Would this still be true in three months? One
   binary question, which even a small model can apply. Replaces the taxonomy.
3. **The repeat is the label.** If you had to tell the agent the same thing
   twice, *that* is memory, and the second telling is the trigger. Near-perfect
   precision, low volume, and self-extinguishing — it fires exactly when the
   system failed.

## 4. The read path

One **cache-stable** injected block at session start: `ME.md` verbatim, plus the
project `MEMORY.md` for the matching cwd key. Hard ceiling 4000 chars; over that,
inject `ME.md` only and report the overflow. Identical bytes for the whole
session — never recomputed per step, never reordered. Delivered as a
plugin-attributed `UserMessage` (not a system-prompt mutation, which
`complete: true` presets can wipe).

On-demand reading is the agent's existing `read`/`rg` tools against
`~/.dsh/memory/`. **No search feature is built.** At this corpus size `rg` is the
search engine and the model is a competent query author.

## 5. DSH session logs — verdict: drop as a source, keep as a tool

`~/.dsh/sessions/<cwd-key>/session-<uuid>/session.v3.jsonl.zstd` is an
event-sourced append-only log (`user/message`, `assistant/message`, `tool/call`,
`tool/result`, `turn/*`, `compaction/*`). 41 sessions, 32 MB compressed.

**Rejected as a memory source**, for three measured reasons:

1. The free `compaction/summary` distillations are task-shaped (§1). Harvesting
   them yields stale task logs — and most of their content violates rule 1 of §3
   ("never remember what you can grep").
2. The correction signal is 9/838 and mostly false positives. The volume path
   does not exist.
3. `session.v3` carries a schema version in the filename. A memory store coupled
   to harness internals breaks on v4. (`session/end-seed` payloads are empty
   `{}` — not a usable continuity hook either.)

**Kept as a read-only archaeology tool** (M5), because it is genuinely free and
answers one question nothing else can: *"did we already try this, and what
happened?"* `zstd -dc | rg` over 32 MB is sub-second, needs no index, no schema,
and no write discipline. It is a cold-case tool used weekly, not a turn-time
retrieval path. Nothing from it is ever copied into the vault — the log is the
episodic record, the vault is the semantic one, and copying between them is what
creates rot.

## 6. Ritual enforcement (M3) — why this is the real work

The design depends on the agent obeying a protocol: re-read the memory file at
the start of a working block. The operator's own overnight prompt names the
failure mode: *"or you forget and lie."* A local model will sometimes skip it.

So the plugin's differentiated job is not storing anything. It is to **observe
whether the ritual happened and make the violation visible**: did a write/edit
tool fire in this session before any read of the memory files? That is a
mechanical check over the event stream, needs no model, and is the one thing on
this design that no existing memory plugin does.

M3 **observes and reports**. It does not block tool calls. Blocking is a
separate decision for the human, after the compliance numbers exist.
