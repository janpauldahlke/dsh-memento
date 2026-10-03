/**
 * Shared constants and types for the dsh-memento dual-face package.
 */

/** Package identity (≡ package.json `name`). npm: dsh-local-memento. */
export const PLUGIN = 'dsh-local-memento'

/** Host HTTP route (exact path, no trailing slash). */
export const HEALTH_ROUTE = '/api/dsh-memento/health'

/** Host HTTP route: vault + inject state for the launched project. */
export const STATE_ROUTE = '/api/dsh-memento/state'

/** Host HTTP route: append one entry to the inbox (M2). */
export const CAPTURE_ROUTE = '/api/dsh-memento/capture'

/** Host HTTP route: remove the last inbox entry this instance appended (M2). */
export const UNDO_ROUTE = '/api/dsh-memento/undo'

/** Host HTTP route: ritual compliance for the most recent (or a named) session (M3). */
export const COMPLIANCE_ROUTE = '/api/dsh-memento/compliance'

/**
 * File-write route (M4): `PUT` with a JSON body `{ target, content }`
 * atomically replaces `ME.md` (target `me`) or the project `MEMORY.md`
 * (target `project` — the server-launched project, or `key` when given).
 */
export const FILE_ROUTE = '/api/dsh-memento/file'

/**
 * Inbox line-delete prefix (M4): `DELETE /api/dsh-memento/inbox/line/N`
 * removes exactly the Nth line (1-based) of `inbox.md`. Registered as a
 * `prefix` web route — the harness web server matches exact or prefix only.
 */
export const INBOX_DELETE_ROUTE = '/api/dsh-memento/inbox/line'

/** Package version, mirrored from package.json by the host payloads. */
export const VERSION = '1.0.1'

/** Milestone the running build reports. */
export const MILESTONE = 'M5'

/** Host HTTP route: enable/disable via `~/.dsh/memory/.off` (REVIEW-01 R2). */
export const ENABLED_ROUTE = '/api/dsh-memento/enabled'

/** Agent tool name (M5): read-only session-log archaeology. */
export const HISTORY_SEARCH_TOOL = 'memory_history_search'

/** Client rightbar tab identity (matches package name / ModuleLoader id). */
export const TAB_ID = 'dsh-local-memento'
export const TAB_KIND = 'memento'
export const TAB_TITLE = 'Memory'

/** Health payload served by GET /api/dsh-memento/health. */
export interface HealthPayload {
  ok: boolean
  plugin: string
  version: string
  milestone: string
}

/** Error payload for a degraded health route. */
export interface HealthErrorPayload {
  ok: false
  error: string
}

/** One file's entry in the state payload. */
export interface StateFilePayload {
  /** Absolute file path (the file may not exist). */
  path: string
  /** Logical line count (0 when absent/unreadable). */
  lines: number
  /** The hard line cap for this file (report only — never enforced by edit). */
  cap: number
  /** `lines > cap`. */
  overCap: boolean
  /** Whether the file exists and is readable. */
  exists: boolean
  /**
   * Verbatim content when the file exists and is readable (M4: the pane's
   * editor is seeded from it). Absent when the file is missing/unreadable.
   */
  text?: string
  /**
   * `stat.mtimeMs` when the file exists (REVIEW-01 R1). The pane echoes this
   * on `PUT /file`; a mismatch yields 409. Absent when the file is missing.
   */
  mtimeMs?: number
}

/** One inbox line as listed by the state payload (M4): 1-based number + verbatim text. */
export interface InboxLinePayload {
  /** 1-based line number in `inbox.md` (the argument of the line-delete route). */
  n: number
  /** The line's verbatim text (no trailing newline). */
  text: string
}

/** `GET /api/dsh-memento/state` success payload. */
export interface StatePayload {
  ok: true
  /**
   * Master switch (REVIEW-01 R2): `false` when `~/.dsh/memory/.off` is
   * present. Inject, capture, and compliance tracking are all stopped.
   */
  enabled: boolean
  me: StateFilePayload
  project: {
    /** The project key the observation was derived from (`--slug--`). */
    key: string
    /**
     * Absolute cwd of the dsh web process (the project this observation is
     * for). Shown in the pane; the opaque key stays in the tooltip.
     */
    cwd: string
    path: string
    lines: number
    cap: number
    overCap: boolean
    exists: boolean
    /** Verbatim content when the file exists and is readable (M4). */
    text?: string
    /** `stat.mtimeMs` when the file exists (REVIEW-01 R1). */
    mtimeMs?: number
  }
  /** The inbox's tail for the Memory pane (M4): newest first, up to 20 lines. */
  inbox: {
    /** Absolute path of `inbox.md` (the file may not exist). */
    path: string
    /** `true` when the file exists and is readable. */
    exists: boolean
    /** Total logical lines in the inbox (0 when absent). */
    total: number
    /** Up to the 20 newest lines, newest first. */
    lines: InboxLinePayload[]
  }
  inject: {
    /** Characters the session-start block would inject for this project. */
    chars: number
    /** The 4000-char ceiling. */
    budget: number
    /** True when the project section would be dropped for the ceiling. */
    truncated: boolean
    /**
     * Verbatim inject block bytes (REVIEW-01 R3). Empty string when nothing
     * would be sent (or when disabled).
     */
    text: string
  }
}

