/**
 * Inbox write (M2): append + undo, last entry only.
 *
 * The inbox (`~/.dsh/memory/inbox.md`) is plain lines, never injected, never
 * read unprompted. Appending needs no judgment and no cap. Undo removes
 * exactly the bytes this plugin instance appended, restoring the file to its
 * pre-append state; a second undo with nothing left to undo is a no-op, not
 * an error.
 *
 * Node-only by design (fs/path): built standalone so `node --test` exercises
 * it without resolving the harness `@deepseek-ai/*` packages.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from './fsutil.ts'

/** Inbox file name (inside `~/.dsh/memory/`, sibling of ME.md). */
export const INBOX_FILE_NAME = 'inbox.md'

/**
 * The three triggers: case-insensitive, at the start of a user message only.
 * Order matters only for readability — the patterns are mutually exclusive
 * (`remember:` requires the colon immediately after "remember").
 */
const TRIGGERS: readonly RegExp[] = [
  /^\s*remember this:\s?([\s\S]*)$/i,
  /^\s*remember:\s?([\s\S]*)$/i,
  /^\s*note this:\s?([\s\S]*)$/i,
]

/**
 * ISO-8601 local time with numeric offset (`2026-10-03T00:42:11+02:00`).
 * Second precision — the entry format carries no fractional seconds.
 */
export function isoLocal(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  ].join('T')
}

/**
 * Whether a user message starts with a trigger, and if so what to capture:
 * the text after the trigger, with every run of newlines collapsed to a
 * single space and the ends trimmed. `null` when the message is not a
 * trigger or nothing captureable follows it.
 */
export function detectTrigger(message: string): string | null {
  if (typeof message !== 'string') return null
  for (const pattern of TRIGGERS) {
    const match = pattern.exec(message)
    if (match === null) continue
    const payload = (match[1] ?? '').replace(/[\r\n]+/g, ' ').trim()
    if (payload.length === 0) return null
    return payload
  }
  return null
}

/** One captured entry: `ISO-local [--key--] payload`, never multi-line. */
export function formatEntry(text: string, key: string, now: Date = new Date()): string {
  const collapsed = text.replace(/[\r\n]+/g, ' ').trim()
  return `${isoLocal(now)} [${key}] ${collapsed}`
}

/**
 * Acceptance-format line check (used by `agent/accept-m2.mjs`): timestamp
 * with offset, a `--slug--` project key in brackets, then a non-empty payload.
 */
export const ENTRY_LINE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \[--[A-Za-z0-9._-]+--\] \S[\s\S]*$/

/** A tracked append: the bytes this instance wrote and where they started. */
interface TrackedAppend {
  path: string
  /** Byte offset the entry started at (file state before the append). */
  startOffset: number
  /** The exact bytes written (entry line + trailing newline). */
  bytes: Buffer
}

/**
 * The inbox store for one plugin instance. Undo state is in memory only —
 * "only if this plugin instance appended it" — so a restart forgets it and a
 * second undo after the last undo reports `undone: false`.
 */
export class InboxStore {
  private readonly tracked: TrackedAppend[] = []

  constructor(private readonly inboxFile: string) {}

  /** Absolute path of `inbox.md`. */
  get path(): string {
    return this.inboxFile
  }

  /**
   * Append one entry for a project key. Creates the file (and its
   * directory) when absent. Returns the written line and its start offset.
   * Throws on I/O failure — callers (routes, tools, the trigger hook) are
   * responsible for fail-open handling.
   */
  append(key: string, text: string, now: Date = new Date()): { line: string; startOffset: number } {
    const line = formatEntry(text, key, now)
    mkdirSync(dirname(this.inboxFile), { recursive: true })
    const startOffset = statSync(this.inboxFile, { throwIfNoEntry: false })?.size ?? 0
    const bytes = Buffer.from(`${line}\n`, 'utf8')
    appendFileSync(this.inboxFile, bytes)
    this.tracked.push({ path: this.inboxFile, startOffset, bytes })
    return { line, startOffset }
  }

