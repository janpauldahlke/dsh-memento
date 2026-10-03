# STATUS — dsh-memento
Updated: 2026-10-03T14:05+02:00 · Phase: **REVIEW-01 + compliance flush**
LAW: plan is `plan/`. Rules are `PROTOCOL.md`. If chat contradicts this file,
**this file wins**. Keep ≤45 lines; rewrite at every working block.
## Next 3
Source: `plan/REVIEW-02.md` — read the item in full first. Independent items.
1. **R10 — the cap has no overflow.** Nothing tells the agent the vault is
   readable/greppable, so 30 lines is the whole memory, not an injection
   budget. One sentence in `assets/ritual.md` + two copy fixes. **Highest
   leverage, smallest diff. Do not raise the caps.** (R12 template fix rides along.)
2. **R9 — promote affordance.** `↑ → ME` / `→ project` on inbox rows; appends
   to the **draft**, never to disk. At cap it must still append and go red —
   that is the design becoming visible. Extend `accept-m4.mjs` (5 checks).
3. **R11 — editor scrolls sideways.** `whiteSpace: 'pre'` → `pre-wrap`;
   relabel the counter `8 / 30 lines` since wrapping breaks the row/line match.
## Milestones
- [x] M0–M5 · [x] REVIEW-01 R1–R7 · [x] compliance live flush (was 0/0)
- [ ] REVIEW-02 (R9–R12)
## Blockers
- None. `:3090` relaunch after this block for v0.6.1 host.
## Done this block
- **Compliance fix (M3 intent):** root listeners use `{ global: true }`;
  tracker starts on `session/created`; idempotent flush on `session/disposed`
  + fiber unload. Live headless → `.compliance.log` line + history 1/1.
- Root cause: scoped session carriers filtered out untagged observers while
  agent/pre-step inject still worked — scorecard never flushed.
- REVIEW-01 R1–R7 still in tree (mtime/off/inject.text/pane help).
## Reminders
- No settings system, no configurable caps, no new deps.
- Never write ME.md / project MEMORY.md except via explicit pane action.
- Cap STATUS ≤45 lines.
