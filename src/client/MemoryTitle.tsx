/**
 * The Memory tab's chip title (M4): "Memory" tinted by live status so the
 * signal is visible even when the pane is closed. The book glyph lives on
 * the guide capsule only. Registered under the keyed
 * `sidebar.right.pane.tab.title` seat (key = the tab type id).
 *
 *   green  — memory On and polls healthy
 *   grey   — Off / not yet loaded (offline)
 *   yellow — last poll or write reported an error
 */
import type { ReactNode } from 'react'
import { TAB_TITLE } from '../shared/types.ts'
import { useMemory } from './useMemory.ts'

/**
 * Structural props type for the title seat: the framework passes more
 * (`useTabInfo`, locale kit, …) but the component only needs to render
 * itself, so it takes none of them.
 */
export interface MemoryTitleProps {
  [prop: string]: unknown
}

const COLOR_ACTIVE = '#22c55e'
const COLOR_OFFLINE = '#8b93a7'
const COLOR_ERROR = '#fbbf24'

export function MemoryTitle(_props: MemoryTitleProps): ReactNode {
  // Bind the poller here so the chip stays live while the pane is closed.
  const { snapshot } = useMemory()
  const state = snapshot.state

  let color = COLOR_OFFLINE
  let tip = 'Memory — loading…'
  if (snapshot.error !== null) {
    color = COLOR_ERROR
    tip = `Memory error: ${snapshot.error}`
  } else if (state !== null && state.enabled) {
    color = COLOR_ACTIVE
    tip = 'Memory On'
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
