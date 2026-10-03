/**
 * Ambient type shims for the harness host/client packages.
 *
 * Out-of-tree plugins reference harness types via type-only imports that only
 * resolve inside the real harness. Declaring a minimal surface here (pinned to
 * dsh 0.1.7-rc.2, see ENV.md) lets `tsc --noEmit` type-check our own code;
 * esbuild erases these type imports at build time. Mirrors the
 * dsh-agent-processes baseline.
 *
 * Hard rule: the built bundle may request only `node:` builtins at runtime.
 * Harness VALUES must never be value-imported (they are unresolvable from an
 * out-of-tree install location); harness behavior that must be reproduced
 * (e.g. message construction) is implemented locally — see
 * `createMementoUserMessage` in src/host/inject.ts. The `MessageSourceMap` interface is declared
 * here so `src/host/inject.ts` can merge-extend it with the `dsh-memento`
 * kind (the harness's own extension pattern, cf. agent-instructions).
 */
declare module '@deepseek-ai/cordis' {
  export interface SlotKey {
    name: string
    key?: string
    id?: string
    order?: number
  }
  export interface Logger {
    debug: (format: unknown, ...params: unknown[]) => void
    info: (format: unknown, ...params: unknown[]) => void
    warn: (format: unknown, ...params: unknown[]) => void
    error: (format: unknown, ...params: unknown[]) => void
  }
  export interface Context {
    slots: {
      inject: (name: string, factory: () => unknown) => () => void
      register: (key: SlotKey, render: unknown) => () => void
    }
    // Present on webServer-injected contexts; typed here (non-optional) so the
    // nested `ctx.inject(['webServer'], …)` callback type-checks.
    webServer: {
      register: (route: import('@deepseek-ai/dsh-host-webserver').WebServerRoute) => () => void
    }
    sidebarRightTabs: {
      register: (def: import('@deepseek-ai/dsh-client-ui-sidebar-right/client').SidebarRightTabDefinition) => () => void
    }
    effect: (dispose: () => void, tag?: string) => void
    inject: (deps: string[], fn: (ctx: Context) => void) => void
    /**
     * Subscribe to a Cordis event. `options.global: true` receives the event
     * regardless of scope-carrier filter checks (harness invariant pattern).
     */
    on: (
      name: string,
      listener: (...args: any[]) => any,
      options?: boolean | { prepend?: boolean; global?: boolean },
    ) => () => void
    logger?: (name: string) => Logger
    [key: string]: unknown
  }
}

declare module '@deepseek-ai/dsh-host-webserver' {
  import type { IncomingMessage, ServerResponse } from 'node:http'
  export interface WebServerRoute {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }
}

declare module '@deepseek-ai/dsh-llm' {
  /** Model-facing content block (text and image forms kept loose here). */
  export interface ContentBlock {
    type: string
    text?: string
    [key: string]: unknown
  }
  /**
   * Where a message came from, in the harness's own vocabulary. Merge-extended
   * by producers (here: dsh-memento in src/host/inject.ts).
   */
  export interface MessageSourceMap {
    user: { kind: 'user' }
    model: { kind: 'model' }
    tool: { kind: 'tool' }
    'system-prompt': { kind: 'system-prompt' }
  }
  /** Any known message source, derived from the map. */
  export type MessageSource = MessageSourceMap[keyof MessageSourceMap]
  /** Shared immutable fields of every conversation message. */
  interface MessageBase {
    readonly id: string
    readonly content: readonly ContentBlock[]
    readonly source: MessageSource
  }
  /** A user-role message (any producer's source kind is admissible). */
  export interface UserMessage extends MessageBase {
    readonly role: 'user'
  }
}

declare module '@deepseek-ai/dsh-session' {
  import type { UserMessage } from '@deepseek-ai/dsh-llm'
  /** Session header facts (cwd is the absolute project directory). */
  export interface SessionHeader {
    cwd?: string
    [key: string]: unknown
  }
  /** One durable session event (envelope kept loose; consumers switch on type). */
  export interface SessionEvent {
    seq: number
    type: string
    data: unknown
  }
  export interface UserMessageEvent extends SessionEvent {
    type: 'user/message'
    data: UserMessage
  }
  /** The model-visible surface of a session. */
  export interface SessionSurface {
    /** Surface node sequences (iterable; order is surface order). */
    nodes: Iterable<number>
  }
  export interface Session {
    readonly header: SessionHeader
    readonly surface: SessionSurface
    eventAt(seq: number): SessionEvent | undefined
    [key: string]: unknown
  }
}

declare module '@deepseek-ai/dsh-agent' {
  import type { UserMessage } from '@deepseek-ai/dsh-llm'
  import type { Session } from '@deepseek-ai/dsh-session'
  /**
   * The decision returned by the `agent/pre-step` waterfall: admit a step with
   * (possibly extended) messages, or reject it.
   */
  export type PreStepDecision =
    | { readonly kind: 'reject' }
    | { readonly kind: 'enter'; readonly messages: UserMessage[]; readonly startsRequestSeries?: boolean }
  /** The agent a pre-step payload carries. */
  export interface Agent {
    readonly session: Session
    [key: string]: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  export interface SidebarRightTabGuide {
    id: string
    order?: number
    title: () => string
    description?: () => string
  }
  export interface SidebarRightTabDefinition {
    id: string
    kind: string
    multiple?: boolean
    keepMounted?: boolean
    patterns?: readonly string[]
    priority?: 'extension' | 'builtin' | 'fallback'
    canOpen?: (address: string) => boolean
    title: (address: string) => string
    guide?: SidebarRightTabGuide[]
  }
}

// Type-only: renderer client module (activated by the real harness).
declare module '@deepseek-ai/dsh-client-ui-renderer/client' {
  export {}
}

// Bundled markdown assets (esbuild `text` loader) expose their content as a
// default string export.
declare module '*.md' {
  const text: string
  export default text
}
