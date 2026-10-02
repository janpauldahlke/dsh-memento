# M0 — dual-face skeleton

**Goal:** a package that installs, loads both halves, and answers one route.
No memory behaviour at all. This milestone exists to make failure modes boring.

Packaging authority: [`skills/dsh-out-of-tree-plugin/SKILL.md`](../skills/dsh-out-of-tree-plugin/SKILL.md).
Mirror `~/dev/dsh-agent-processes` structure. Do not invent seats or APIs.

## Prerequisite (human, before M0)

`/home/hagbard/dev/dsh-memento` is **not a git repository** (verified
2026-10-03). `PROTOCOL.md` makes a local commit part of every slice's Done, so
M0 cannot complete until this exists:

```sh
cd /home/hagbard/dev/dsh-memento && git init && git add -A && git commit -m "plan: plan/ + vendored dsh plugin skill"
```

Agent: if `git rev-parse --is-inside-work-tree` fails, **stop**, write the
blocker in `STATUS.md`, and do not `git init` on your own.

## Deliverables (exact paths)

```text
package.json          name "dsh-memento", type module, main "lib/index.js",
                      exports "." + "./client", dsh.bundle.patch + dsh.client
cordis.patch.yml      top-level array: - insert: [{ id: memento, name: dsh-memento }]
build.mjs             esbuild: src/host/index.ts -> lib/index.js (ESM)
                                src/client/index.tsx -> lib/client.js (CJS, ModuleLoader wrapper)
tsconfig.json
ENV.md                sacred ports, copied from sibling plugin
src/shared/types.ts   empty-ish shared types
src/host/index.ts     apply(ctx): register one web route, dispose via ctx.effect
src/client/index.tsx  apply(ctx): register rightbar tab stub ("Memory", empty body)
agent/accept-m0.mjs
```

Route shape (per SKILL.md corrections #4):
`{ kind: 'exact', path: '/api/dsh-memento/health', handler }` with **two
separate** `ctx.effect()` calls. `GET` returns:

```json
{ "ok": true, "plugin": "dsh-memento", "version": "0.1.0", "milestone": "M0" }
```

Host `apply` must never throw — degrade to error JSON.

## Acceptance — `node agent/accept-m0.mjs` exits 0

The script must assert, and print PASS/FAIL per check:

1. `lib/index.js` and `lib/client.js` both exist and are non-empty.
2. `package.json` has `main`, `dsh.bundle.patch`, and `dsh.client`.
3. `cordis.patch.yml` `name` === `package.json` `name`.
4. `curl -s -m 3 http://127.0.0.1:3090/api/dsh-memento/health` → JSON with
   `ok === true` and `milestone === "M0"`.
5. Re-running the script twice in a row gives the same result (no side effects).

Manual, once (not scripted): `dsh --profile web --dump-config` contains
`dsh-memento`, and the rightbar shows an empty **Memory** tab on `:3090`.

Install: `dsh plugin --profile web add /home/hagbard/dev/dsh-memento`.
If resolution fails, symlink into `~/.dsh/profiles/web/node_modules/dsh-memento`
(see SKILL.md) — do not rename the row to a relative path.

## Do not

- No vault access, no file reads under `~/.dsh/memory/`, no inject, no tools.
- No `--patch` as the shipping path; `dsh.bundle` from day one.
- No client CSS pipeline; inline styles only.

## Done

accept-m0 green on `:3090` + local `git commit` + `STATUS.md` rewritten.
