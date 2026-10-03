/**
 * Agent tools for dsh-memento (M2).
 *
 * Registers one tool on the harness `tools` service — `memory_remember`, an
 * escape hatch that writes the inbox only (never ME.md, never project
 * memory). Pin note (dsh >= 0.1.7): JSON Schema `required` lives on the
 * object level, not on scalar property nodes.
 */
import { cwd as processCwd } from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import { projectKey } from './vault.ts'
import type { InboxStore } from './inbox.ts'

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
 * Register `memory_remember`. Returns a disposer. Degrades to a logged no-op
 * when the `tools` seat is unavailable (e.g. a profile without agents).
 */
export function registerTools(ctx: Context, inbox: InboxStore): () => void {
  const tools = (ctx as unknown as { tools?: ToolsFace }).tools
  if (typeof tools?.register !== 'function') {
    ctx.logger?.('dsh-memento')?.warn('tools service unavailable; memory_remember not registered')
    return () => {}
  }

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
      const cwd = exec?.agent?.session?.header?.cwd
      const key = typeof cwd === 'string' && cwd.length > 0 ? projectKey(cwd) : projectKey(processCwd())
      const result = inbox.append(key, text)
      return { ok: true as const, captured: true as const, line: result.line }
    },
  })
  return () => { dispose() }
}
