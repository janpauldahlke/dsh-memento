# dsh-memento — origin research (HISTORICAL)

> **Superseded. Do not implement from this file.**
> The current design and milestones live in [`plan/DESIGN.md`](../plan/DESIGN.md) and
> `plan/M0`–`M5`. `DESIGN.md` §0 tables exactly what this document got wrong.
> Kept because §3 (systems tried and rejected, with reasons) is the negative
> knowledge the whole design argues is most worth retaining — deleting it would
> mean re-exploring OpenViking and agentmemory in six months.
> Renamed from `docs/SPEC.md` on 2026-10-03.

Captured 2026-10-02 after researching DSH memory plugins, trying agentmemory, and comparing to Eris.  
**No code yet.** This document is the thinking we do not want to lose.

---

## 1. Problem

DeepSeek Harness sessions start cold. The human re-explains who they are, sacred ports, project lore, and past decisions. That breaks the feeling of continuity (bond) and wastes context.

We want:

- **Bond** — new sessions already “know” the human and active project.
- **Knowledge base** — durable facts, preferences, lessons that grow over time.
- **Trust** — human can see, edit, and delete what the agent “remembers.”
- **Fit our machine** — local-hauhau nearly fills VRAM; no spare VLM; prefer in-process DSH plugins over fragile sidecars.

---

## 2. What “memory” is *not*

Do not confuse these with long-term memory:

| Thing | Reality |
| --- | --- |
| Chat history / compaction | Short-term; compaction shrinks model view, does not create cross-session LTM |
| `AGENTS.md` | Static human rules — necessary base layer, not a growing KB |
| Long-horizon task status | In-flight work state (`dsh-local-long-horizon`) |
| Handoff notes | One-shot continuity, not a second brain |
| Project RAG / code index | “What’s in the repo” — different problem |

Memento is **identity + preferences + durable project lore**, optionally growing into a larger KB.

---

## 3. What has proven to work (field + our stack)

### Coding-agent consensus (Claude Code, Codex, Cursor, field reports)

- Human-written rules files (`AGENTS.md` / `CLAUDE.md`) + **agent-written auto memory**.
- **Bounded index** always injected (`MEMORY.md`-style, hard line/char cap) + **topic files** loaded on demand.
- **Keyword / FTS first** — the LLM is a smart query author; plain filesystem often beats fancy pipelines on LoCoMo-ish practical tests.
- **Human visibility** — edit/delete builds trust.
- Lifecycle: durable facts only; merge / supersede / forget. Dump-everything stores rot.

Claude Code pattern (steal the *shape*):

- `MEMORY.md` = pointer index (≤200 lines / ~25KB loaded at session start).
- Topic files = detail; not all dumped into every prompt.
- Auto-save when the model judges durability (we prefer more explicit triggers for v0).

### Eris (our own system) — what to steal

Eris stack:

```text
Markdown vault (source of truth)
  → EmbeddingProvider (nomic)
  → Qdrant (768-d cosine, derived index)
  → turn-start prefetch → [RELEVANT_LEARNED_MEMORY]… inject (fail-open, char budgets)
```

Also: ephemeral moka tier + promote/decay + `memory:commit` (the “ladder”).

**Steal:**

- Vault/files as source of truth; vectors are derived and rebuildable.
- Turn-start **prefetch inject** with budgets and fail-open timeout.
- Separate embed from chat when needed (CPU / other port) — not on hauhau’s GPU.

**Do not steal for v0:**

- Full folder ontology (`00_Invariants`, `10_Topology`, …) — too heavy for bond memory.
- **Promote ladder** (stage → score → promote → commit) — this is the part that fights us; durability deferred until paperwork.
- Boot-ingest-the-world until the corpus is large enough that warm vectors pay off.

### Experiments we ran / rejected for *this* box

| System | Verdict |
| --- | --- |
| **OpenViking** | Official `@openviking/dsh-memory-plugin` exists; extract path wants a VLM we cannot afford beside local-hauhau. |
| **agentmemory** | Smoke: `remember` 201 + `smart-search` 200 once daemon stayed alive. Connect wired `~/.dsh/cordis.patch.yml` + hooks. Lifecycle (worker dying, multi-process, ports 3111–3113/49134) was wrong for day-to-day `dsh web`. **Fully undone** 2026-10-02 (patch restored, `~/.agentmemory` removed, `dsh-web` launcher removed). |
| **NattoCB `dsh-plugin-memory`** | Claude-like layers + keyword/LLM rank; no Memory UI; `0.1.0-rc.1`, tiny adoption — shape inspiration, not dependency. |

---

## 4. Product principles

1. **No slash-command as the product.** `/remember` and “please call `memory_remember`” are escape hatches, not the bond.
2. **One-step persist.** Parse → disk. No promote ladder in v0.
3. **In-process Cordis plugin.** Same dual-face bar as Processes (host tools + rightbar). No required sidecar for v0.
4. **Human co-steward.** Memory pane: list, edit, pin, forget, undo.
5. **Budgeted inject.** Always-on block stays tiny; detail via search / later prefetch.
6. **Vectors are a phase, not the identity.** Keyword until it fails; then Eris-style warm index.

---

## 5. Write paths

### v0 primary — conversational persist

Trigger patterns (exact regex TBD):

- `Remember this:` / `Remember:` …
- Later: `from now on`, `always`, `never` (correction / preference)

Behavior:

1. Detect on user message (host plugin, not model-voluntary).
2. Persist immediately to vault (preference or project scope by heuristic / cwd).
3. UI: quiet confirmation + **Undo** (toast or pane).
4. Optionally strip or keep the remember sentence in the chat transcript (decide in implementation).

