# M4 — Memory rightbar

**Goal:** the human surface. Three jobs only: read the files, edit them, and see
**cap pressure** — because cap pressure is where the add decision happens
(`DESIGN.md` §3). Promotion from inbox to `ME.md` is a human edit here. There is
no promote button and no automation behind it.

Seats and client rules: see
[`skills/dsh-out-of-tree-plugin/SKILL.md`](../skills/dsh-out-of-tree-plugin/SKILL.md)
— rightbar tab via `sidebarRightTabs.register` + keyed `sidebar.right.pane.tab`,
register at `apply` top level (not inside a React effect), inline styles only,
CJS client via the ModuleLoader wrapper.

## Deliverables

```text
src/host/index.ts        + PUT /api/dsh-memento/file  (write ME.md / project MEMORY.md)
                         + DELETE /api/dsh-memento/inbox/:line
src/client/MemoryBody.tsx     three sections
src/client/MemoryTitle.tsx    tab title + over-cap tint
src/client/MemoryIcon.tsx
src/client/useMemory.ts       poll /state + /compliance
src/client/store.ts
agent/accept-m4.mjs
```

### Pane layout

1. **ME.md** — editable textarea, live line counter `9 / 30`. At or over cap the
   counter turns warn/crit and shows *"at cap — adding a line means removing one"*.
   That sentence is the whole design; do not soften it.
2. **Project `<key>`** — same, cap 45. If absent, an explicit *"no project memory"*
   state with a **Create** action (this is the only place the file gets created).
3. **Inbox (tail 20, newest first)** — read-only lines, each with a delete
   affordance. No promote action; the human copies a line up into section 1 or 2
   by hand. Show total count.

Plus a compliance strip from M3: *"ritual: 7/9 sessions"* with the current
session's state. Small, one line.

### Write route

- `PUT /api/dsh-memento/file` with `{ target: "me" | "project", content }`.
- Target allowlist only — the route must refuse any path outside
  `~/.dsh/memory/`, including via `..`. Reject with 400.
- Writes are atomic: temp file in the same directory, then rename.
- **Over-cap content is accepted**, not rejected, and `overCap` is reported. The
  human is allowed to be over cap; they just have to see it.
- No reformatting, no trimming, no sorting, no frontmatter injection.

## Acceptance — `node agent/accept-m4.mjs` exits 0

1. `PUT` with `target: "me"` writes exactly the bytes sent (sha256 match), and
   is atomic (no partial file observable; temp file cleaned up).
2. `PUT` with a path-traversal attempt in `target` → 400, nothing written.
3. `PUT` 40 lines → 200 OK, and `/state` reports `overCap: true` (accepted, not refused).
4. `DELETE /inbox/:line` removes exactly that line; the rest is byte-identical.
5. **Create** on a missing project file creates it; calling it again does not
   overwrite existing content.
6. Client builds: `lib/client.js` exists, is CJS, and only `require`s platform
   baseline modules (assert no bare `require` of anything outside the allowlist).
7. `/state` and `/compliance` poll without error for 30s with no handle leaks
   (route + timers disposed on unload).

Manual, once: hard-refresh `:3090`, the **Memory** tab shows all three sections,
editing `ME.md` in the pane changes the file on disk, and the cap counter turns
warn at 30 lines.

## Do not

- Do not add a promote button, a merge action, or any automated move from inbox
  into the injected tier. Human edit only.
- Do not sort, dedupe, or reformat file contents.
- Do not add search UI. `rg` is the search engine (`DESIGN.md` §4).
- Do not add a CSS pipeline.

## Done

accept-m4 green + manual glance on `:3090` + local `git commit` + `STATUS.md` rewritten.
