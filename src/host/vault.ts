/**
 * Vault core for dsh-memento (M1): paths, cwd→project-key derivation,
 * bounded reads with line counting, and the 4000-char inject builder.
 *
 * Pure and dependency-light: every read failure degrades to `exists: false`
 * (fail-open). This module never writes anything except the one-time ME.md
 * template bootstrap, and it never modifies an existing ME.md or a project
 * MEMORY.md — no trim, no reformat, no reorder.
 *
 * `projectKey` mirrors the harness's own session-directory naming byte for
 * byte (`@deepseek-ai/dsh-session-persistence-jsonl` `projectKey`, pinned
 * dsh 0.1.7-rc.2): path separators and drive colons collapse to single `-`,
 * `~` and other unsafe code units escape as `~XXXX`, the key is bounded to
 * 251 chars, and the result is wrapped in `--…--`. Note the harness does NOT
 * lowercase — an uppercase cwd keeps its case on disk.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import RITUAL_TEMPLATE from '../../assets/ritual.md'

/** Environment variable overriding the harness home (harness convention). */
export const DSH_HOME_ENV = 'DSH_HOME'
/** Default harness home directory name under the OS home. */
export const DSH_HOME_DIR_NAME = '.dsh'

/**
 * Resolve the harness home: `$DSH_HOME` (trimmed, `~`-expanded) when set,
 * otherwise `~/.dsh`. Mirrors `@deepseek-ai/dsh-home-paths` `resolveDshHome`.
 */
export function resolveDshHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[DSH_HOME_ENV]
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : join(homedir(), DSH_HOME_DIR_NAME)
  let expanded = selected
  if (expanded === '~') expanded = homedir()
  else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) expanded = join(homedir(), expanded.slice(2))
  return resolve(expanded)
}

/** Hard cap: ME.md lines (see DESIGN.md §2). */
export const ME_CAP = 30
/** Hard cap: project MEMORY.md lines. */
export const PROJECT_CAP = 45
/** Hard ceiling: total injected chars per session. */
export const INJECT_BUDGET = 4000

/** Vault layout under the dsh home (`~/.dsh`). */
export const MEMORY_DIR_NAME = 'memory'
export const PROJECTS_DIR_NAME = 'projects'
export const ME_FILE_NAME = 'ME.md'
export const MEMORY_FILE_NAME = 'MEMORY.md'

/**
 * Derive the session-directory project key from an absolute cwd, matching the
 * harness's own naming exactly (see module docs).
 * @param cwd - absolute project directory (non-empty).
 * @returns the `--slug--` directory name DSH uses under `~/.dsh/sessions`.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * Count logical lines the way a text editor does: `''` → 0, `a\n` → 1,
 * `a\nb` → 2, `a\nb\n` → 2 (a trailing newline does not start a new line).
 */
export function countLines(text: string): number {
  if (text.length === 0) return 0
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  if (text.charCodeAt(text.length - 1) !== 10) n++
  return n
}

/** One vault file as observed by the state route and the inject builder. */
export interface VaultFileState {
  /** Absolute file path (the file may not exist). */
  path: string
  exists: boolean
  /** Verbatim content when readable; `undefined` when absent or unreadable. */
  text?: string
  lines: number
  cap: number
  /** `lines > cap` (the file is still injected verbatim when present — caps are reports, not edits). */
  overCap: boolean
}

/** Vault observation for one project key. */
export interface VaultState {
  me: VaultFileState
  project: VaultFileState
  /** Project key the observation was derived from. */
  key: string
}

/** Resolved vault file locations for one dsh home + project key. */
export interface VaultPaths {
  root: string
  projectsDir: string
  me: string
  project: string
}

/** Resolve vault file paths. */
export function vaultPaths(dshHome: string, key: string): VaultPaths {
  const root = join(dshHome, MEMORY_DIR_NAME)
  const projectsDir = join(root, PROJECTS_DIR_NAME)
  return {
    root,
    projectsDir,
    me: join(root, ME_FILE_NAME),
    project: join(projectsDir, key, MEMORY_FILE_NAME),
  }
}

/** Result of the one-time vault bootstrap. */
export interface BootstrapResult {
  /** `true` when ME.md was written from the template this call. */
  created: boolean
  mePath: string
  root: string
}

