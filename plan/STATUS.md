# STATUS — dsh-memento
Updated: 2026-10-03T14:47+02:00 · Phase: **npm rename → dsh-local-memento**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file,
**this file wins**. Keep ≤45 lines; rewrite at every working block.
## Next 3
1. **Human:** commit + push rename, `npm login`, `npm publish` as
   **dsh-local-memento@1.0.0** (no new dsh.pub PR — GitHub URL unchanged).
2. —
3. —
## Milestones
- [x] M0–M5 · [x] REVIEW-01 · [x] REVIEW-02 · [x] smoke scripted
- [x] Publish prep: generic ME.template, README+media, LICENSE in files,
  keywords, `AGENTS.md` → `plan/AGENTS.md`
## Blockers
- None.
## Done this block
- Generic `assets/ME.template.md` (rules + commented examples); rebuilt lib
  — no personal identity in shipped artifact.
- Sibling-style `README.md` + `media/*.png` (no username in shots).
- `package.json`: `files` includes LICENSE + media; discoverability keywords;
  repository/homepage.
- Moved overnight `AGENTS.md` to `plan/AGENTS.md` (not package root).
- Project purpose uses `~/…` shortPath (no home username in pane copy).
## Reminders
- Never write consumer ME.md except pane action. Cap STATUS ≤45 lines.
- Existing `~/.dsh/memory/ME.md` is never overwritten by install.