  /**
   * Remove the last entry this instance appended. After undo the file is
   * byte-identical to its pre-append state. Returns `undone: false` when
   * there is nothing tracked or the file no longer carries the tracked
   * bytes (deleted, shrunken, or edited over) — never an error.
   */
  undo(): { undone: boolean; line?: string } {
    const top = this.tracked.pop()
    if (top === undefined) return { undone: false }
    let current: Buffer
    try {
      current = readFileSync(top.path)
    } catch {
      this.tracked.length = 0
      return { undone: false }
    }
    const end = top.startOffset + top.bytes.length
    if (current.length < end || !current.subarray(top.startOffset, end).equals(top.bytes)) {
      // The file no longer matches what we wrote (external edit or delete):
      // every tracked offset is unreliable — forget them, touch nothing.
      this.tracked.length = 0
      return { undone: false }
    }
    writeFileSync(top.path, current.subarray(0, top.startOffset))
    return { undone: true, line: top.bytes.toString('utf8').replace(/\n$/, '') }
  }
}

/** Convenience: the inbox path under a dsh home (`~/.dsh/memory/inbox.md`). */
export function inboxPath(dshHome: string): string {
  return join(dshHome, 'memory', INBOX_FILE_NAME)
}

/**
 * M4: logical line count with the editor convention (matches vault
 * `countLines`): `''` → 0, `a\n` → 1, `a\nb` → 2, `a\nb\n` → 2.
 */
export function countInboxLines(raw: string): number {
  if (raw.length === 0) return 0
  let n = 0
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) n++
  if (raw.charCodeAt(raw.length - 1) !== 10) n++
  return n
}

/**
 * M4: one inbox line as shown by the pane: its 1-based line number and the
 * verbatim text. Newest lines carry the largest `n`.
 */
export interface InboxLine {
  /** 1-based line number in the file. */
  n: number
  /** The line's verbatim text (no trailing newline). */
  text: string
}

/** The inbox's tail as a read-only listing: newest first, with line numbers. */
export interface InboxTail {
  /** `false` when the file is absent or unreadable (fail-open). */
  exists: boolean
  /** Total logical lines in the file (0 when absent). */
  total: number
  /** Up to `count` lines, newest first (largest `n` first). */
  tail: InboxLine[]
}

/** Split raw inbox content into logical lines (trailing-newline aware). */
function splitInboxLines(raw: string): string[] {
  if (raw.length === 0) return []
  const parts = raw.split('\n')
  if (raw.endsWith('\n')) parts.pop() // the empty element after the final \n
  return parts
}

/**
 * M4: read the inbox tail for the pane (newest first, 1-based line numbers).
 * Never throws: absent or unreadable file → `{ exists: false, total: 0,
 * tail: [] }`.
 */
export function readInboxTail(path: string, count: number = 20): InboxTail {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { exists: false, total: 0, tail: [] }
  }
  const lines = splitInboxLines(raw)
  const total = lines.length
  const start = Math.max(0, total - count)
  const tail: InboxLine[] = []
  for (let i = total - 1; i >= start; i--) tail.push({ n: i + 1, text: lines[i] })
  return { exists: true, total, tail }
}

/**
 * M4: remove exactly one line by 1-based number; every other byte of the
 * file is preserved (atomic replace via same-directory temp + rename).
 * `n` out of range, or the file absent/unreadable → `removed: false` —
 * never an error, never a rewrite.
 */
export function removeInboxLine(path: string, n: number): { removed: boolean; line?: string } {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { removed: false }
  }
  const lines = splitInboxLines(raw)
  if (!Number.isInteger(n) || n < 1 || n > lines.length) return { removed: false }
  const [line] = lines.splice(n - 1, 1)
  let next = lines.join('\n')
  // Preserve the file's trailing-newline state: a file that did not end in a
  // newline does not gain one when its last line is removed.
  if (raw.endsWith('\n') && lines.length > 0) next += '\n'
  writeFileAtomic(path, next)
  return { removed: true, line }
}

/**
 * REVIEW-02 R9 Undo: insert one line at 1-based position `n` (clamped to the
 * end when out of range). Collapses embedded newlines — inbox entries are
 * single-line. Creates the file when absent. Returns the clamped `n` written.
 */
export function insertInboxLine(
  path: string,
  n: number,
  text: string,
): { inserted: true; n: number; line: string } {
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    raw = ''
  }
  const lines = splitInboxLines(raw)
  const line = text.replace(/[\r\n]+/g, ' ').trimEnd()
  const idx = !Number.isInteger(n) || n < 1
    ? lines.length
    : Math.min(n - 1, lines.length)
  lines.splice(idx, 0, line)
  let next = lines.join('\n')
  if (next.length > 0) next += '\n'
  mkdirSync(dirname(path), { recursive: true })
  writeFileAtomic(path, next)
  return { inserted: true, n: idx + 1, line }
}
