/**
 * Agent tools for dsh-memento.
 *
 * Two tools are registered on the harness `tools` service:
 *
 *   - `memory_remember` (M2): an escape hatch that writes the inbox only
 *     (never ME.md, never project memory).
 *   - `memory_history_search` (M5): read-only archaeology over the DSH
 *     session logs. Answers "did we already try this, and what happened?"
 *
 * Pin note (dsh >= 0.1.7): JSON Schema `required` lives on the object level,
 * not on scalar property nodes.
 */
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import { projectKey, resolveDshHome } from './vault.ts'
import type { InboxStore } from './inbox.ts'
import { scanHistory, type HistoryHit, type HistoryOutcome } from './history.ts'

/** The `exec` surface the harness passes to tool handlers (kept loose). */
interface ExecLike {
  agent?: {
    session?: {
      header?: { cwd?: string }
    }
  }
}

interface ToolsFace {
  register: (def: Record<string, unknown>) => () => void
}

/**
 * Register the dsh-memento agent tools. Returns a disposer. Degrades to a
 * logged no-op when the `tools` seat is unavailable (e.g. a profile without
 * agents).
 */
export function registerTools(
  ctx: Context,
  inbox: InboxStore,
  /** Live master-switch probe (REVIEW-01 R2); defaults to always-on. */
  enabled: () => boolean = () => true,
): () => void {
  const tools = (ctx as unknown as { tools?: ToolsFace }).tools
  if (typeof tools?.register !== 'function') {
    ctx.logger?.('dsh-memento')?.warn('tools service unavailable; tools not registered')
    return () => {}
  }

  const disposers: Array<() => void> = []
  // Register independently: a schema reject on one tool must not wipe the other.
  for (const [label, register] of [
    ['memory_remember', () => registerRememberTool(tools, ctx, inbox, enabled)],
    ['memory_history_search', () => registerHistorySearchTool(tools, ctx)],
  ] as const) {
    try {
      disposers.push(register())
    } catch (error) {
      ctx.logger?.('dsh-memento')?.warn(
        'tool %s not registered: %s',
        label,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** The `memory_remember` tool (M2). */
function registerRememberTool(
  tools: ToolsFace,
  ctx: Context,
  inbox: InboxStore,
  enabled: () => boolean,
): () => void {
  const dispose = tools.register({
    name: 'memory_remember',
    description:
      'Capture a note into the dsh-memento inbox (one plain line in ~/.dsh/memory/inbox.md). ' +
      'Use it when the user asks you to remember something, or when a durable fact worth keeping surfaces. ' +
      'Writes the inbox only — never ME.md or project MEMORY.md. Undoes only via POST /api/dsh-memento/undo.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          description: 'The note to remember. Newlines collapse to single spaces.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'captured'],
        properties: {
          ok: { type: 'boolean' },
          captured: { type: 'boolean' },
          line: { type: 'string' },
        },
      },
      render: (_args: unknown, value: unknown) => [
        { type: 'text' as const, text: JSON.stringify(value) },
      ],
    },
    async execute(args: { text?: unknown }, exec: ExecLike) {
      const text = typeof args?.text === 'string' ? args.text.trim() : ''
      if (text.length === 0) {
        throw new Error('memory_remember requires a non-empty "text" argument')
      }
      if (!enabled()) {
        return { ok: true as const, captured: false as const, reason: 'disabled' as const }
      }
      const cwd = exec?.agent?.session?.header?.cwd
      const key = typeof cwd === 'string' && cwd.length > 0 ? projectKey(cwd) : projectKey(processCwd())
      const result = inbox.append(key, text)
      return { ok: true as const, captured: true as const, line: result.line }
    },
  })
  return () => { dispose() }
}

/** Sessions root for the history search (`~/.dsh/sessions`). */
function sessionsRoot(): string {
  return join(resolveDshHome(), 'sessions')
}

/** The `memory_history_search` tool (M5). */
function registerHistorySearchTool(tools: ToolsFace, ctx: Context): () => void {
  const dispose = tools.register({
    name: 'memory_history_search',
    description:
      'Read-only archaeology over past DSH session logs (~/.dsh/sessions). ' +
      'Use it for cold cases: "did we already try this, and what happened?" ' +
      'Greps compressed session transcripts for a literal substring (or simple regex) and returns up to 50 ' +
      'snippets, newest first. It never writes anything and never copies results into the vault. ' +
      'Prefer it over re-deriving a past decision from scratch.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'A literal substring to find, or a simple regex. Matched against each log line.',
        },
        project: {
          type: 'string',
          description:
            'Restrict to one project key (the `--slug--` directory name under ~/.dsh/sessions). ' +
            'Defaults to the current session\'s project when allProjects is false.',
        },
        allProjects: {
          type: 'boolean',
          description: 'Search every project, not just the current one. Default false.',
        },
        limit: {
          type: 'number',
          description: 'Maximum hits to return. Default 10, max 50.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'scanned', 'hits', 'truncated', 'degraded'],
        properties: {
          ok: { type: 'boolean' },
          scanned: { type: 'number' },
          hits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['projectKey', 'sessionId', 'time', 'eventType', 'snippet'],
              properties: {
                projectKey: { type: 'string' },
                // Harness JSON Schema forbids type arrays (`["string","null"]`);
                // nullable fields must use oneOf (see @deepseek-ai/dsh-tools).
                sessionId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                time: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                eventType: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                snippet: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean' },
          degraded: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args: unknown, value: unknown) => [
        { type: 'text' as const, text: JSON.stringify(value) },
      ],
    },
    async execute(
      args: { query?: unknown; project?: unknown; allProjects?: unknown; limit?: unknown },
      exec: ExecLike,
    ) {
      const query = typeof args?.query === 'string' ? args.query : ''
      if (query.trim().length === 0) {
        throw new Error('memory_history_search requires a non-empty "query" argument')
      }

      // Resolve the project scope. `allProjects` wins; else an explicit
      // `project`; else the current session's project key.
      const cwd = exec?.agent?.session?.header?.cwd
      const currentKey =
        typeof cwd === 'string' && cwd.length > 0
          ? projectKey(cwd)
          : projectKey(processCwd())
      const allProjects = args?.allProjects === true
      const explicitProject = typeof args?.project === 'string' ? args.project.trim() : ''
      const projectKeyArg: string | null = allProjects
        ? null
        : explicitProject.length > 0
          ? explicitProject
          : currentKey

      const limit = typeof args?.limit === 'number' ? args.limit : undefined

      try {
        const result = await scanHistory({
          root: sessionsRoot(),
          query,
          projectKey: projectKeyArg,
          limit,
        })
        return result as HistoryOutcome
      } catch (error) {
        // Fail-open: the tool reports a degraded scan rather than throwing,
        // so a cold-case lookup never derails the session.
        ctx.logger?.('dsh-memento')?.warn('history search failed: %s', error instanceof Error ? error.message : String(error))
        return {
          ok: true as const,
          scanned: 0,
          hits: [] as HistoryHit[],
          truncated: false,
          degraded: [`scan failed: ${error instanceof Error ? error.message : String(error)}`],
        }
      }
    },
  })
  return () => { dispose() }
}
