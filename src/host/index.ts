/**
 * Host half of dsh-memento (M4: vault + cache-stable inject + inbox write +
 * ritual compliance + Memory pane backend).
 *
 * - Bootstraps the vault (`~/.dsh/memory/`): directories created recursively,
 *   ME.md seeded from the bundled template only when absent, existing ME.md
 *   never touched, project MEMORY.md never auto-created.
 * - GET /api/dsh-memento/state — vault + inject state for the project the dsh
 *   web server was launched in (process cwd); fail-open, always JSON.
 * - POST /api/dsh-memento/capture — append one entry to `inbox.md` (M2).
 * - POST /api/dsh-memento/undo — remove the last entry this instance
 *   appended (M2); byte-identical restore, no-op when nothing to undo.
 * - GET /api/dsh-memento/compliance — ritual compliance for the most recent
 *   (or `?sessionId=`-named) session (M3), with rolling history counts from
 *   `.compliance.log` (M4).
 * - PUT /api/dsh-memento/file — replace `ME.md` or the project `MEMORY.md`
 *   with exactly the given content, atomically (M4). Over-cap content is
 *   accepted and reported, never reformatted.
 * - DELETE /api/dsh-memento/inbox/line/N — remove exactly the Nth inbox
 *   line; every other byte is preserved (M4).
 * - POST /api/dsh-memento/inbox/line — insert/restore one inbox line
 *   (REVIEW-02 R9 Undo after promote-save).
 * - GET /api/dsh-memento/health — unchanged M0 contract.
 * - Session-start inject: `agent/pre-step` waterfall delivering the block as a
 *   plugin-attributed UserMessage (see inject.ts), with the M3 ritual
 *   directive appended when the project `MEMORY.md` exists. Installed at the
 *   root loader scope so every session is covered; root-scope listeners are
 *   admitted globally by dsh-scope.
 * - Trigger capture (M2): a user message starting `Remember this:` /
 *   `Remember:` / `Note this:` appends the rest of the message to `inbox.md`.
 *   The message reaches the model unchanged.
 * - `memory_remember` tool (M2): the model-facing escape hatch, inbox-only.
 * - Ritual compliance (M3): observes `tool/call` events per session
 *   (memoryReadAt vs firstMutationAt), appends a JSON line to
 *   `~/.dsh/memory/.compliance.log` when a session ends (rolling 500), and
 *   reports via the compliance route. Observation only — never blocks.
 *
 * apply must never throw: every registration degrades to a logged error.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cwd as processCwd } from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  CAPTURE_ROUTE,
  COMPLIANCE_ROUTE,
  ENABLED_ROUTE,
  FILE_ROUTE,
  HEALTH_ROUTE,
  INBOX_DELETE_ROUTE,
  MILESTONE,
  PLUGIN,
  STATE_ROUTE,
  UNDO_ROUTE,
  VERSION,
  type CapturePayload,
  type CaptureRequest,
  type CompliancePayload,
  type ComplianceViolationPayload,
  type EnabledPayload,
  type FileConflictPayload,
  type FilePayload,
  type FileRequest,
  type HealthPayload,
  type InboxDeletePayload,
  type InboxInsertPayload,
  type InboxInsertRequest,
  type StatePayload,
  type UndoPayload,
} from '../shared/types.ts'
import {
  INJECT_BUDGET,
  ME_CAP,
  PROJECT_CAP,
  bootstrapVault,
  buildInjectBlockWithRitual,
  countLines,
  projectKey,
  readVault,
  resolveDshHome,
  vaultPaths,
} from './vault.ts'
import {
  InboxStore,
  detectTrigger,
  inboxPath,
  insertInboxLine,
  isoLocal,
  readInboxTail,
  removeInboxLine,
} from './inbox.ts'
import {
  appendComplianceLog,
  complianceLogPath,
  readComplianceHistory,
  SessionComplianceTracker,
  type ComplianceSnapshot,
} from './compliance.ts'
import { isEnabled, setEnabled } from './enabled.ts'
import { writeFileAtomic } from './fsutil.ts'
import { createMementoUserMessage, installSessionStartInject, type PrepareInject } from './inject.ts'
import { registerTools } from './tools.ts'
import ME_TEMPLATE from '../../assets/ME.template.md'
import MEMORY_TEMPLATE from '../../assets/MEMORY.template.md'

export const name = PLUGIN
export const inject: string[] = ['tools']

export {
  CAPTURE_ROUTE,
  COMPLIANCE_ROUTE,
  ENABLED_ROUTE,
  FILE_ROUTE,
  HEALTH_ROUTE,
  INBOX_DELETE_ROUTE,
  MILESTONE,
  STATE_ROUTE,
  UNDO_ROUTE,
  VERSION,
} from '../shared/types.ts'

/** Seeded header written by the pane's Create action (REVIEW-01 R7). */
export const PROJECT_CREATE_SEED = MEMORY_TEMPLATE

