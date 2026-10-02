/**
 * Host half of dsh-memento (M0 skeleton).
 *
 * Registers exactly one web route — GET /api/dsh-memento/health — and disposes
 * it via ctx.effect. No vault access, no inject, no tools: M0 exists to make
 * failure modes boring. apply must never throw; the handler degrades to error
 * JSON instead of breaking the harness.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  HEALTH_ROUTE,
  MILESTONE,
  PLUGIN,
  VERSION,
  type HealthPayload,
} from '../shared/types.ts'

export const name = PLUGIN
export const inject: string[] = []

export { HEALTH_ROUTE } from '../shared/types.ts'

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function registerRoute(ctx: Context): void {
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: HEALTH_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          if (req.method !== 'GET') {
            send(res, 405, { ok: false, error: 'method not allowed; use GET' })
            return
          }
          const payload: HealthPayload = {
            ok: true,
            plugin: PLUGIN,
            version: VERSION,
            milestone: MILESTONE,
          }
          send(res, 200, payload)
        } catch (err) {
          // Degraded route: error JSON, never a throw into the harness.
          send(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: health route')
}

export function apply(ctx: Context): void {
  // Nested inject: activates when webServer exists (dsh web); no-op headless,
  // so the host half can load in any profile. A registration failure (e.g. a
  // route collision) is logged and swallowed — apply never throws.
  ctx.inject(['webServer'], (webCtx: Context) => {
    try {
      registerRoute(webCtx)
    } catch (err) {
      webCtx.logger?.('dsh-memento')
        .error('route registration failed: %s', err instanceof Error ? err.message : String(err))
    }
  })
}
