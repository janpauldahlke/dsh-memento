# dsh-memento — implementation plan

Audience: **the local implementing agent** (and the human reviewing it).
Status: plan only. No code exists yet.

`archive/ORIGIN.md` is the *origin* document (research, rejected options). It is
superseded by this folder wherever the two disagree. See `DESIGN.md` §0.

## The idea in one paragraph

Memory is not a store you grow. It is a **small set of bounded files, rewritten
rather than appended, read by ritual rather than by judgment.** Writing is free
and ungated into an inbox nobody reads. Entry into the tiny always-injected
file is decided only when a hard line cap forces an eviction. The agent never
decides "is this worth keeping" — it is never asked, because local models answer
that question badly. The plugin's real engineering is not storage; it is
**enforcing the read ritual and making cap pressure visible.**

## Reading order

1. `PROTOCOL.md` — hard rules. Read before touching anything.
2. `DESIGN.md` — the decisions and why. Read once.
3. `STATUS.md` — **only** resume source. Next 3 lives here.
4. `M0`…`M5` — one milestone per file. Work in order.

Packaging knowledge is **not** duplicated in this plan. The authority is the
vendored skill [`skills/dsh-out-of-tree-plugin/SKILL.md`](../skills/dsh-out-of-tree-plugin/SKILL.md)
(219 lines, copied from `overnite`). Read it for anything about `dsh.bundle`,
`cordis.patch.yml`, client CJS wrapping, the acceptance port, or
install/resolution failures. Do not re-grep the harness tree.

## Milestones

| M | Deliverable | Carries the idea? |
| --- | --- | --- |
| M0 | Dual-face skeleton that loads and answers `/health` | no — scaffold |
| M1 | Vault + `ME.md` + cache-stable inject | **yes — most of the value** |
| M2 | Inbox write (`Remember:`) + Undo | no — convenience |
| M3 | Ritual enforcement (observe + report compliance) | **yes — the differentiator** |
| M4 | Memory rightbar pane (edit, cap pressure, compliance) | no — human surface |
| M5 | `memory_history_search` over DSH session logs | no — archaeology |

If only M1 ever ships, the project is ahead of where it started.
M6+ (repetition detection, FTS) is **not planned**. Vectors are out of scope.

## Done means

Per `PROTOCOL.md`: acceptance script green on the second port, local `git
commit`, and `STATUS.md` rewritten with a fresh timestamp and rotated Next 3.
No "shipped" claims without all three.