### v0 secondary — tools

| Tool | Role |
| --- | --- |
| `memory_remember` | Agent escape hatch when it *knows* a fact must stick |
| `memory_recall` / `memory_search` | On-demand read |
| `memory_forget` | Remove by id / key |
| `memory_profile_get` / `_set` | Bond profile |

### Later (not v0)

| Trigger | Behavior |
| --- | --- |
| User corrects agent | Auto-write `preference` / `constraint` + Undo |
| Idle / pre-compaction | Propose ≤3 cards → **Pending** in pane (human Keep/Reject) |
| Optional extract via hauhau | Only when GPU free; never a second dedicated VLM |

---

## 6. Vault layout (thin Eris DNA)

Not the full Eris taxonomy — enough layers to grow:

```text
~/.dsh/memory/
  profile.md              # who the human is / global prefs (inject candidates)
  MEMORY.md               # global index — short pointers, hard-capped
  preferences/            # remember-this + corrections
    <id>.md
  projects/
    <repo-or-cwd-key>/
      MEMORY.md
      notes/
        <id>.md
  lessons/                # optional later

# Optional mirror for git-friendly project lore (decide at implement time):
<workspace>/.dsh/memory/
  MEMORY.md
  notes/
```

**Record shape (topic file, draft):**

```yaml
---
id: mem_…
type: preference | constraint | project | lesson | fact
scope: global | project
project: github.com-org-repo   # or cwd key
pinned: false
createdAt: ISO-8601
source: remember-this | correction | tool | pending-approve
---
Body text (the fact).
```

Index (`MEMORY.md`) = one-line pointers only (Claude rule). Detail stays in topic files.

---

## 7. Read / inject

### Always-on (session start / first pre-step)

Inject a **cache-stable** block (avoid reshuffling every tool step — KV cache lesson from field reports):

- Short profile summary (or pinned lines).
- Active project blurb / project `MEMORY.md` head (truncated).
- Hard budget (TBD: e.g. ≤2–4k chars total).

Use DSH `agent/pre-step` (or `agent.inject` at session start) with plugin-attributed `UserMessage` source — **not** system-prompt hacks that `complete: true` presets can wipe (OpenViking DSH notes).

### On demand

- Agent tools: search / recall.
- Later: Eris-style turn prefetch — embed query → top_k → `[RELEVANT_LEARNED_MEMORY]…[/…]` with `max_chars`, `min_score`, fail-open timeout.

### Growth ladder for retrieval

| Scale | Mechanism |
| --- | --- |
| Dozens of facts | Always-on inject + keyword search |
| Hundreds | sqlite FTS over vault |
| Thousands / paraphrase misses | CPU embed + Qdrant or sqlite-vec; warm on plugin boot; same prefetch contract |

---

## 8. Surfaces (target, when we build)

| Surface | Purpose |
| --- | --- |
| Host tools | `memory_*` |
| HTTP route | Pane polling / mutations (mirror Processes) |
| Rightbar **Memory** | Browse, pin, edit, forget, pending approvals |
| Dock chip | Optional: “Memory · N pending” when rightbar closed |
| Vault files | Human + git readable; source of truth |

Dual-face package shape: same as `dsh-agent-processes` (`dsh.bundle` + `dsh.client`, host ESM + client CJS).

---

## 9. Phased delivery

### v0 — Bond core (ship first)

- [ ] Vault layout + profile
- [ ] `Remember this:` → immediate persist + Undo
- [ ] Always-on inject (profile + project blurb)
- [ ] Tools: remember / search / recall / forget / profile
- [ ] Memory rightbar (list / edit / delete)
- [ ] `AGENTS.md` snippet for projects that want glue
- [ ] No vectors, no sidecar, no promote ladder, no auto-extract

### v1 — Search quality

- [ ] FTS (sqlite via `ctx.storage` or local index)
- [ ] Correction / “always|never|from now on” triggers
- [ ] Pending-approve queue (optional distill)

### v2 — Eris warm path (only if needed)

- [ ] CPU nomic (or MiniLM) embed on write
- [ ] Qdrant or sqlite-vec
- [ ] Boot warm + turn-start prefetch (fail-open)
- [ ] Still: files are truth; vectors are derived

---

## 10. Non-goals (v0)

- OpenViking / agentmemory / mem0 as runtime dependencies
- Slash-command-only UX
- Eris promote ladder
- Full vault ontology / Zettel
- GPU embeddings next to local-hauhau
- Auto-capturing every tool call into “memory”

---

## 11. Relationship to other pieces

| Piece | Role vs memento |
| --- | --- |
| `AGENTS.md` | Static rules; memento does not replace it |
| `dsh-local-long-horizon` | Task status; memento does not store in-flight todos |
| `dsh-agent-processes` | Process lifecycle; compose in profile, separate concerns |
| Eris | Inspiration for vault-as-truth + prefetch; separate product |

---

## 12. Open questions (sleep on these)

1. Project key: git `origin` normalized vs cwd basename vs explicit `.dsh/memory` config?
2. Strip `Remember this:` from the model-visible user message after persist, or leave it?
3. Global vs project default when scope is ambiguous?
4. Pending-approve in v0 or strictly v1?
5. Package name / dsh.pub id: `dsh-memento` locked?

---

## 13. Next step when ready

**Done — superseded 2026-10-03.** Milestones were written and the design changed
materially in the process. See [`plan/`](../plan/README.md). This file is history;
it is **not** the source of truth for anything.
