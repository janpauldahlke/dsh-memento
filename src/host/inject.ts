/**
 * Session-start inject for dsh-memento (M1).
 *
 * Delivery seam: the `agent/pre-step` waterfall (the same extension point the
 * harness's own `agent-instructions` plugin uses). A root-scope plugin sees
 * every agent — cordis contexts share one event bus down the fiber tree and
 * dsh-scope admits untagged listeners globally. The block is delivered as a
 * plugin-attributed `UserMessage` (`source.kind === 'dsh-memento'`) spliced
 * into the admitted step, so it is committed to the durable session log as a
 * `user/message` event. It is NOT a system-prompt mutation.
 *
 * Cache stability: the block is computed exactly once per session (WeakMap),
 * spliced exactly once (first admitted step), and afterwards the durable
 * `user/message` event keeps it in the prompt history at a fixed position —
 * identical bytes every step, never duplicated, never reordered. A resumed
 * session already carries the event in its log and is detected via the
 * surface scan, so resume never re-injects.
 *
 * Fail-open: any vault or dispatch failure skips the inject, logs at most
 * once per session, and returns the decision untouched.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { projectKey, type InjectBlock } from './vault.ts'

/** Attribution for the injected baseline (merge-extended `MessageSourceMap`). */
export interface MementoSource {
  kind: 'dsh-memento'
  /** The complete session-start memory baseline. */
  form: 'memory-baseline'
  /** Source schema version. */
  version: 1
  /** Project key the block was built from. */
  key: string
  /** ME.md line count at build time. */
  meLines: number
  /** Project MEMORY.md line count at build time (0 when absent). */
  projectLines: number
  /** True when the project section was dropped for the 4000-char ceiling. */
  truncated: boolean
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-memento': MementoSource
  }
}

/** Per-session inject state (computed once, delivered once). */
interface SessionInjectState {
  message: UserMessage
  /** `true` once the message entered a step (or was found in resumed history). */
  delivered: boolean
  /** `true` once a failure was recorded (never retry, never re-log). */
  failed: boolean
}

/** Pre-built block plus the source facts for one session's cwd key. */
export interface PreparedInject {
  message: UserMessage
  block: InjectBlock
}

/**
 * Dependencies the host wires in: build the block for a project key, or
 * return `undefined` when there is nothing injectable (vault unreadable,
 * ME.md absent). It runs at most once per session.
 */
export type PrepareInject = (key: string) => PreparedInject | undefined

/**
 * Deep-freeze plain data, mirroring the harness `deepFreeze` semantics
 * (recursively freeze objects and arrays; primitives pass through).
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/**
 * Construct one identified, immutable user-role message — structurally
 * identical to what the harness `createUserMessage` publishes (fresh UUID
 * identity, frozen plain object). Messages carry no class identity, so
 * building them locally keeps the bundle free of harness runtime imports:
 * the out-of-tree contract is that the built bundle requests only `node:`
 * builtins at runtime (harness types are type-only and ambient-shimmed).
 */
export function createMementoUserMessage(
  content: readonly ContentBlock[],
  source: MementoSource,
): UserMessage {
  return deepFreeze(structuredClone({
    id: randomUUID(),
    role: 'user',
    content: [...content],
    source,
  }))
}

/** A placeholder message that is never delivered (failed/absent vaults). */
function noMessage(): UserMessage {
  return createMementoUserMessage([], {
    kind: 'dsh-memento', form: 'memory-baseline', version: 1, key: '',
    meLines: 0, projectLines: 0, truncated: false,
  })
}

/**
 * Whether the session log already carries a `dsh-memento` user message
 * (resume, or a prior delivery this process).
 */
function alreadyInHistory(session: Session): boolean {
  for (const seq of [...session.surface.nodes].reverse()) {
    const event = session.eventAt(seq)
    if (event?.type === 'user/message'
      && (event.data as { source?: { kind?: string } }).source?.kind === 'dsh-memento') {
      return true
    }
  }
  return false
}

/**
 * Install the session-start inject on `ctx` (any scope that receives
 * `agent/pre-step`, e.g. the root loader scope).
 */
export function installSessionStartInject(ctx: Context, prepare: PrepareInject): void {
  const bySession = new WeakMap<Session, SessionInjectState>()

  const recordFailure = (session: Session, error: unknown): void => {
    bySession.set(session, { message: noMessage(), delivered: true, failed: true })
    try {
      ctx.logger?.('dsh-memento')
        ?.warn('session-start inject skipped: %s', error instanceof Error ? error.message : String(error))
    } catch {
      // Logging must never break the step.
    }
  }

  ctx.on('agent/pre-step', async (
    args: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    // Only steps that actually enter carry messages we may extend.
    if (decision.kind !== 'enter' || decision.messages.length === 0) return decision
    const session = args.agent.session
    try {
      let state = bySession.get(session)
      if (state === undefined) {
        const cwd = session.header.cwd
        if (typeof cwd !== 'string' || cwd.length === 0) {
          recordFailure(session, 'session header has no cwd')
          return decision
        }
        const prepared = prepare(projectKey(cwd))
        if (prepared === undefined || prepared.block.block.length === 0) {
          recordFailure(session, 'vault has nothing to inject (absent or unreadable)')
          return decision
        }
        state = { message: prepared.message, delivered: false, failed: false }
        bySession.set(session, state)
        if (alreadyInHistory(session)) state.delivered = true
      }
      if (state.delivered || state.failed) return decision
      // Splice right after the claimed batch so the direct prompt precedes
      // the memory baseline and driver-appended runtime context follows it —
      // the same position the harness's own instruction inject uses.
      const lastClaimedIndex = decision.messages.findLastIndex(message => args.messages.includes(message))
      const anchor = lastClaimedIndex < 0 ? 0 : lastClaimedIndex + 1
      const messages = decision.messages.slice()
      messages.splice(anchor, 0, state.message)
      state.delivered = true
      return { ...decision, messages }
    } catch (error) {
      // Fail-open: the session must stay healthy no matter what.
      recordFailure(session, error)
      return decision
    }
  })
}
