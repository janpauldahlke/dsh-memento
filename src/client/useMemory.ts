/**
 * Memory pane data hook (M4 + REVIEW-01): polls `GET /state` + `GET /compliance`
 * every few seconds while any pane component is mounted, and exposes the
 * write/delete/enable actions the sections call.
 *
 * Polling is refcounted at module level so the tab body and the tab title can
 * both bind to the store without double-polling; the interval is cleared when
 * the last subscriber unmounts (no timer leaks on pane close or unload).
 * Fetch failures never throw out — they land in the snapshot's `error` field
 * and the pane keeps showing the last good data.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { CompliancePayload, StatePayload } from '../shared/types.ts'
import { memoryStore, type MemorySnapshot } from './store.ts'

/** Same-origin API base (the routes live on this dsh web server). */
const API_BASE = '/api/dsh-memento'
/** Poll cadence: calm — the pane is a glance surface, not a dashboard. */
const POLL_MS = 4000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface FetchOutcome {
  status: number
  body: unknown
}

async function fetchJson(url: string, init?: RequestInit): Promise<FetchOutcome> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { status: response.status, body }
}

/** One `GET /state` poll; writes the result into the store. Never throws. */
async function pollState(): Promise<void> {
  try {
    const { status, body } = await fetchJson(`${API_BASE}/state`)
    const payload = body as Partial<StatePayload> | null
    if (status === 200 && payload !== null && payload.ok === true) {
      memoryStore.onState(payload as StatePayload, null)
    } else {
      memoryStore.onState(null, `state: HTTP ${status}`)
    }
  } catch (error) {
    memoryStore.onState(null, `state: ${errorMessage(error)}`)
  }
}

/** One `GET /compliance` poll; writes the result into the store. Never throws. */
async function pollCompliance(): Promise<void> {
  try {
    const { status, body } = await fetchJson(`${API_BASE}/compliance`)
    const payload = body as Partial<CompliancePayload> | null
    if (status === 200 && payload !== null && payload.ok === true) {
      memoryStore.onCompliance(payload as CompliancePayload, null)
    } else {
      memoryStore.onCompliance(null, `compliance: HTTP ${status}`)
    }
  } catch (error) {
    memoryStore.onCompliance(null, `compliance: ${errorMessage(error)}`)
  }
}

/** One round of both polls (overlapping rounds are skipped). */
let inFlight = false
async function pollAll(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    await Promise.allSettled([pollState(), pollCompliance()])
  } finally {
    inFlight = false
  }
}

/** Refcounted polling loop: started by the first bound component, cleared by the last. */
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null

function startPolling(): void {
  subscribers += 1
  if (timer === null) {
    void pollAll()
    timer = setInterval(() => {
      void pollAll()
    }, POLL_MS)
  }
}

function stopPolling(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers === 0 && timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

/** The pane's API: snapshot + actions. */
export interface MemoryApi {
  snapshot: MemorySnapshot
  /** Force an immediate poll round (Save/Delete call it). */
  refresh(): void
  /**
   * `PUT /file` with exactly the given content; true on success.
   * Pass `mtimeMs` from the last state poll for optimistic concurrency.
   */
  saveFile(target: 'me' | 'project', content: string, mtimeMs?: number): Promise<boolean>
  /** `DELETE /inbox/line/<n>`; true when a line was removed. */
  deleteInboxLine(n: number): Promise<boolean>
  /** `POST /enabled` — create/remove `~/.dsh/memory/.off`. */
  setEnabled(enabled: boolean): Promise<boolean>
}

export function useMemory(): MemoryApi {
  const snapshot = useSyncExternalStore(memoryStore.subscribe, memoryStore.getSnapshot, memoryStore.getSnapshot)
  useEffect(() => {
    startPolling()
    return () => {
      stopPolling()
    }
  }, [])
  return useMemo<MemoryApi>(
    () => ({
      snapshot,
      refresh: () => {
        void pollAll()
      },
      saveFile: async (target: 'me' | 'project', content: string, mtimeMs?: number): Promise<boolean> => {
        try {
          const body: { target: 'me' | 'project'; content: string; mtimeMs?: number } = { target, content }
          if (mtimeMs !== undefined) body.mtimeMs = mtimeMs
          const { status, body: responseBody } = await fetchJson(`${API_BASE}/file`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const payload = responseBody as { ok?: boolean; error?: string } | null
          if (status === 200 && payload !== null && payload.ok === true) {
            await pollAll()
            return true
          }
          if (status === 409) {
            memoryStore.onState(snapshot.state, 'changed on disk — reload or overwrite')
            await pollAll()
            return false
          }
          memoryStore.onState(snapshot.state, (payload?.error ?? `save: HTTP ${status}`))
          return false
        } catch (error) {
          memoryStore.onState(snapshot.state, `save: ${errorMessage(error)}`)
          return false
        }
      },
      deleteInboxLine: async (n: number): Promise<boolean> => {
        try {
          const { status, body } = await fetchJson(`${API_BASE}/inbox/line/${n}`, { method: 'DELETE' })
          const payload = body as { ok?: boolean; removed?: boolean; error?: string } | null
          if (status === 200 && payload !== null && payload.ok === true) {
            await pollAll()
            return payload.removed === true
          }
          memoryStore.onState(snapshot.state, (payload?.error ?? `delete: HTTP ${status}`))
          return false
        } catch (error) {
          memoryStore.onState(snapshot.state, `delete: ${errorMessage(error)}`)
          return false
        }
      },
      setEnabled: async (enabled: boolean): Promise<boolean> => {
        try {
          const { status, body } = await fetchJson(`${API_BASE}/enabled`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled }),
          })
          const payload = body as { ok?: boolean; enabled?: boolean; error?: string } | null
          if (status === 200 && payload !== null && payload.ok === true) {
            await pollAll()
            return true
          }
          memoryStore.onState(snapshot.state, (payload?.error ?? `enabled: HTTP ${status}`))
          return false
        } catch (error) {
          memoryStore.onState(snapshot.state, `enabled: ${errorMessage(error)}`)
          return false
        }
      },
    }),
    [snapshot],
  )
}
