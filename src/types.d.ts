/**
 * Ambient type shims for the harness host/client packages.
 *
 * Out-of-tree plugins reference harness types via type-only imports that only
 * resolve inside the real harness. Declaring a minimal surface here (pinned to
 * dsh 0.1.7-rc.2, see ENV.md) lets `tsc --noEmit` type-check our own code;
 * esbuild erases these type imports at build time. Mirrors the
 * dsh-agent-processes baseline.
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