const DSH_HOME = resolveDshHome()

/** M4: how many inbox lines the state payload lists for the pane. */
const INBOX_TAIL_LINES = 20

/** M4: request-body ceiling for the file-write route (512 KiB — plenty for a 45-line memory file). */
const MAX_FILE_BODY_BYTES = 512 * 1024

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

function registerStateRoute(ctx: Context, inbox: InboxStore): void {
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
          const cwd = processCwd()
          const key = projectKey(cwd)
          const enabled = isEnabled(DSH_HOME)
          const state = readVault(DSH_HOME, key)
          // Always expose the crafted block (trust surface). `enabled` says
          // whether a new session would actually receive it.
          const block = buildInjectBlockWithRitual(state, DSH_HOME)
          const inboxTail = readInboxTail(inbox.path, INBOX_TAIL_LINES)
          const payload: StatePayload = {
            ok: true,
            enabled,
            me: {
              path: state.me.path,
              lines: state.me.lines,
              cap: state.me.cap,
              overCap: state.me.overCap,
              exists: state.me.exists,
              ...(state.me.text !== undefined ? { text: state.me.text } : {}),
              ...(state.me.mtimeMs !== undefined ? { mtimeMs: state.me.mtimeMs } : {}),
            },
            project: {
              key,
              cwd,
              path: state.project.path,
              lines: state.project.lines,
              cap: state.project.cap,
              overCap: state.project.overCap,
              exists: state.project.exists,
              ...(state.project.text !== undefined ? { text: state.project.text } : {}),
              ...(state.project.mtimeMs !== undefined ? { mtimeMs: state.project.mtimeMs } : {}),
            },
            // M4: the pane's read-only inbox listing (newest 20, 1-based
            // line numbers the line-delete route understands). Fail-open:
            // absent inbox → exists:false, no lines.
            inbox: {
              path: inbox.path,
              exists: inboxTail.exists,
              total: inboxTail.total,
              lines: inboxTail.tail,
            },
            inject: {
              chars: block.chars,
              budget: INJECT_BUDGET,
              truncated: block.truncated,
              text: block.block,
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

/** Read a request body as UTF-8 text (empty body resolves to ''). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** Parse a capture body: `{"text": …, "key"?: …}` or plain text. */
function parseCaptureBody(raw: string): CaptureRequest | { error: string } {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { error: 'text required' }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'string') return { text: parsed }
    if (parsed !== null && typeof parsed === 'object' && 'text' in parsed) {
      const { text, key } = parsed as Record<string, unknown>
      if (typeof text !== 'string' || text.trim().length === 0) return { error: 'text required' }
      const request: CaptureRequest = { text }
      if (typeof key === 'string' && key.length > 0) request.key = key
      return request
    }
    return { error: 'expected a text string or { "text": … }' }
  } catch {
    // Not JSON: treat the raw body as the text itself.
    return { text: trimmed }
  }
}

/** `POST /api/dsh-memento/capture` — append one inbox entry (M2). */
function registerCaptureRoute(ctx: Context, inbox: InboxStore): void {
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: CAPTURE_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          if (req.method !== 'POST') {
            send(res, 405, { ok: false, error: 'method not allowed; use POST' })
            return
          }
          const body = await readBody(req)
          const parsed = parseCaptureBody(body)
          if ('error' in parsed) {
            send(res, 400, { ok: false, error: parsed.error })
            return
          }
          if (!isEnabled(DSH_HOME)) {
            const disabled: CapturePayload = { ok: true, captured: false, reason: 'disabled' }
            send(res, 200, disabled)
            return
          }
          // Default key: the project this dsh web process was launched in —
          // the same project `GET /state` observes.
          const key = parsed.key ?? projectKey(processCwd())
          const result = inbox.append(key, parsed.text)
          const payload: CapturePayload = { ok: true, captured: true, line: result.line }
          send(res, 200, payload)
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: capture route')
}

/** `POST /api/dsh-memento/undo` — remove the last appended entry (M2). */
function registerUndoRoute(ctx: Context, inbox: InboxStore): void {
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: UNDO_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          if (req.method !== 'POST') {
            send(res, 405, { ok: false, error: 'method not allowed; use POST' })
            return
          }
          // Body (if any) is ignored; undo always targets this instance.
          await readBody(req)
          const result = inbox.undo()
          const payload: UndoPayload = { ok: true, undone: result.undone, ...(result.line !== undefined ? { line: result.line } : {}) }
          send(res, 200, payload)
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: undo route')
}

/**
 * Parse a file-write body: `{"target": "me" | "project", "content": string,
 * "key"?: string}`. Anything else is a validation error (no plain-text
 * fallback — this route replaces curated files, so the body must be exact).
 */
function parseFileBody(raw: string): FileRequest | { error: string } {
  if (raw.length > MAX_FILE_BODY_BYTES) return { error: 'content too large (max 512 KiB)' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'expected a JSON body { "target": …, "content": … }' }
  }
  if (parsed === null || typeof parsed !== 'object') return { error: 'expected a JSON object' }
  const { target, content, key, mtimeMs } = parsed as Record<string, unknown>
  if (target !== 'me' && target !== 'project') {
    return { error: 'target must be "me" or "project"' }
  }
  if (typeof content !== 'string') {
    return { error: 'content must be a string (exact bytes to write)' }
  }
  const request: FileRequest = { target, content }
  if (key !== undefined) {
    if (typeof key !== 'string' || key.length === 0) return { error: 'key must be a non-empty string' }
    request.key = key
  }
  if (mtimeMs !== undefined) {
    if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) {
      return { error: 'mtimeMs must be a finite number' }
    }
    request.mtimeMs = mtimeMs
  }
  return request
}