/**
 * Ensure the vault directories exist and seed ME.md from the template when —
 * and only when — it is absent. An existing ME.md is never touched.
 * @param dshHome - the dsh home directory (usually `~/.dsh`).
 * @param templateText - verbatim ME.template.md content.
 * @throws on unexpected fs failures; callers (host apply) catch and log.
 */
export function bootstrapVault(dshHome: string, templateText: string): BootstrapResult {
  const paths = vaultPaths(dshHome, '')
  mkdirSync(paths.root, { recursive: true })
  mkdirSync(paths.projectsDir, { recursive: true })
  let created = false
  if (!existsSync(paths.me)) {
    writeFileSync(paths.me, templateText, 'utf8')
    created = true
  }
  return { created, mePath: paths.me, root: paths.root }
}

/** Read one vault file, degrading every failure to absent. */
function readVaultFile(path: string, cap: number): VaultFileState {
  let text: string | undefined
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    text = undefined // ENOENT and EACCES alike: absent/unreadable
  }
  const lines = text === undefined ? 0 : countLines(text)
  return {
    path,
    exists: text !== undefined,
    ...text !== undefined ? { text } : {},
    lines,
    cap,
    overCap: lines > cap,
  }
}

/**
 * Read the vault for one project key. Never throws: permission failures and
 * missing files all report `exists: false` so the state route stays `ok: true`.
 */
export function readVault(dshHome: string, key: string): VaultState {
  const paths = vaultPaths(dshHome, key)
  return {
    me: readVaultFile(paths.me, ME_CAP),
    project: readVaultFile(paths.project, PROJECT_CAP),
    key,
  }
}

/** Built inject block plus its budget facts (shared by state route + inject). */
export interface InjectBlock {
  /** Exact bytes to deliver (`''` when there is nothing to inject). */
  block: string
  /** `block.length` in characters. */
  chars: number
  /** True when the project section was dropped to fit the ceiling. */
  truncated: boolean
}

/**
 * M3 ritual directive, or `undefined` when it must be omitted (no project
 * `MEMORY.md` — you are never told to read a missing file, and no key means
 * no project at all). The `<project-file>` placeholder is replaced with the
 * absolute vault path so the directive is always correct under a custom
 * `$DSH_HOME`.
 */
export function ritualDirective(state: VaultState, dshHome: string): string | undefined {
  if (!state.project.exists || state.key.length === 0) return undefined
  const target = vaultPaths(dshHome, state.key).project
  return RITUAL_TEMPLATE.replace('<project-file>', () => target).trimEnd()
}

/**
 * Build the session-start block: ME.md verbatim, then project MEMORY.md
 * verbatim when it exists. Over the ceiling: ME.md only (never a mid-file
 * cut); an over-cap ME.md is still delivered whole — caps are reports, not
 * edits.
 */
export function buildInjectBlock(state: VaultState): InjectBlock {
  const meText = state.me.text
  if (meText === undefined) return { block: '', chars: 0, truncated: false }
  const projectText = state.project.text
  if (projectText === undefined || projectText.length === 0) {
    return { block: meText, chars: meText.length, truncated: false }
  }
  const separator = meText.endsWith('\n') ? '' : '\n'
  const full = `${meText}${separator}${projectText}`
  if (full.length <= INJECT_BUDGET) {
    return { block: full, chars: full.length, truncated: false }
  }
  return { block: meText, chars: meText.length, truncated: true }
}

/**
 * M3: the session-start block with the ritual directive appended when a
 * project `MEMORY.md` exists. Pure function of the vault state (like
 * `buildInjectBlock`), so it stays byte-identical across steps and sessions
 * of the same project — the directive never breaks cache stability.
 */
export function buildInjectBlockWithRitual(state: VaultState, dshHome: string): InjectBlock {
  const base = buildInjectBlock(state)
  if (base.block.length === 0) return base
  const directive = ritualDirective(state, dshHome)
  if (directive === undefined) return base
  const block = base.block.endsWith('\n')
    ? `${base.block}\n${directive}`
    : `${base.block}\n\n${directive}`
  return { block, chars: block.length, truncated: base.truncated }
}
