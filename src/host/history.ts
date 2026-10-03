/**
 * Session-log archaeology (M5): one read-only scan over `~/.dsh/sessions/`.
 *
 * Answers the one question nothing else in the vault can: "did we already try
 * this, and what happened?" The session logs are the episodic record — they
 * are grep targets, never a memory source. Nothing found here is copied into
 * the vault.
 *
 * Decompression uses the `zstd` CLI: session files are *multi-frame* zstd
 * (one frame per appended line) and Node's `zlib` zstd stops at the first
 * frame, so the CLI is the only decoder that sees the whole file.
 *
 * Robustness is the milestone, not the grep:
 *   - Read-only. Never writes, moves, or deletes under the sessions root.
 *   - Schema-tolerant. Glob `session.v*.jsonl.zstd`; per line, parse JSON for
 *     `type`/`time` when present, otherwise search the raw line text. A line
 *     that fails to parse is searched as a string, not an error.
 *   - Bounded. 2 s wall clock, 64 MiB decompressed, 50 hits. On any limit the
 *     scan stops and returns what it has with `truncated: true`.
 *   - Fail-open. Missing directory, unreadable file, corrupt zstd, zstd
 *     binary absent → the file lands in `degraded[]` and the scan continues;
 *     the result is still `ok: true`. Never throws.
 *
 * Node-only (fs/path/child_process/string_decoder): built standalone so
 * `node --test` exercises it without harness package resolution.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { join } from 'node:path'
import { isoLocal } from './inbox.ts'

/** Hard cap on hits (spec: `limit` max 50). */
export const HISTORY_MAX_LIMIT = 50

/** Default hit limit. */
export const HISTORY_DEFAULT_LIMIT = 10

/** Default wall-clock budget for the whole scan (ms). */
export const HISTORY_DEFAULT_BUDGET_MS = 2000

/** Default decompressed byte budget. */
export const HISTORY_DEFAULT_BYTE_BUDGET = 64 * 1024 * 1024

/** Snippet window: up to this many chars on each side of the match. */
const SNIPPET_PAD = 200

/** Hard cap on snippet length (chars). */
const SNIPPET_MAX = 400

/**
 * Queries longer than this are matched literally only: a long pattern is an
 * unlikely regex, and compiling one keeps backtracking risk at zero.
 */
const REGEX_MAX_QUERY_LEN = 200

/** Lines longer than this skip the regex fallback (literal only). */
const REGEX_MAX_LINE_LEN = 1024 * 1024

/** A single unterminated line longer than this is flushed as-is (chars). */
const MAX_LINE_CARRY = 2 * 1024 * 1024

/** Session-log file name pattern (schema-tolerant: any `v<N>`). */
const LOG_FILE_RE = /^session\.v\d+\.jsonl\.zstd$/

/** One hit: a snippet around one match in one log line. */
export interface HistoryHit {
  /** The project key (`--slug--` directory name) the hit came from. */
  projectKey: string
  /** The session id (`session-…`); null when the log carries none. */
  sessionId: string | null
  /** ISO local time of the event line, when one is present. */
  time: string | null
  /** The event `type` field, when present (e.g. `user/message`). */
  eventType: string | null
  /** At most 400 chars around the match. */
  snippet: string
}

/** `ok: true` result of {@link scanHistory}. */
export interface HistoryResult {
  ok: true
  /** Files that were opened and scanned (a file can be both scanned and degraded). */
  scanned: number
  /** Matches, newest first, at most `limit`. */
  hits: HistoryHit[]
  /** True when any bound (limit, wall clock, byte budget) cut the scan short. */
  truncated: boolean
  /** Files (or the root) that could not be scanned, with a short reason. */
  degraded: string[]
}

/** `ok: false` result: the request itself was unusable. */
export interface HistoryError {
  ok: false
  error: string
}

export type HistoryOutcome = HistoryResult | HistoryError

export interface HistoryScanOptions {
  /** Sessions root (e.g. `~/.dsh/sessions`). */
  root: string
  /** Literal substring, or a simple regex when the literal does not match. */
  query: string
  /** Restrict the scan to one project directory. Null/absent = all projects. */
  projectKey?: string | null
  /** Hit limit: clamped to 1..50 (default 10). */
  limit?: number
  /** Wall-clock budget for the whole scan (ms; default 2000). */
  budgetMs?: number
  /** Decompressed byte budget (default 64 MiB). */
  byteBudget?: number
  /** zstd executable (default `zstd` from PATH). */
  zstdBin?: string
}

