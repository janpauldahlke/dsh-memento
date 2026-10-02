# Overnight kickoff prompt

Paste the block below into a fresh local-agent session with cwd
`/home/hagbard/dev/dsh-memento`. Do not add context from chat — the files are
the context. (Keep this file short; it is a launcher, not documentation.)

---

You are the overnight dsh agent in `/home/hagbard/dev/dsh-memento`. You have
**no memory** across turns. Chat is amnesia. **Disk is law.**

## Read first (order matters)

1. `plan/PROTOCOL.md` — hard rules, including what you must **never** read.
2. `plan/STATUS.md` — **only** resume source. Next 3 is your entire scope.
   If chat contradicts STATUS, STATUS wins.
3. `ENV.md` — pinned `dsh` version, toolchain, sacred ports.
4. `plan/M<n>-*.md` for the current slice only. Do not read ahead.
5. `skills/dsh-out-of-tree-plugin/SKILL.md` — packaging authority. Read its
   **Corrections** and **Anti-thrash** sections before debugging anything.

Build a DSH memory plugin per `plan/DESIGN.md`. Do **not** read `archive/` —
it describes a superseded design and will make you build the wrong plugin.

## Protocol (or you forget and lie)

- **Done** = `node agent/accept-m<n>.mjs` exits 0 on `:3090` **+** local
  `git commit` **+** `plan/STATUS.md` rewritten with a fresh timestamp and
  rotated Next 3. No "shipped" claims without all three.
- Start every working block by re-reading `plan/STATUS.md`. End every block by
  rewriting it. Keep it ≤45 lines. Mid-block context is disposable.
- Sacred: never touch `:3080` (dsh) or `:8080` (llama). `:11434` was shut down
  on purpose — do not start it. Acceptance is `:3090` only.
- An `origin` remote exists. **Never push.** Local commits only.
- No test theater. Edit → `node build.mjs` → acceptance script → human judges.
- Blocked? Write it in `plan/STATUS.md` and move to another slice. Do not thrash.

## Hard do-nots for this project

No embeddings, no FTS, no vector store. No LLM calls inside the plugin. No
frontmatter schema, tags, types, or scores. The plugin **never** writes
`ME.md` or any project `MEMORY.md` — inbox only. Do not raise the line caps.

## First actions

1. `git rev-parse --is-inside-work-tree` — if it fails, STOP and report. Do not
   `git init` yourself.
2. Re-read `plan/STATUS.md`. Confirm Next 3; clear the self-check blocker if it passes.
3. `npm install` in the package root while the network is known-good.
4. `. ./.env.local` before booting acceptance on `:3090` — `dsh` needs the API
   keys in it and will otherwise fail to start. **Never print those keys.**
5. M0 only: `plan/M0-skeleton.md`. Stop at `accept-m0.mjs` green + commit + STATUS rewrite.
