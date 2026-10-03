/**
 * Master on/off switch for dsh-memento (REVIEW-01 R2).
 *
 * Presence of `~/.dsh/memory/.off` means disabled. Disk is law — the human
 * can `touch` / `rm` the file by hand; the pane toggle does the same. Every
 * call reads the filesystem so enable/disable takes effect without a restart.
 *
 * Disabled stops inject, capture, and compliance tracking. The vault files
 * stay readable and editable.
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Marker filename inside the memory vault root. */
export const OFF_FILE_NAME = '.off'

/** Absolute path of the disable marker for a dsh home. */
export function offPath(dshHome: string): string {
  return join(dshHome, 'memory', OFF_FILE_NAME)
}

/** `true` when the plugin should run (marker absent). Never throws. */
export function isEnabled(dshHome: string): boolean {
  try {
    return !existsSync(offPath(dshHome))
  } catch {
    // Unreadable marker → treat as enabled (fail-open for the product surface).
    return true
  }
}

/**
 * Enable or disable by creating/removing `.off`. Creates the vault directory
 * when needed so a bare `touch` equivalent works before bootstrap.
 */
export function setEnabled(dshHome: string, enabled: boolean): void {
  const path = offPath(dshHome)
  if (enabled) {
    try {
      unlinkSync(path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
    return
  }
  mkdirSync(join(dshHome, 'memory'), { recursive: true })
  writeFileSync(path, '', 'utf8')
}
