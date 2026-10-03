/**
 * The Memory tab's chip title (M4): the book glyph + "Memory", tinted when
 * either bounded file is over its cap — the cap-pressure signal must be
 * visible even when the pane is closed. Registered under the keyed
 * `sidebar.right.pane.tab.title` seat (key = the tab type id).
 *
 * The chip title seat renders a ReactNode (the definition's `title` thunk is
 * only the fallback text), so the tint is a live read of the pane store —
 * no re-registration on data changes.
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { TAB_TITLE } from '../shared/types.ts'
import { memoryStore } from './store.ts'
import { MemoryIcon } from './MemoryIcon.tsx'

/**
 * Structural props type for the title seat: the framework passes more
 * (`useTabInfo`, locale kit, …) but the component only needs to render
 * itself, so it takes none of them.
 */
export interface MemoryTitleProps {
  [prop: string]: unknown
}

export function MemoryTitle(_props: MemoryTitleProps): ReactNode {
  const snapshot = useSyncExternalStore(memoryStore.subscribe, memoryStore.getSnapshot, memoryStore.getSnapshot)
  const overCap = snapshot.state !== null && (snapshot.state.me.overCap || snapshot.state.project.overCap)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: overCap ? 'var(--dsh-color-warning, #d97706)' : undefined,
      }}
    >
      <MemoryIcon size={15} />
      {TAB_TITLE}
      {overCap ? ' ⚠' : null}
    </span>
  )
}
