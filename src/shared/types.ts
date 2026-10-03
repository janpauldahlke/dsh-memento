/**
 * Shared constants and types for the dsh-memento dual-face package.
 */

/** Package identity (≡ package.json `name`). */
export const PLUGIN = 'dsh-memento'

/** Host HTTP route (exact path, no trailing slash). */
export const HEALTH_ROUTE = '/api/dsh-memento/health'

/** Host HTTP route: vault + inject state for the launched project. */
export const STATE_ROUTE = '/api/dsh-memento/state'

/** Package version, mirrored from package.json by the host payloads. */
export const VERSION = '0.1.0'

/** Milestone the running build reports. */
export const MILESTONE = 'M1'

/** Client rightbar tab identity. */
export const TAB_ID = 'dsh-memento'
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
}

/** `GET /api/dsh-memento/state` success payload. */
export interface StatePayload {
  ok: true
  me: StateFilePayload
  project: {
    /** The project key the observation was derived from (`--slug--`). */
    key: string
    path: string
    lines: number
    cap: number
    overCap: boolean
    exists: boolean
  }
  inject: {
    /** Characters the session-start block would inject for this project. */
    chars: number
    /** The 4000-char ceiling. */
    budget: number
    /** True when the project section would be dropped for the ceiling. */
    truncated: boolean
  }
}

/** Error payload for a degraded state route (should be unreachable: fail-open). */
export interface StateErrorPayload {
  ok: false
  error: string
}
