/**
 * Ritual compliance for dsh-memento (M3): mechanical observation of whether
 * a session read project memory before its first file mutation.
 *
 * No model is involved: the mutation list is one exported constant
 * (`MUTATION_COMMAND_PATTERNS`) and the state machine is a pure fold over
 * tool calls. Observation only — never block, retry, or re-prompt; the
 * decision to enforce is the human's, made after the numbers exist.
 *
 * Node-only by design (fs/path, no harness runtime imports) so the built
 * `lib/compliance.js` runs under plain `node --test` without the harness
 * packages.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Rolling-tail cap for `.compliance.log` (one line per ended session). */
export const COMPLIANCE_LOG_CAP = 500

/**
 * Whether `text` references a path under the vault: either the actual vault
 * root (e.g. `$DSH_HOME/memory`) or the conventional `~/.dsh/memory`
 * shorthand (the default harness home).
 */
export function matchesVaultPath(text: string, vaultRoot: string): boolean {
  if (text.length === 0) return false
  if (text.includes(vaultRoot)) return true
  return /\.dsh\/memory/.test(text)
}

/** Tool names that write or edit a file (a mutation by name alone). */
export const WRITE_TOOL_NAMES: readonly string[] = ['write', 'edit', 'apply_patch', 'patch']

/** Tool names that run a shell (a command-string argument is expected). */
export const SHELL_TOOL_NAMES: readonly string[] = ['bash', 'shell', 'exec', 'run', 'execute']

/**
 * The complete shell mutation list — the spec. A shell invocation plausibly
 * mutates when its command string matches any of these: a redirect, `tee`,
 * `sed -i`, `git commit` / `git push`, a build run (`node build.mjs`), or
 * the classic file-mutating commands. `ls`, `rg`, `git status`, and `curl`
 * match none of them.
 */
export const MUTATION_COMMAND_PATTERNS: readonly RegExp[] = [
  // Shell redirect `>` / `>>` (excluding `=>` / `->` arrow noise).
  /(?<![=>-])>/,
  /\btee(\s|$)/,
  /\bsed\s+-[A-Za-z]*i[A-Za-z]*(\s|$)/,
  /\bsed\s+--in-?place/,
  /\bgit\s+commit(\s|$)/,
  /\bgit\s+push(\s|$)/,
  /\bnode\s+[\w./\\-]*build[\w./\\-]*\.(?:mjs|cjs|js)(\s|$)/,
  /\b(?:cp|mv|rm|mkdir|rmdir|touch|ln|dd|truncate)(\s|$)/,
]

