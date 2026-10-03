# dsh-memento — overnight implementer notes

Lives under `plan/` on purpose: not a consumer `AGENTS.md`, and not part of the
published npm package. Rules: `plan/PROTOCOL.md`. Resume: `plan/STATUS.md`.

## Long horizon

Before coding, read `.dsh/task-status-inject.md` if present — it is binding
current task state (DeepSeek Harness injects project-root `AGENTS.md` when a
project has one; this file is for implementers only).
Use `status_*` tools to update Next (≤3), in-flight, done (with verify), and blocked.
Keep Long horizon **ON**. Mirror `plan/STATUS.md` Next 3 into `status_set_next`.
Do not invent a parallel STATUS novel; the vault owns the live board and root
`STATUS.md` is generated — do not hand-edit it as source of truth.
