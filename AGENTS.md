# dsh-memento

Overnight implementer for this installable DSH memory plugin.
Rules: `plan/PROTOCOL.md`. Resume detail: `plan/STATUS.md`.

## Long horizon

Before coding, read `.dsh/task-status-inject.md` if present — it is binding
current task state (DeepSeek Harness injects this AGENTS.md; the inject file is
the live board).
Use `status_*` tools to update Next (≤3), in-flight, done (with verify), and blocked.
Keep Long horizon **ON**. Mirror `plan/STATUS.md` Next 3 into `status_set_next`.
Do not invent a parallel STATUS novel; the vault owns the live board and root
`STATUS.md` is generated — do not hand-edit it as source of truth.
