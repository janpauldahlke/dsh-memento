# dsh-memento

> **Implementing agent: do not work from this file.** It is human orientation and
> contains no tasks. Go to [`plan/PROTOCOL.md`](./plan/PROTOCOL.md), then
> [`plan/STATUS.md`](./plan/STATUS.md) — **Next 3 there is your entire scope.**
> `archive/` is superseded and must not be implemented from.

**Persistent memory for DeepSeek Harness** — a warm start and durable project
lore across sessions, for **local-only agents**, without a second VLM, a memory
sidecar, or a vector store.

Status: **planned / pre-code.** No installable plugin yet.

| Document | Role |
| --- | --- |
| [`plan/KICKOFF.md`](./plan/KICKOFF.md) | The prompt to paste into the overnight local agent |
| [`plan/`](./plan/README.md) | **Current source of truth** — design decisions + M0–M5 with testable acceptance |
| [`plan/STATUS.md`](./plan/STATUS.md) | Only resume source for the implementing agent |
| [`archive/ORIGIN.md`](./archive/ORIGIN.md) | Origin research (incl. rejected options). Superseded by `plan/DESIGN.md` §0 |
| [`skills/dsh-out-of-tree-plugin/SKILL.md`](./skills/dsh-out-of-tree-plugin/SKILL.md) | How to build/install/verify a dual-face DSH plugin (vendored from `overnite`) |

Sibling plugins (dual-face `dsh.bundle` bar; we mirror their **packaging**, not
their interaction model — see `plan/DESIGN.md`):

| Plugin | Repo |
| --- | --- |
| Process & port lifecycle | [`dsh-agent-processes`](https://github.com/janpauldahlke/dsh-agent-processes) |
| Long-horizon task status | [`dsh-local-long-horizon`](https://github.com/janpauldahlke/dsh-local-long-horizon) |
| GPU monitor | [`dsh-gpu-monitor-nvml`](https://github.com/janpauldahlke/dsh-gpu-monitor-nvml) |
| Slot health | [`dsh-slot-health`](https://github.com/janpauldahlke/dsh-slot-health) |

---

## One-liner

Memory is not a store you grow. It is a **small set of bounded files, rewritten
rather than appended, read by ritual rather than by judgment.**

## The design in five lines

1. **`ME.md`** — ~30 lines, hand-edited, injected verbatim at session start.
   That is the whole bond layer. Measured: 41 sessions of real history yielded
   about a dozen durable personal facts. A dozen facts justifies a file, not a pipeline.
2. **The cap is the gate.** Nothing enters the injected files except when a hard
   line cap forces an eviction. That turns an impossible absolute judgment
   ("is this durable?") into a cheap comparison ("is this in the top 30?").
3. **`inbox.md`** — append-only, never injected, no gate, no tags, no types.
   Appending is free precisely because nobody reads it unprompted.
4. **The agent never writes the injected tier.** It may append to the inbox.
   Promotion is a human edit. This keeps weak local-model judgment away from
   the expensive surface.
5. **Ritual over judgment.** Read at block start, unconditionally. The plugin's
   real engineering is *verifying the ritual happened* — not storage.

Three rules that live in `ME.md`'s own header, so the model sees them too:
never remember what `rg` can find; it must still be true in three months; if you
had to say it twice, it belongs here.

## Deliberately absent

No embeddings, no Qdrant, no sqlite-vec, no FTS, no promote ladder, no
frontmatter schema, no LLM calls inside the plugin, and no extraction from the
DSH session logs. The logs were measured and rejected as a memory *source*
(their free summaries are task-shaped; the correction signal is 9 hits in 838
messages) but kept as a read-only archaeology tool — `plan/DESIGN.md` §5.

## Why not the existing shelf

| Approach | Why we stepped away |
| --- | --- |
| OpenViking / VikingMem | Strong architecture; needs an extract VLM we cannot afford next to local-hauhau |
| agentmemory + DSH connect | Remember/search worked in smoke; daemon lifecycle / ops friction was wrong for "just `dsh web`" |
| mem0-style many-files | Accumulation without rewrite — needs a ranker to survive its own growth |
| Eris promote ladder | Proven for large KBs, but stage→promote→commit is paperwork for bond facts. Four of its seven record fields exist only to service the ladder |

## License

TBD (likely MIT, matching siblings).
