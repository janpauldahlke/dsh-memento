# STATUS — dsh-memento
Updated: 2026-10-03T15:20+02:00 · Phase **1.0.2 pane session-cwd**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file,
**this file wins**. Keep ≤45 lines; rewrite at every working block.
## Next 3
1. Rebuild + smoke; relaunch :3090; confirm Memory Project follows open workspace.
2. **Human:** commit + `npm publish` **dsh-local-memento@1.0.2** when ready.
3. —
## Milestones
- [x] M0–M5 · [x] REVIEW-01 · [x] REVIEW-02 · [x] smoke scripted
- [x] Publish prep + npm **dsh-local-memento@1.0.0 / 1.0.1**
## Blockers
- None.
## Done this block
- Pane `GET /state` takes `?cwd=` from open session (not processCwd).
- Client MemoryBody/Title pass sessionId/useSessions; saveFile sends project key.
- Dropped duplicate ME.md rules chrome (rules already live in the file).
## Reminders
- Never write consumer ME.md except pane action. Cap STATUS ≤45 lines.
- Inject already keyed on session.header.cwd — pane now matches.