/**
 * `PUT /api/dsh-memento/file` — atomically replace `ME.md` or the project
 * `MEMORY.md` with exactly the given content (M4). Target allowlist only:
 * any path that would escape `~/.dsh/memory/` (including `..` in a key
 * override) is refused with 400. Over-cap content is accepted — the cap is
 * reported, never enforced by edit. No reformat: the bytes in, the bytes out.
 */
function registerFileRoute(ctx: Context): void {
  const vaultRoot = join(DSH_HOME, 'memory')
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: FILE_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          if (req.method !== 'PUT') {
            send(res, 405, { ok: false, error: 'method not allowed; use PUT' })
            return
          }
          const parsed = parseFileBody(await readBody(req))
          if ('error' in parsed) {
            send(res, 400, { ok: false, error: parsed.error })
            return
          }
          const key = parsed.target === 'project' ? (parsed.key ?? projectKey(processCwd())) : ''
          const paths = vaultPaths(DSH_HOME, key)
          const targetPath = parsed.target === 'me' ? paths.me : paths.project
          // Allowlist: the resolved path must stay inside the vault root.
          // `resolve` normalizes `..` segments a key override could carry.
          const resolved = resolve(targetPath)
          if (resolved !== resolve(vaultRoot) && !resolved.startsWith(vaultRoot + '/')) {
            send(res, 400, { ok: false, error: 'target resolves outside the memory vault' })
            return
          }
          // Optimistic concurrency (REVIEW-01 R1): when the client echoes an
          // mtimeMs and the file exists, refuse a stale overwrite with 409.
          if (parsed.mtimeMs !== undefined && existsSync(resolved)) {
            let currentMtime: number
            try {
              currentMtime = statSync(resolved).mtimeMs
            } catch (error) {
              send(res, 500, { ok: false, error: errorMessage(error) })
              return
            }
            if (currentMtime !== parsed.mtimeMs) {
              const conflict: FileConflictPayload = {
                ok: false,
                error: 'mtime mismatch',
                mtimeMs: currentMtime,
              }
              send(res, 409, conflict)
              return
            }
          }
          writeFileAtomic(resolved, parsed.content)
          const lines = countLines(parsed.content)
          const cap = parsed.target === 'me' ? ME_CAP : PROJECT_CAP
          const mtimeMs = statSync(resolved).mtimeMs
          const payload: FilePayload = {
            ok: true,
            target: parsed.target,
            path: resolved,
            lines,
            cap,
            overCap: lines > cap,
            mtimeMs,
          }
          send(res, 200, payload)
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: file route')
}

