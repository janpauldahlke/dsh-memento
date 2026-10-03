/**
 * Browser half of dsh-memento (M4: the Memory pane).
 *
 * Registers the "Memory" rightbar tab type (top level, not inside a React
 * effect — a missing top-level registration can stall boot), the keyed pane
 * body under `sidebar.right.pane.tab`, and the keyed chip title under
 * `sidebar.right.pane.tab.title` (icon + label + over-cap tint).
 *
 * The pane's data lives in a module-level store (store.ts) polled by
 * useMemory.ts; body/title take sessionId/useSessions so Project follows the
 * open workspace. Nested editors bind without focus opts. Bundle is
 * load-once, dispose-clean; runtime imports are the platform baseline.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TAB_ID, TAB_KIND, TAB_TITLE } from '../shared/types.ts'
import { MemoryBody } from './MemoryBody.tsx'
import { MemoryIcon } from './MemoryIcon.tsx'
import { MemoryTitle } from './MemoryTitle.tsx'

export const name = 'dsh-local-memento'
export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  const definition: SidebarRightTabDefinition = {
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => TAB_TITLE,
    guide: [{
      id: 'memento',
      order: 270,
      title: () => TAB_TITLE,
      description: () => 'Bounded-file memory: ME.md, project MEMORY.md, inbox — edit, delete, see cap pressure',
      icon: MemoryIcon,
    }],
  }
  const disposeType = ctx.sidebarRightTabs.register(definition)
  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID },
    MemoryBody,
  ))
  const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TAB_ID },
    MemoryTitle,
  ))
  ctx.effect(() => () => {
    disposeTitle()
    disposeBody()
    disposeType()
  }, 'memento: rightbar tab type')
}
