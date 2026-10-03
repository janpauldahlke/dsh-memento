/**
 * Module-level promote channel (REVIEW-02 R9): inbox rows request an append
 * into a target editor's draft; EditSection consumes matching requests.
 *
 * Page-global (same lifetime as the pane store). No React context needed —
 * the body and its sections already share the module graph in one CJS bundle.
 */

export type PromoteTarget = 'me' | 'project'

export interface PromoteRequest {
  target: PromoteTarget
  /** Fact text only (prefix already stripped). */
  fact: string
  /** 1-based inbox line number at promote time. */
  sourceN: number
  /** Full inbox line text (for Undo restore after save removes it). */
  sourceText: string
  /** Monotonic token so an effect can detect a fresh request. */
  seq: number
}

type Listener = () => void

class PromoteBus {
  private pending: PromoteRequest | null = null
  private seq = 0
  private readonly listeners = new Set<Listener>()

  getSnapshot = (): PromoteRequest | null => this.pending

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Queue a promote into the named editor draft. */
  request(input: Omit<PromoteRequest, 'seq'>): void {
    this.seq += 1
    this.pending = { ...input, seq: this.seq }
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Take a pending request for `target` (clears it). Other targets leave
   * the queue alone so ME and project editors do not steal each other's work.
   */
  take(target: PromoteTarget): PromoteRequest | null {
    if (this.pending === null || this.pending.target !== target) return null
    const next = this.pending
    this.pending = null
    for (const listener of [...this.listeners]) listener()
    return next
  }
}

export const promoteBus = new PromoteBus()