/** Whether a shell command string plausibly mutates state. */
export function isMutationCommand(command: string): boolean {
  return MUTATION_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

/** Collect every string value of a JSON-like structure, depth first. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
  } else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) collectStrings(child, out)
  }
  return out
}

/**
 * Parse tool-call arguments (an object, or the raw JSON string the session
 * log carries) into a plain object. Non-object JSON (or parse failures)
 * yields `null`; the raw string is still inspected for vault paths.
 */
export function parseToolArguments(
  arguments_: Record<string, unknown> | string | null,
): Record<string, unknown> | null {
  if (arguments_ === null) return null
  if (typeof arguments_ !== 'string') return arguments_
  try {
    const value: unknown = JSON.parse(arguments_)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Extract the command string of a shell invocation, when present.
 * `command` / `cmd` arguments win; a known shell tool name falls back to a
 * string-`args` array (joined). Anything else is not a shell invocation.
 */
export function shellCommand(name: string, args: Record<string, unknown> | null): string | null {
  if (args === null) return null
  for (const key of ['command', 'cmd']) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  if (SHELL_TOOL_NAMES.includes(name)) {
    const positional = args.args
    if (Array.isArray(positional)) {
      const joined = positional.filter((item) => typeof item === 'string').join(' ')
      if (joined.length > 0) return joined
    }
  }
  return null
}

/** One compliance violation (a mutation that skipped the ritual). */
export interface ComplianceViolation {
  kind: 'mutation-before-memory-read'
  /** Epoch ms of the violating call. */
  at: number
  /** Name of the tool call that violated. */
  tool: string
}

/** Point-in-time compliance report for one session. */
export interface ComplianceSnapshot {
  /** The session's project key (`null` when the session has no cwd). */
  projectKey: string | null
  /** True when a project `MEMORY.md` existed at session start. */
  ritualRequired: boolean
  /** Epoch ms of the first vault-path read (null when none). */
  memoryReadAt: number | null
  /** Epoch ms of the first file mutation (null when none). */
  firstMutationAt: number | null
  /**
   * `true` / `false` when a ritual was required (a read-only session is
   * compliant); `null` when no ritual was requested (no project file).
   */
  compliant: boolean | null
  /** One entry per violating mutation (normally zero or one). */
  violations: ComplianceViolation[]
}

export interface TrackerOptions {
  /** The session's project key (`null` when the session has no cwd). */
  projectKey: string | null
  /** Whether a project `MEMORY.md` existed at session start. */
  ritualRequired: boolean
  /** The actual vault root (e.g. `$DSH_HOME/memory`). */
  vaultRoot: string
  /** Clock (injectable for deterministic tests). */
  now?: () => number
}

/**
 * Session-scoped compliance state machine: a pure fold over observed tool
 * calls. `memoryReadAt` is the first call that references a vault path
 * (file-read tools and shell invocations alike); `firstMutationAt` is the
 * first call that writes or edits a file, or runs a plausibly-mutating
 * shell command.
 */
export class SessionComplianceTracker {
  private readonly projectKey: string | null
  private readonly ritualRequired: boolean
  private readonly vaultRoot: string
  private readonly now: () => number
  private memoryReadAt: number | null = null
  private firstMutationAt: number | null = null
  /**
   * Fixed at the first mutation (when the read state is final): `true` when
   * a vault read had already happened, `false` when it had not (the
   * violation is recorded alongside). Stays `null` until then.
   */
  private determined: boolean | null = null
  private violations: ComplianceViolation[] = []

  constructor(options: TrackerOptions) {
    this.projectKey = options.projectKey
    this.ritualRequired = options.ritualRequired
    this.vaultRoot = options.vaultRoot
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Fold in one tool call. `arguments` may be the parsed object or the raw
   * JSON string the session log carries; `at` overrides the clock (tests).
   */
  observeToolCall(
    name: string,
    arguments_: Record<string, unknown> | string | null,
    at?: number,
  ): void {
    const ts = at ?? this.now()
    // 1) Vault read? Any tool call whose arguments reference a vault path —
    //    a file-read tool argument or a shell command string alike.
    const haystacks: string[] = [name]
    if (typeof arguments_ === 'string') haystacks.push(arguments_)
    const args = parseToolArguments(arguments_)
    if (args !== null) haystacks.push(...collectStrings(args))
    if (haystacks.some((value) => matchesVaultPath(value, this.vaultRoot))) {
      if (this.memoryReadAt === null) this.memoryReadAt = ts
    }
    // 2) Mutation? A write/edit tool, or a plausibly-mutating shell command.
    let isMutation = WRITE_TOOL_NAMES.includes(name)
    const command = shellCommand(name, args)
    if (command !== null && isMutationCommand(command)) isMutation = true
    if (!isMutation) return
    if (this.firstMutationAt === null) {
      this.firstMutationAt = ts
      if (this.ritualRequired && this.determined === null) {
        // The read state is now final: a read that happened (or is happening
        // in this very call) satisfies the ritual; nothing before it does not.
        if (this.memoryReadAt === null) {
          this.determined = false
          this.violations.push({ kind: 'mutation-before-memory-read', at: ts, tool: name })
        } else {
          this.determined = true
        }
      }
    }
  }

  /** Point-in-time report (the route payload is built from this). */
  snapshot(): ComplianceSnapshot {
    let compliant: boolean | null
    if (!this.ritualRequired) {
      compliant = null
    } else if (this.firstMutationAt === null) {
      compliant = true
    } else {
      compliant = this.determined
    }
    return {
      projectKey: this.projectKey,
      ritualRequired: this.ritualRequired,
      memoryReadAt: this.memoryReadAt,
      firstMutationAt: this.firstMutationAt,
      compliant,
      violations: [...this.violations],
    }
  }
}

/** Path of the compliance rolling log (dot-prefixed; never injected, never shown as memory). */
export function complianceLogPath(dshHome: string): string {
  return join(dshHome, 'memory', '.compliance.log')
}

/**
 * M4: rolling history counts for the Memory pane's compliance strip ("7/9
 * sessions"), parsed from the rolling log. `null` when the log is absent,
 * unreadable, or has no determined sessions (the payload then omits
 * `history` rather than reporting zeros).
 */
export function readComplianceHistory(
  dshHome: string,
): { total: number; compliant: number; nonCompliant: number } | null {
  let raw: string
  try {
    raw = readFileSync(complianceLogPath(dshHome), 'utf8')
  } catch {
    return null // no log yet: nothing logged, nothing to report
  }
  let total = 0
  let compliant = 0
  let nonCompliant = 0
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    try {
      const entry = JSON.parse(line) as { compliant?: unknown }
      if (entry.compliant === true) compliant++
      else if (entry.compliant === false) nonCompliant++
      else continue // null compliant: no ritual was requested — not logged as a determination
    } catch {
      continue // a torn line must not sink the whole strip
    }
  }
  total = compliant + nonCompliant
  if (total === 0) return null
  return { total, compliant, nonCompliant }
}

/**
 * Append one JSON line per ended session, keeping at most `capLines` lines
 * (oldest rotated out). The file is rewritten — it is small by construction.
 */
export function appendComplianceLog(
  path: string,
  entry: Record<string, unknown>,
  capLines: number = COMPLIANCE_LOG_CAP,
): void {
  let lines: string[] = []
  try {
    lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.length > 0)
  } catch {
    lines = [] // absent file: first line
  }
  lines.push(JSON.stringify(entry))
  if (lines.length > capLines) lines = lines.slice(lines.length - capLines)
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
}