interface LogFileEntry {
  /** Absolute path of the `.zstd` file. */
  file: string
  /** Project key directory name (`--slug--`). */
  projectKey: string
  /** Session directory name (usually `session-<uuid>`). */
  sessionDir: string
}

interface ScanState {
  deadline: number
  byteBudget: number
  limit: number
  query: string
  re: RegExp | null
  /** Decompressed bytes scanned so far (across all files). */
  bytes: number
  hits: HistoryHit[]
  degraded: string[]
  scanned: number
  truncated: false | true
  /** Set when the zstd binary cannot be spawned (all later files degrade). */
  binaryMissing: boolean
  /** Set when the wall clock or byte budget ran out mid-file. */
  stopped: boolean
}

/** Clamp a requested limit to the hard range 1..50. */
export function clampLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return HISTORY_DEFAULT_LIMIT
  const n = Math.floor(limit)
  if (n < 1) return 1
  if (n > HISTORY_MAX_LIMIT) return HISTORY_MAX_LIMIT
  return n
}

/**
 * Build the regex fallback for a query: a fresh, non-global RegExp when the
 * query compiles and is short enough to be plausible, else null. Never throws.
 */
export function compileRegexFallback(query: string): RegExp | null {
  if (query.length === 0 || query.length > REGEX_MAX_QUERY_LEN) return null
  try {
    return new RegExp(query)
  } catch {
    return null
  }
}

/**
 * Build a snippet of at most {@link SNIPPET_MAX} chars centered on the match.
 * Pure string work; safe for any input length.
 */
export function makeSnippet(line: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_PAD)
  const end = Math.min(line.length, matchIndex + matchLength + SNIPPET_PAD)
  if (end - start <= SNIPPET_MAX) return line.slice(start, end)
  // Keep the match visible: anchor the window to whichever side fits.
  if (matchIndex - start <= SNIPPET_PAD) {
    return line.slice(start, start + SNIPPET_MAX)
  }
  return line.slice(end - SNIPPET_MAX, end)
}

/** Extract a displayable time from a log line's `time` field (epoch ms or ISO string). */
function lineTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return isoLocal(date)
  }
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

/**
 * Match a query against one raw log line. Literal substring first; when the
 * literal is absent, the compiled regex (when any) is tried. Returns the match
 * index and length, or null.
 */
function matchLine(line: string, query: string, re: RegExp | null): { index: number; length: number } | null {
  const index = line.indexOf(query)
  if (index >= 0) return { index, length: query.length }
  if (re !== null && line.length <= REGEX_MAX_LINE_LEN) {
    const m = re.exec(line)
    if (m !== null) return { index: m.index, length: m[0].length }
  }
  return null
}

/**
 * Collect the scannable log files under `root`, newest first. Read-only.
 * Returns `null` when the root itself is missing/unreadable (caller degrades).
 */
