/**
 * File utilities for dsh-memento (M4): atomic same-directory rename writes.
 *
 * The write route and the inbox line-delete both replace a file's content; a
 * torn write (or a crash mid-write) would corrupt a memory file the human
 * curated by hand. Writing a temp file in the SAME directory and renaming it
 * over the target keeps every observer (the inject builder, the state route,
 * the human editor) from ever seeing a partial file — rename is atomic on
 * every filesystem the harness runs on.
 *
 * Node-only by design: inlined into the host bundle, imported by inbox.ts so
 * the standalone unit-test build carries it too.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Atomically replace `path` with `text` (utf8): temp file in the same
 * directory, fsync the temp, rename over the target. Creates parent
 * directories when absent. The temp file is removed on any failure, so no
 * `*.memento-tmp-*` litter survives an error.
 * @returns the final target path (unchanged when the rename succeeded).
 * @throws on I/O failure (temp already cleaned up).
 */
export function writeFileAtomic(path: string, text: string): string {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const temp = join(dir, `.${basenameNoExt(path)}.${process.pid}.${randomBytes(6).toString('hex')}.memento-tmp`)
  let fd: number | null = null
  try {
    fd = openSync(temp, 'w')
    writeSync(fd, text, 0, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(temp, path)
  } catch (error) {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* double-close is fine */ }
    }
    try { unlinkSync(temp) } catch { /* absent temp is fine */ }
    throw error
  }
  return path
}

/** File base name without its final extension (for temp-file naming). */
function basenameNoExt(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? 'file'
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Read a file as utf8; `undefined` when absent or unreadable (fail-open). */
export function readTextOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
