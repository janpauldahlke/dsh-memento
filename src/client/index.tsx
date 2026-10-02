/**
 * Browser half of dsh-memento (M0 skeleton).
 *
 * Registers one rightbar tab type: "Memory" (empty body) + a guide entry so
 * the tab is reachable from the right sidebar's guide page. No data, no
 * fetches, no stores — M0 exists to prove the client half loads.
 *
 * Registration happens at apply top level (not inside a React effect), per the
 * gpu-monitor rightbar lesson: a missing top-level registration can stall boot.
 */
import type { ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TAB_ID, TAB_KIND, TAB_TITLE } from '../shared/types.ts'

/** M0 body: an empty pane. M4 replaces it with the Memory pane. */
const MemoryBody: ComponentType = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: 24,
      color: 'var(--dsh-color-text-muted, #888)',
      fontSize: 13,
    }}
  >
    {TAB_TITLE} — no content yet (M0)
  </div>
)

export const name = 'dsh-memento'
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
      description: () => 'Bounded-file memory: ME.md, project MEMORY.md, inbox (stub)',
    }],
  }
  const disposeType = ctx.sidebarRightTabs.register(definition)
  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID },
    MemoryBody,
  ))
  ctx.effect(() => () => {
    disposeBody()
    disposeType()
  }, 'memento: rightbar tab type')
}