/**
 * Inbox line mutate prefix (M4 + REVIEW-02 R9):
 *   DELETE /inbox/line/N — remove exactly the Nth line (1-based)
 *   POST   /inbox/line   — insert/restore one line (`{ text, n? }`)
 * Registered as a `prefix` route (exact or prefix match only).
 */
function registerInboxDeleteRoute(ctx: Context, inbox: InboxStore): void {
  const unregister = ctx.webServer.register({
    kind: 'prefix',
    path: INBOX_DELETE_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          const pathname = (req.url ?? '/').split('?')[0]
          const suffix = pathname.slice(INBOX_DELETE_ROUTE.length)

          if (req.method === 'POST') {
            if (suffix !== '' && suffix !== '/') {
              send(res, 400, { ok: false, error: 'expected POST /api/dsh-memento/inbox/line' })
              return
            }
            const raw = await readBody(req)
            let parsed: Partial<InboxInsertRequest>
            try {
              parsed = JSON.parse(raw) as Partial<InboxInsertRequest>
            } catch {
              send(res, 400, { ok: false, error: 'expected JSON { text, n? }' })
              return
            }
            if (typeof parsed.text !== 'string' || parsed.text.length === 0) {
              send(res, 400, { ok: false, error: 'text required' })
              return
            }
            const n = typeof parsed.n === 'number' ? parsed.n : Number.POSITIVE_INFINITY
            const result = insertInboxLine(inbox.path, n, parsed.text)
            const payload: InboxInsertPayload = {
              ok: true,
              inserted: true,
              n: result.n,
              line: result.line,
            }
            send(res, 200, payload)
            return
          }

          if (req.method !== 'DELETE') {
            send(res, 405, { ok: false, error: 'method not allowed; use DELETE or POST' })
            return
          }
          const match = /^\/(\d+)$/.exec(suffix)
          if (match === null) {
            send(res, 400, { ok: false, error: 'expected DELETE /api/dsh-memento/inbox/line/<n>' })
            return
          }
          const result = removeInboxLine(inbox.path, Number(match[1]))
          const payload: InboxDeletePayload = {
            ok: true,
            removed: result.removed,
            ...(result.line !== undefined ? { line: result.line } : {}),
          }
          send(res, 200, payload)
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: inbox line-delete route')
}

/**
 * Trigger capture (M2): when a step's claimed batch carries a user message
 * starting with a trigger, append the captured text to the inbox. The
 * decision is returned untouched — the message reaches the model unchanged,
 * and a failure must never break the step (fail-open).
 */
function installTriggerCapture(ctx: Context, inbox: InboxStore): void {
  ctx.on('agent/pre-step', async (
    args: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    try {
      if (!isEnabled(DSH_HOME)) return decision
      // Only the newly claimed batch is scanned — admitted history already
      // passed (or never matched) and our own injected block is attributed.
      for (const message of args.messages) {
        if (message.role !== 'user') continue
        // Skip our own injected block (plugin-attributed) — never a human note.
        if ((message.source as { kind?: string } | undefined)?.kind === 'dsh-memento') continue
        const text = message.content
          .map((block) => (typeof block.text === 'string' ? block.text : ''))
          .join('')
        const payload = detectTrigger(text)
        if (payload === null) continue
        const cwd = args.agent.session.header.cwd
        if (typeof cwd !== 'string' || cwd.length === 0) continue
        inbox.append(projectKey(cwd), payload)
      }
    } catch (error) {
      ctx.logger?.('dsh-memento')
        ?.warn('trigger capture failed (step unaffected): %s', errorMessage(error))
    }
    return decision
  })
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
  if (!isEnabled(DSH_HOME)) return undefined
  const state = readVault(DSH_HOME, key)
  const block = buildInjectBlockWithRitual(state, DSH_HOME)
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

/** One tracked session inside the compliance state. */
interface TrackedSession {
  sessionId: string
  tracker: SessionComplianceTracker
  /** Epoch ms of the last observed tool call (the route's default target). */
  lastActivity: number
}

/** Compliance state shared by the event hook and the route. */
interface ComplianceState {
  trackers: Map<string, TrackedSession>
}

/** Serialize one snapshot for the route payload (epoch ms → ISO local). */
function compliancePayload(
  entry: TrackedSession,
  snapshot: ComplianceSnapshot,
): CompliancePayload {
  const iso = (ms: number | null): string | null => (ms === null ? null : isoLocal(new Date(ms)))
  const violations: ComplianceViolationPayload[] = snapshot.violations.map((v) => ({
    kind: v.kind,
    at: isoLocal(new Date(v.at)),
    tool: v.tool,
  }))
  return {
    ok: true,
    sessionId: entry.sessionId,
    projectKey: snapshot.projectKey,
    ritualRequired: snapshot.ritualRequired,
    memoryReadAt: iso(snapshot.memoryReadAt),
    firstMutationAt: iso(snapshot.firstMutationAt),
    compliant: snapshot.compliant,
    violations,
  }
}

/**
 * Ritual compliance observer (M3). Per session: `memoryReadAt` is the first
 * tool call whose arguments reference a vault path; `firstMutationAt` is the
 * first write/edit tool call or plausibly-mutating shell command. A session
 * is compliant when it read before it mutated (or never mutated); `null`
 * when the project had no `MEMORY.md` at session start (no ritual
 * requested). On `session/disposed`, one JSON line is appended to
 * `~/.dsh/memory/.compliance.log` (rolling 500 lines).
 *
 * Observation only — never blocks, retries, or re-prompts. Every handler is
 * fail-open: a compliance failure must never break a step or a session.
 */
function installCompliance(ctx: Context, state: ComplianceState): void {
  const vaultRoot = join(DSH_HOME, 'memory')
  const logPath = complianceLogPath(DSH_HOME)
  const warn = (message: string, error: unknown): void => {
    try {
      ctx.logger?.('dsh-memento')?.warn('%s: %s', message, errorMessage(error))
    } catch {
      // Logging must not throw either.
    }
  }
  /** Sessions already flushed to `.compliance.log` (dispose + fiber teardown dedupe). */
  const flushed = new Set<string>()

  const entryFor = (session: Session): TrackedSession => {
    const sessionId = String(session.header.id)
    let entry = state.trackers.get(sessionId)
    if (entry === undefined) {
      // Ritual-requirement is fixed at first observation (session start):
      // the project `MEMORY.md` either exists or it does not.
      const cwd = session.header.cwd
      const key = typeof cwd === 'string' && cwd.length > 0 ? projectKey(cwd) : null
      const ritualRequired = key !== null && existsSync(vaultPaths(DSH_HOME, key).project)
      entry = {
        sessionId,
        tracker: new SessionComplianceTracker({ projectKey: key, ritualRequired, vaultRoot }),
        lastActivity: Date.now(),
      }
      state.trackers.set(sessionId, entry)
    }
    return entry
  }

  /** Append one JSON line for an ended session (M3). Idempotent per sessionId. */
  const flushEntry = (entry: TrackedSession): void => {
    if (flushed.has(entry.sessionId)) return
    flushed.add(entry.sessionId)
    state.trackers.delete(entry.sessionId)
    if (!isEnabled(DSH_HOME)) return
    const snapshot = entry.tracker.snapshot()
    const iso = (ms: number | null): string | null => (ms === null ? null : isoLocal(new Date(ms)))
    appendComplianceLog(logPath, {
      endedAt: isoLocal(new Date()),
      sessionId: entry.sessionId,
      projectKey: snapshot.projectKey,
      ritualRequired: snapshot.ritualRequired,
      memoryReadAt: iso(snapshot.memoryReadAt),
      firstMutationAt: iso(snapshot.firstMutationAt),
      compliant: snapshot.compliant,
      violations: snapshot.violations.map((v) => ({
        kind: v.kind,
        at: isoLocal(new Date(v.at)),
        tool: v.tool,
      })),
    })
  }

  // `{ global: true }` matches harness invariant plugins: scoped session
  // carriers must not filter out this root plugin's observers. Without it,
  // live tool/call + dispose edges can miss the listener while inject (an
  // agent-scoped waterfall) still works — the 0/0 scorecard failure mode.
  const sessionOpts = { global: true as const }

  // Start the tracker at session birth so ritualRequired is fixed at the
  // true start (M3) and a tool-less session still gets a log line on end.
  ctx.on('session/created', (session: unknown): void => {
    try {
      if (!isEnabled(DSH_HOME)) return
      entryFor(session as Session)
    } catch (error) {
      warn('compliance session/created failed (session unaffected)', error)
    }
  }, sessionOpts)

  ctx.on('session/event', (session: unknown, event: unknown): void => {
    if (event === null || typeof event !== 'object') return
    if ((event as { type?: unknown }).type !== 'tool/call') return
    const sess = session as Session
    try {
      if (!isEnabled(DSH_HOME)) return
      const entry = entryFor(sess)
      const data = (event as { data?: { name?: unknown; arguments?: unknown } }).data
      const name = data?.name
      if (typeof name !== 'string') return
      // `arguments` is the raw JSON string the session log carries; the
      // tracker also accepts an already-parsed object.
      const raw = data?.arguments
      const args: Record<string, unknown> | string | null =
        typeof raw === 'string'
          ? raw
          : raw !== null && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : null
      entry.tracker.observeToolCall(name, args)
      entry.lastActivity = Date.now()
    } catch (error) {
      warn('compliance observation failed (session unaffected)', error)
    }
  }, sessionOpts)

  ctx.on('session/disposed', (session: unknown): void => {
    try {
      const sessionId = String((session as Session).header.id)
      const entry = state.trackers.get(sessionId)
      if (entry === undefined) return
      flushEntry(entry)
    } catch (error) {
      warn('compliance log write failed', error)
    }
  }, sessionOpts)

  // Headless ends via appExit → fiber dispose; if session/disposed races the
  // exit, flush every still-open tracker so the scorecard still advances.
  ctx.effect(() => () => {
    try {
      for (const entry of [...state.trackers.values()]) {
        try {
          flushEntry(entry)
        } catch (error) {
          warn('compliance fiber-flush failed', error)
        }
      }
    } catch (error) {
      warn('compliance fiber teardown failed', error)
    }
  }, 'memento: compliance flush on unload')
}

/** `GET /api/dsh-memento/compliance` — point-in-time report (M3). */
function registerComplianceRoute(ctx: Context, state: ComplianceState): void {
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: COMPLIANCE_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          if (req.method !== 'GET') {
            send(res, 405, { ok: false, error: 'method not allowed; use GET' })
            return
          }
          const url = new URL(req.url ?? '/', 'http://localhost')
          const wanted = url.searchParams.get('sessionId')
          let entry: TrackedSession | undefined
          if (wanted !== null) {
            entry = state.trackers.get(wanted)
          } else {
            // Default: the most recently active tracked session (`>=` makes a
            // same-millisecond tie go to the most recently tracked one).
            let newest = 0
            for (const candidate of state.trackers.values()) {
              if (candidate.lastActivity >= newest) {
                newest = candidate.lastActivity
                entry = candidate
              }
            }
          }
          // M4: rolling history for the pane's compliance strip ("7/9
          // sessions"); omitted when nothing determined has been logged.
          const history = readComplianceHistory(DSH_HOME)
          if (entry === undefined) {
            const unknown: CompliancePayload = { ok: true, sessionId: wanted ?? null, known: false }
            if (history !== null) unknown.history = history
            send(res, 200, unknown)
            return
          }
          const payload = compliancePayload(entry, entry.tracker.snapshot())
          if (history !== null) payload.history = history
          send(res, 200, payload)
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: compliance route')
}


/** `POST /api/dsh-memento/enabled` — create/remove `~/.dsh/memory/.off`. */
function registerEnabledRoute(ctx: Context): void {
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: ENABLED_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          if (req.method !== 'POST') {
            send(res, 405, { ok: false, error: 'method not allowed; use POST' })
            return
          }
          const raw = await readBody(req)
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            send(res, 400, { ok: false, error: 'expected JSON { "enabled": boolean }' })
            return
          }
          if (
            parsed === null ||
            typeof parsed !== 'object' ||
            typeof (parsed as { enabled?: unknown }).enabled !== 'boolean'
          ) {
            send(res, 400, { ok: false, error: 'expected JSON { "enabled": boolean }' })
            return
          }
          setEnabled(DSH_HOME, (parsed as { enabled: boolean }).enabled)
          const payload: EnabledPayload = { ok: true, enabled: isEnabled(DSH_HOME) }
          send(res, 200, payload)
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      })()
    },
  })
  ctx.effect(() => unregister, 'memento: enabled route')
}