/** Error payload for a degraded state route (should be unreachable: fail-open). */
export interface StateErrorPayload {
  ok: false
  error: string
}

/** `POST /api/dsh-memento/capture` request body (M2). */
export interface CaptureRequest {
  /** The text to capture (newlines collapse to a single space). */
  text: string
  /**
   * Project key override. Defaults to the key of the server's launched
   * process cwd (the same project `GET /state` observes).
   */
  key?: string
}

/** `POST /api/dsh-memento/capture` success payload. */
export interface CapturePayload {
  ok: true
  /** `false` when the plugin is disabled (`~/.dsh/memory/.off` present). */
  captured: boolean
  /** The exact line written to `inbox.md` (no trailing newline). */
  line?: string
  /** Present when `captured` is false. */
  reason?: 'disabled'
}

/** `POST /api/dsh-memento/undo` payload (M2). */
export interface UndoPayload {
  ok: true
  /** True when an entry was removed; false when there was nothing to undo. */
  undone: boolean
  /** The removed line (only when `undone` is true). */
  line?: string
}

/** `PUT /api/dsh-memento/file` request body (M4). */
export interface FileRequest {
  /** Which allowlisted file to replace: `me` → `ME.md`, `project` → project `MEMORY.md`. */
  target: 'me' | 'project'
  /** The exact new content (written verbatim, no reformat). */
  content: string
  /**
   * Project key override for target `project`. Defaults to the key of the
   * server's process cwd. The pane should pass the key from `GET /state`
   * so saves follow the open session workspace.
   */
  key?: string
  /**
   * Optimistic-concurrency token (REVIEW-01 R1): the `mtimeMs` last seen via
   * `GET /state`. When the file exists and this no longer matches, the host
   * replies 409 and writes nothing. Omit to skip the check (create / legacy).
   */
  mtimeMs?: number
}

/** `PUT /api/dsh-memento/file` success payload (M4). */
export interface FilePayload {
  ok: true
  target: 'me' | 'project'
  /** Absolute path of the file that was replaced. */
  path: string
  /** Logical line count of the content just written. */
  lines: number
  /** The hard line cap for that file (report only — over-cap content is accepted). */
  cap: number
  /** `lines > cap` (the write still succeeded). */
  overCap: boolean
  /** `stat.mtimeMs` of the file after the write. */
  mtimeMs: number
}

/** `PUT /api/dsh-memento/file` conflict payload (REVIEW-01 R1). */
export interface FileConflictPayload {
  ok: false
  error: 'mtime mismatch'
  /** Current `mtimeMs` on disk (so the client can reload or retry). */
  mtimeMs: number
}

/** `POST /api/dsh-memento/enabled` request body (REVIEW-01 R2). */
export interface EnabledRequest {
  enabled: boolean
}

/** `POST /api/dsh-memento/enabled` success payload. */
export interface EnabledPayload {
  ok: true
  enabled: boolean
}

/** `DELETE /api/dsh-memento/inbox/line/N` payload (M4). */
export interface InboxDeletePayload {
  ok: true
  /** True when a line was removed; false when `N` was out of range or the inbox is absent. */
  removed: boolean
  /** The removed line (only when `removed` is true). */
  line?: string
}

/** `POST /api/dsh-memento/inbox/line` body — restore a promoted line (REVIEW-02 R9 Undo). */
export interface InboxInsertRequest {
  /** Exact line text to restore (single logical line). */
  text: string
  /** Preferred 1-based position; clamped to the end when out of range. */
  n?: number
}

/** `POST /api/dsh-memento/inbox/line` success payload. */
export interface InboxInsertPayload {
  ok: true
  inserted: true
  /** 1-based position actually written. */
  n: number
  line: string
}

/** One entry in a compliance report's `violations` (M3). */
export interface ComplianceViolationPayload {
  kind: 'mutation-before-memory-read'
  /** ISO local time of the violating tool call. */
  at: string
  /** Name of the tool call that violated. */
  tool: string
}

/** Rolling compliance history counts (M4): parsed from `.compliance.log`. */
export interface ComplianceHistoryPayload {
  /** Sessions logged so far (determined compliant or non-compliant). */
  total: number
  /** Sessions that read memory before their first mutation. */
  compliant: number
  /** Sessions that mutated before any memory read. */
  nonCompliant: number
}

/** `GET /api/dsh-memento/compliance` payload (M3). */
export interface CompliancePayload {
  ok: true
  /** The session this report covers (null when none is tracked). */
  sessionId: string | null
  /** False when the requested session is unknown to this instance. */
  known?: boolean
  /** The session's project key (null when the session has no cwd). */
  projectKey?: string | null
  /** True when a project `MEMORY.md` existed at session start. */
  ritualRequired?: boolean
  /** ISO local time of the first vault-path read (null when none). */
  memoryReadAt?: string | null
  /** ISO local time of the first file mutation (null when none). */
  firstMutationAt?: string | null
  /**
   * `true` / `false` when a ritual was required (a read-only session is
   * compliant); `null` when no ritual was requested.
   */
  compliant?: boolean | null
  violations?: ComplianceViolationPayload[]
  /**
   * Rolling history from `.compliance.log` (M4): the "7/9 sessions" rate for
   * the Memory pane's compliance strip. Omitted when the log is unreadable.
   */
  history?: ComplianceHistoryPayload
}
