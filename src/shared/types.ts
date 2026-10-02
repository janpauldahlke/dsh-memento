/**
 * Shared constants and types for the dsh-memento dual-face package.
 *
 * M0: no payload types yet — the health route answers a fixed JSON literal.
 * Vault-state and inbox payload contracts land with M1/M2.
 */

/** Package identity (≡ package.json `name`). */
export const PLUGIN = 'dsh-memento'

/** Host HTTP route (exact path, no trailing slash). */
export const HEALTH_ROUTE = '/api/dsh-memento/health'

/** Package version, mirrored from package.json by the host health payload. */
export const VERSION = '0.1.0'

/** Milestone the running build reports. */
export const MILESTONE = 'M0'

/** Client rightbar tab identity. */
export const TAB_ID = 'dsh-memento'
export const TAB_KIND = 'memento'
export const TAB_TITLE = 'Memory'

/** Health payload served by GET /api/dsh-memento/health (M0). */
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