function collectLogFiles(
  root: string,
  projectKey: string | null,
  degraded: string[],
): LogFileEntry[] | null {
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(root)
  } catch {
    degraded.push(`${root}: missing or unreadable`)
    return null
  }
  if (!st.isDirectory()) {
    degraded.push(`${root}: not a directory`)
    return null
  }
  let keys: string[]
  try {
    keys = readdirSync(root)
  } catch (error) {
    degraded.push(`${root}: unreadable (${errorMessage(error)})`)
    return null
  }
  if (projectKey !== null) {
    keys = keys.filter((k) => k === projectKey)
    if (keys.length === 0) {
      degraded.push(`${join(root, projectKey)}: project directory missing`)
      return []
    }
  }
  const entries: LogFileEntry[] = []
  for (const key of keys) {
    const keyDir = join(root, key)
    let sessionDirs: string[]
    try {
      sessionDirs = readdirSync(keyDir)
    } catch {
      degraded.push(`${keyDir}: unreadable`)
      continue
    }
    for (const sessionDir of sessionDirs) {
      const sessionPath = join(keyDir, sessionDir)
      let files: string[]
      try {
        files = readdirSync(sessionPath)
      } catch {
        continue // not a session dir (or unreadable) — nothing to scan
      }
      for (const name of files) {
        if (LOG_FILE_RE.test(name)) {
          entries.push({ file: join(sessionPath, name), projectKey: key, sessionDir })
        }
      }
    }
  }
  // Newest first: stat each file, drop (with a degrade note) the un-stat-able.
  const withTime: (LogFileEntry & { mtimeMs: number })[] = []
  for (const entry of entries) {
    try {
      const fst = statSync(entry.file)
      if (!fst.isFile()) {
        degraded.push(`${entry.file}: not a regular file`)
        continue
      }
      withTime.push({ ...entry, mtimeMs: fst.mtimeMs })
    } catch (error) {
      degraded.push(`${entry.file}: unreadable (${errorMessage(error)})`)
    }
  }
  withTime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return withTime
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Scan one log file with the zstd CLI, streaming stdout line by line.
 *
 * Semantics:
 *  - spawn failure because the binary is absent → `state.binaryMissing` (the
 *    file is also degraded).
 *  - any other spawn failure → file degraded.
 *  - non-zero exit (corrupt/truncated zstd) → lines already decoded are kept;
 *    the file is listed in `degraded[]`.
 *  - wall-clock / byte budget / hit limit → child killed, `state.stopped` set,
 *    `state.truncated` marked.
 */
function scanLogFile(entry: LogFileEntry, state: ScanState, zstdBin: string): Promise<void> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(zstdBin, ['-dc', entry.file], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      state.degraded.push(`${entry.file}: spawn failed (${errorMessage(error)})`)
      resolve()
      return
    }

    const decoder = new StringDecoder('utf8')
    let carry = ''
    // The session directory is normally named `session-<uuid>`, identical to
    // the first line's `id`; use it as a floor when the log carries no id.
    let sessionId: string | null = entry.sessionDir.startsWith('session-')
      ? entry.sessionDir
      : null
    let sawId = false
    let settled = false
    let exitCode: number | null = null
    // stderr is drained (and capped) so a chatty failure can never block us.
    let stderrBytes = 0
    const stderrTail: string[] = []

    const finish = (code: number | null, spawnError?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      if (spawnError !== undefined) {
        const code = (spawnError as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
          state.binaryMissing = true
          state.degraded.push(`${entry.file}: zstd binary unavailable`)
        } else {
          state.degraded.push(`${entry.file}: spawn failed (${errorMessage(spawnError)})`)
        }
        resolve()
        return
      }
      if (state.stopped) {
        state.truncated = true
      } else if (code !== 0) {
        // Corrupt or truncated zstd: keep the lines we did decode, but flag
        // the file so the caller knows the scan of it is incomplete.
        state.degraded.push(
          `${entry.file}: zstd failed (exit ${code}${stderrTail.length ? `: ${stderrTail.join('')}` : ''})`,
        )
      }
      resolve()
    }

    const killForStop = (): void => {
      if (settled) return
      state.stopped = true
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }

    const onLine = (line: string): void => {
      if (line.length === 0) return
      // Best-effort metadata: a line that fails to parse is searched as a
      // string, never an error.
      let parsed: { id?: unknown; type?: unknown; time?: unknown } | null = null
      try {
        parsed = JSON.parse(line) as { id?: unknown; type?: unknown; time?: unknown }
      } catch {
        parsed = null
      }
      if (
        !sawId &&
        parsed !== null &&
        typeof parsed.id === 'string' &&
        parsed.id.length > 0
      ) {
        sessionId = parsed.id
        sawId = true
      }
      const m = matchLine(line, state.query, state.re)
      if (m === null) return
      state.hits.push({
        projectKey: entry.projectKey,
        sessionId,
        time: parsed === null ? null : lineTime(parsed.time),
        eventType:
          parsed !== null && typeof parsed.type === 'string' && parsed.type.length > 0
            ? parsed.type
            : null,
        snippet: makeSnippet(line, m.index, m.length),
      })
      if (state.hits.length >= state.limit) {
        state.truncated = true
        killForStop()
      }
    }

    const onData = (chunk: Buffer): void => {
      if (state.stopped) return
      state.bytes += chunk.length
      if (state.bytes > state.byteBudget) {
        state.truncated = true
        killForStop()
        return
      }
      if (Date.now() >= state.deadline) {
        state.truncated = true
        killForStop()
        return
      }
      carry += decoder.write(chunk)
      let nl: number
      while ((nl = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, nl)
        carry = carry.slice(nl + 1)
        onLine(line)
        if (state.stopped) return
      }
      if (carry.length > MAX_LINE_CARRY) {
        onLine(carry)
        carry = ''
        if (state.stopped) return
      }
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', (chunk: Buffer): void => {
      if (stderrBytes >= 512) return
      stderrBytes += chunk.length
      stderrTail.push(chunk.toString('utf8'))
      if (stderrBytes > 512) {
        const joined = stderrTail.join('')
        stderrTail.length = 0
        stderrTail.push(joined.slice(-512))
      }
    })
    child.on('error', (error: Error) => finish(null, error))
    child.on('close', (code: number | null) => finish(code))
    // Watchdog: even a child that produces no output must not hold the scan
    // past the global deadline.
    const remaining = state.deadline - Date.now() + 250
    const watchdog = setTimeout(() => killForStop(), Math.max(remaining, 0))
    watchdog.unref?.()
  })
}

