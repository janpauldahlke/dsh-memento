/**
 * Client-side store for the Memory pane (M4): one module-level snapshot the
 * poller writes into and every pane component reads via
 * `useSyncExternalStore` (bound in useMemory.ts).
 *
 * No dsh-client-store dependency: the pane needs no session identity — the
 * routes observe the server-launched project globally, and this is a plain
 * page-global external store. Inline in the CJS bundle; no runtime imports.
 */
import type { CompliancePayload, StatePayload } from '../shared/types.ts'

/** The pane's entire world: the two polled payloads + poll health. */
export interface MemorySnapshot {
  /** Last successful `GET /state` (null before the first success). */
  state: StatePayload | null
  /** Last successful `GET /compliance` (null before the first success). */
  compliance: CompliancePayload | null
  /** Last poll failure message (null when the last attempt succeeded). */
  error: string | null
  /** Epoch ms of the last successful poll (null before any success). */
  lastUpdated: number | null
}

type Listener = () => void

class MemoryStore {
  private snapshot: MemorySnapshot = {
    state: null,
    compliance: null,
    error: null,
    lastUpdated: null,
  }
  private readonly listeners = new Set<Listener>()

  /** Stable for `useSyncExternalStore`. */
  getSnapshot = (): MemorySnapshot => this.snapshot

  /** Stable for `useSyncExternalStore`; returns the unsubscribe. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(patch: Partial<MemorySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    // Copy first: a listener may unsubscribe mid-iteration.
    for (const listener of [...this.listeners]) listener()
  }

  /** Record a `GET /state` result (success keeps the payload, failure keeps the last good one). */
  onState(payload: StatePayload | null, error: string | null): void {
    const patch: Partial<MemorySnapshot> = { error }
    if (payload !== null) {
      patch.state = payload
      patch.lastUpdated = Date.now()
    }
    this.emit(patch)
  }

  /** Record a `GET /compliance` result (same contract as onState). */
  onCompliance(payload: CompliancePayload | null, error: string | null): void {
    const patch: Partial<MemorySnapshot> = { error }
    if (payload !== null) {
      patch.compliance = payload
      patch.lastUpdated = Date.now()
    }
    this.emit(patch)
  }
}

/** The page-global pane store (one per page load). */
export const memoryStore = new MemoryStore()
