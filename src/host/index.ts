/**
 * Host half of dsh-memento (M1: vault + cache-stable inject).
 *
 * - Bootstraps the vault (`~/.dsh/memory/`): directories created recursively,
 *   ME.md seeded from the bundled template only when absent, existing ME.md
 *   never touched, project MEMORY.md never auto-created.
 * - GET /api/dsh-memento/state — vault + inject state for the project the dsh
 *   web server was launched in (process cwd); fail-open, always JSON.
 * - GET /api/dsh-memento/health — unchanged M0 contract.
 * - Session-start inject: `agent/pre-step` waterfall delivering the block as a
 *   plugin-attributed UserMessage (see inject.ts). Installed at the root
 *   loader scope so every session is covered; root-scope listeners are
 *   admitted globally by dsh-scope.
 *
 * apply must never throw: every registration degrades to a logged error.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { cwd as processCwd } from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  HEALTH_ROUTE,
  MILESTONE,
  PLUGIN,
  STATE_ROUTE,
  VERSION,
  type HealthPayload,
  type StatePayload,
} from '../shared/types.ts'
import {
  INJECT_BUDGET,
  bootstrapVault,
  buildInjectBlock,
  projectKey,
  readVault,
  resolveDshHome,
} from './vault.ts'
import { createMementoUserMessage, installSessionStartInject, type PrepareInject } from './inject.ts'
import ME_TEMPLATE from '../../assets/ME.template.md'

export const name = PLUGIN
export const inject: string[] = []

export { HEALTH_ROUTE, STATE_ROUTE } from '../shared/types.ts'

const DSH_HOME = resolveDshHome()

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function registerHealthRoute(ctx: Context): void {
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
        } catch (error) {
          // Degraded route: error JSON, never a throw into the harness.
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: health route')
}

function registerStateRoute(ctx: Context): void {
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: STATE_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          if (req.method !== 'GET') {
            send(res, 405, { ok: false, error: 'method not allowed; use GET' })
            return
          }
          // Server-global route: the observed project is the one this dsh web
          // process was launched in. Per-session keys are used by the inject.
          const key = projectKey(processCwd())
          const state = readVault(DSH_HOME, key)
          const block = buildInjectBlock(state)
          const payload: StatePayload = {
            ok: true,
            me: {
              path: state.me.path,
              lines: state.me.lines,
              cap: state.me.cap,
              overCap: state.me.overCap,
              exists: state.me.exists,
            },
            project: {
              key,
              path: state.project.path,
              lines: state.project.lines,
              cap: state.project.cap,
              overCap: state.project.overCap,
              exists: state.project.exists,
            },
            inject: {
              chars: block.chars,
              budget: INJECT_BUDGET,
              truncated: block.truncated,
            },
          }
          send(res, 200, payload)
        } catch (error) {
          // Unreachable in practice (readVault never throws); fail-open shape.
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: state route')
}

/** One-time vault bootstrap; logged, never thrown. */
function bootstrap(ctx: Context): void {
  try {
    const result = bootstrapVault(DSH_HOME, ME_TEMPLATE)
    ctx.logger?.('dsh-memento')
      .info('vault ready at %s (ME.md %s)', result.root, result.created ? 'created from template' : 'already present')
  } catch (error) {
    ctx.logger?.('dsh-memento')
      .warn('vault bootstrap failed (continuing without vault): %s', errorMessage(error))
  }
}

/** Build the block + attributed UserMessage for one project key, or undefined. */
function prepareInject(key: string): { message: UserMessage; block: import('./vault.ts').InjectBlock } | undefined {
  const state = readVault(DSH_HOME, key)
  const block = buildInjectBlock(state)
  if (block.block.length === 0) return undefined
  const message = createMementoUserMessage(
    [{ type: 'text', text: block.block }],
    {
      kind: 'dsh-memento',
      form: 'memory-baseline',
      version: 1,
      key,
      meLines: state.me.lines,
      projectLines: state.project.lines,
      truncated: block.truncated,
    },
  )
  return { message, block }
}

/**
 * Wire the session-start inject (root scope). Fail-open by construction:
 * registration problems are logged, never thrown.
 */
function installInject(ctx: Context): void {
  try {
    const prepare: PrepareInject = (key: string) => prepareInject(key)
    installSessionStartInject(ctx, prepare)
  } catch (error) {
    ctx.logger?.('dsh-memento')
      .warn('session-start inject install failed (continuing without inject): %s', errorMessage(error))
  }
}

export function apply(ctx: Context): void {
  // Vault bootstrap runs in every profile (web or headless) — the memory
  // block is useful wherever a session starts.
  bootstrap(ctx)
  // Session-start inject for every agent, any profile.
  installInject(ctx)
  // Routes only exist where a web server is present (dsh web); headless
  // profiles simply skip them.
  ctx.inject(['webServer'], (webCtx: Context) => {
    try {
      registerHealthRoute(webCtx)
      registerStateRoute(webCtx)
    } catch (error) {
      webCtx.logger?.('dsh-memento')
        .error('route registration failed: %s', errorMessage(error))
    }
  })
}