export function apply(ctx: Context): void {
  // Vault bootstrap runs in every profile (web or headless) — the memory
  // block is useful wherever a session starts.
  bootstrap(ctx)
  // Session-start inject for every agent, any profile.
  installInject(ctx)
  // One inbox store per plugin instance: routes, the trigger hook, and the
  // tool share it so undo always targets the same in-memory trail.
  const inbox = new InboxStore(inboxPath(DSH_HOME))
  // Trigger capture: user messages starting `Remember…` / `Note this:`.
  try {
    installTriggerCapture(ctx, inbox)
  } catch (error) {
    ctx.logger?.('dsh-memento')
      .warn('trigger capture install failed (continuing without it): %s', errorMessage(error))
  }
  // memory_remember: the model-facing escape hatch (inbox only).
  try {
    const disposeTools = registerTools(ctx, inbox, () => isEnabled(DSH_HOME))
    ctx.effect(() => { disposeTools() }, 'memento: tools')
  } catch (error) {
    ctx.logger?.('dsh-memento')
      .warn('tool registration failed (continuing without it): %s', errorMessage(error))
  }
  // Ritual compliance observer (M3): tool/call events per session + rolling
  // log. Observation only; failures never affect the session.
  const compliance: ComplianceState = { trackers: new Map() }
  try {
    installCompliance(ctx, compliance)
  } catch (error) {
    ctx.logger?.('dsh-memento')
      .warn('compliance install failed (continuing without it): %s', errorMessage(error))
  }
  // Routes only exist where a web server is present (dsh web); headless
  // profiles simply skip them.
  ctx.inject(['webServer'], (webCtx: Context) => {
    try {
      registerHealthRoute(webCtx)
      registerStateRoute(webCtx, inbox)
      registerCaptureRoute(webCtx, inbox)
      registerUndoRoute(webCtx, inbox)
      registerComplianceRoute(webCtx, compliance)
      registerFileRoute(webCtx)
      registerInboxDeleteRoute(webCtx, inbox)
      registerEnabledRoute(webCtx)
    } catch (error) {
      webCtx.logger?.('dsh-memento')
        .error('route registration failed: %s', errorMessage(error))
    }
  })
}