/**
 * Read-only, bounded, fail-open scan of the session logs. Never throws; the
 * only `ok: false` outcome is an unusable request (missing/empty query).
 *
 * @param opts scan options (root, query, scoping, limits).
 * @returns hits newest first, plus scan diagnostics.
 */
export async function scanHistory(opts: HistoryScanOptions): Promise<HistoryOutcome> {
  const query = typeof opts?.query === 'string' ? opts.query : ''
  if (query.length === 0) {
    return { ok: false, error: 'query must be a non-empty string' }
  }
  const root = typeof opts.root === 'string' && opts.root.length > 0 ? opts.root : ''
  if (root.length === 0) {
    return { ok: false, error: 'root must be a non-empty path' }
  }

  const state: ScanState = {
    deadline: Date.now() + (typeof opts.budgetMs === 'number' && opts.budgetMs > 0 ? opts.budgetMs : HISTORY_DEFAULT_BUDGET_MS),
    byteBudget: typeof opts.byteBudget === 'number' && opts.byteBudget > 0 ? opts.byteBudget : HISTORY_DEFAULT_BYTE_BUDGET,
    limit: clampLimit(opts.limit),
    query,
    re: compileRegexFallback(query),
    bytes: 0,
    hits: [],
    degraded: [],
    scanned: 0,
    truncated: false,
    binaryMissing: false,
    stopped: false,
  }

  const entries = collectLogFiles(root, opts.projectKey ?? null, state.degraded)
  if (entries === null) {
    return { ok: true, scanned: 0, hits: [], truncated: false, degraded: state.degraded }
  }

  const zstdBin = typeof opts.zstdBin === 'string' && opts.zstdBin.length > 0 ? opts.zstdBin : 'zstd'

  for (const entry of entries) {
    if (state.stopped) {
      state.truncated = true
      break
    }
    if (Date.now() >= state.deadline) {
      state.truncated = true
      break
    }
    if (state.bytes > state.byteBudget) {
      state.truncated = true
      break
    }
    if (state.binaryMissing) {
      state.degraded.push(`${entry.file}: zstd binary unavailable`)
      continue
    }
    state.scanned += 1
    try {
      await scanLogFile(entry, state, zstdBin)
    } catch (error) {
      // Unreachable in practice (scanLogFile never rejects), but the scan
      // must survive anything.
      state.degraded.push(`${entry.file}: scan error (${errorMessage(error)})`)
    }
  }

  // Newest first; hits without a time sort after timed ones (stable).
  state.hits.sort(
    (a, b) => {
      const ta = a.time === null ? -Infinity : Date.parse(a.time)
      const tb = b.time === null ? -Infinity : Date.parse(b.time)
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
      if (Number.isNaN(ta)) return 1
      if (Number.isNaN(tb)) return -1
      return tb - ta
    },
  )

  return {
    ok: true,
    scanned: state.scanned,
    hits: state.hits,
    truncated: state.truncated,
    degraded: state.degraded,
  }
}
