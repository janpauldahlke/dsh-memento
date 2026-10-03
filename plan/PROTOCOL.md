# Protocol for the implementing agent

You have **no memory** across turns. Chat is amnesia. **Disk is law.**

## Read first (order matters)

1. `plan/STATUS.md` — **only** resume source. Next 3 + blockers.
   If chat contradicts STATUS, **STATUS wins**.
2. `plan/M<n>-*.md` for the current slice only. Do not read ahead.
3. [`skills/dsh-out-of-tree-plugin/SKILL.md`](../skills/dsh-out-of-tree-plugin/SKILL.md)
   — packaging authority (vendored from `overnite`). Read the **Corrections** and
   **Anti-thrash** sections before debugging anything.
4. `ENV.md` — pinned versions and sacred ports. Not in git (local-only).

## Never read these (stale by design)

- `archive/` — the superseded origin research. It describes a **different**
  design (`Remember this:` as the primary path, frontmatter records, FTS, vector
  phases, a pending-approve queue, `memory_search`). Implementing from it will
  produce the wrong plugin. `plan/DESIGN.md` §0 already extracts everything from
  it that still applies; you need nothing else out of that folder.
- The root `README.md` — orientation for humans. Not a work source.
- Anything in `~/dev/eris` — inspiration only, not a dependency, and very large.

Your work comes from exactly one place: **Next 3 in `plan/STATUS.md`**. If a
task is not in Next 3, it is not your task tonight. Do not invent scope, do not
"improve" earlier milestones, do not read ahead to later ones.

## Sacred (never violate)

- **Never** kill or restart the operator's primary `dsh web` (`:3080`) or llama
  (`:8080`). Identify before touching: `ss -ltnp | grep ':3080'`. Verify what is
  actually listening at run time — do not assume this list is current.
- ollama (`:11434`) was **deliberately stopped** 2026-10-03 to free VRAM for the
  local coding model. Do not start it, and do not treat its absence as a fault.
- **Never** `pkill dsh` / `pkill node`. That cmdline shape also matches the
  sacred primary. Kill only a pid you verified by number.
- **`:3090` is human-owned.** Human boots it once with `./agent/boot-3090.sh`
  (must run with cwd = this repo — the script `cd`s there). Acceptance **reuses**
  it (`curl …/api/dsh-memento/health`). **Never** spawn / kill / respawn `dsh web`
  from inside an overnight agent turn — that inherits `DSH_PROFILE` /
  `DSH_WEB_URL` / … and breaks the launcher. Do **not** dig into
  `~/dev/deepseek-harness` to “fix” boot. If health fails → STATUS blocker, stop.
- **Never** `git push` / force-push / `git remote set-url`, and never touch
  branches other than the one you are on. An `origin` on GitHub **does** exist
  for this repo, so a push would be public and immediate. Local commits only;
  the human publishes.
- `ENV.md` and `.env.local` are gitignored on purpose (machine specifics and API
  keys). **Never** `git add -f` them, never print or log their contents, and
  never put a key in a commit message, `STATUS.md`, or chat.

### Keys + inference (settled — do not re-litigate)

| Env var | Role |
| --- | --- |
| `LLAMACPP_API_KEY=local` | dsh/pi-ai client stub (`.env.local`). **Never** `LLAMA_API_KEY`. |
| `COMPACT_API_KEY` | Akqui compaction only |

Do **not** discuss, rename, curl-auth, or invent stubs. Human owns `:8080`.
Verify once: `curl … :8080/v1/models` → `200`. CUDA OOM / llama down → STATUS
blocker, stop. Never touch `:3080` / `:8080` / `:11434`.

## Work loop (per slice)

1. Re-read `STATUS.md`.
2. Edit under `src/`.
3. `node build.mjs` → `lib/index.js` **and** `lib/client.js` must exist.
4. Confirm `:3090` healthy (`/api/dsh-memento/health`). Then
   `node agent/accept-m<n>.mjs` → must exit 0. (Script does not boot dsh.)
5. `curl` the host route; glance `:3090` for client changes (hard-refresh).
6. `git commit` locally.
7. **Rewrite `STATUS.md`**: fresh timestamp, checkboxes, rotate Next 3. Keep ≤45 lines.

Mid-slice context is disposable. End every working block by rewriting STATUS.

## Hard do-nots for this project

- **Do not** write to `~/.dsh/memory/ME.md` or any project `MEMORY.md` from
  code. Those files are human-owned. The plugin **reads** them and may *propose*
  edits through the pane. It never appends to them. (See `DESIGN.md` §3.)
- **Do not** add classification, tags, types, scores, `epistemic_status`,
  frontmatter schemas, or an ontology. The inbox is plain lines. The file's
  location is its only category.
- **Do not** add embeddings, Qdrant, sqlite-vec, or FTS. Not in any milestone.
- **Do not** parse DSH session logs for memory extraction. Read-only search
  only, and only in M5. (See `DESIGN.md` §5.)
- **Do not** call a model to judge durability, summarise, or distil. Zero LLM
  calls in the plugin.
- **Do not** modify `@deepseek-ai/dsh-client-*` packages.
- **Do not** exceed the caps in `DESIGN.md` §2. They are load-bearing, not taste.

## Anti-thrash (stuck > 15 min)

Run the checklist at the end of `SKILL.md` before investigating anything else.
Then write the blocker in `STATUS.md` and switch slices. Do not thrash silently.
