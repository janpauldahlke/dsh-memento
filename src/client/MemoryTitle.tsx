/**
 * The Memory tab's chip title (M4): "Memory" tinted by live status so the
 * signal is visible even when the pane is closed. The book glyph lives on
 * the guide capsule only. Registered under the keyed
 * `sidebar.right.pane.tab.title` seat (key = the tab type id).
 *
 *   green  — memory On and polls healthy
 *   grey   — Off / not yet loaded (offline)
 *   yellow — last poll or write reported an error
 *
 * Session seat props keep the shared poller focused on the open workspace
 * (same as the pane body) even while the tab is collapsed.
 */
import type { ReactNode } from 'react'
import { TAB_TITLE } from '../shared/types.ts'
import { useMemory, useNoopSessions, useSessionCwd, type UseSessions } from './useMemory.ts'

const COLOR_ACTIVE = '#22c55e'
const COLOR_OFFLINE = '#8b93a7'
const COLOR_ERROR = '#fbbf24'

export function MemoryTitle(props: {
  sessionId?: string
  useSessions?: UseSessions
} = {}): ReactNode {
  const { sessionId, useSessions = useNoopSessions } = props
  const sessionCwd = useSessionCwd(sessionId, useSessions)
  // Bind the poller here so the chip stays live while the pane is closed.
  const { snapshot } = useMemory({ cwd: sessionCwd, sessionId: sessionId ?? null })
  const state = snapshot.state

  let color = COLOR_OFFLINE
  let tip = 'Memory — loading…'
  if (snapshot.error !== null) {
    color = COLOR_ERROR
    tip = `Memory error: ${snapshot.error}`
  } else if (state !== null && state.enabled) {
    color = COLOR_ACTIVE
    tip = sessionCwd ? `Memory On · ${sessionCwd}` : 'Memory On'
  } else if (state !== null) {
    color = COLOR_OFFLINE
    tip = 'Memory Off'
  }

  return (
    <span
      title={tip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontWeight: 600,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {TAB_TITLE}
    </span>
  )
}
