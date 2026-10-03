/**
 * M3 acceptance for dsh-memento (ritual enforcement).
 *
 * Per plan/M3-ritual-enforcement.md, ALL checks run against synthetic event
 * sequences — fully deterministic, no live model, no server required. The
 * state machine and classifier are exercised directly against the built
 * `lib/compliance.js` / `lib/vault.js`; file effects go to a temp DSH_HOME.
 *
 * Checks:
 *   1. read-then-mutate → compliant: true.
 *   2. mutate-then-read → compliant: false, one entry in violations.
 *   3. read-only session (no mutation) → compliant: true.
 *   4. no project MEMORY.md → ritualRequired: false, compliant: null.
 *   5. Vault read detected via shell (rg SENTINEL ~/.dsh/memory/ME.md) counts
 *      as memoryReadAt, not just via the file-read tool.
 *   6. Mutation classifier: node build.mjs, sed -i, echo x > f are mutations;
 *      ls, rg, git status, curl are not.
 *   7. .compliance.log gains exactly one line per ended session; at 500 lines
 *      it rotates and does not grow unbounded.
 *   8. ME.md sha256 unchanged across the run (carried forward from M2).
 *   9. The injected block with the directive is byte-identical across steps
 *      (M1 check 5 must still pass — the directive must not break cache
 *      stability).
 *
 * Live bonus (non-gating): if :3090 already runs a ≥ M3 bundle, the
 * compliance route is probed live as well. A stale or absent server only
 * prints a note — the nine checks above are the gate, and they are synthetic.
 *
 * Exit: 0 = all checks pass, 1 = a check failed.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as compliance from '../lib/compliance.js'
import * as vault from '../lib/vault.js'

const REPO = process.cwd()
const REAL_DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const REAL_ME_PATH = join(REAL_DSH_HOME, 'memory', 'ME.md')
const BASE = 'http://127.0.0.1:3090'

// Temp DSH_HOME: every file effect of this run stays here.
const HOME = mkdtempSync(join(homedir(), 'memento-accept-m3-'))
const VAULT_ROOT = join(HOME, 'memory')
const KEY = '--accept-project--'
const MEMORY_PATH = join(VAULT_ROOT, 'projects', KEY, 'MEMORY.md')
const LOG_PATH = compliance.complianceLogPath(HOME)

const results = []
function record(ok, name, note = '') {
  results.push({ ok, name, note })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sha256File = (path) => (existsSync(path) ? sha256(readFileSync(path)) : null)

function tracker(overrides = {}) {
  return new compliance.SessionComplianceTracker({
    projectKey: KEY,
    ritualRequired: true,
    vaultRoot: VAULT_ROOT,
    ...overrides,
  })
}

console.log('dsh-memento M3 acceptance')
console.log(`  repo=${REPO}`)
console.log(`  real HOME (ME.md invariant)=${REAL_DSH_HOME}`)
console.log(`  temp HOME (file effects)=${HOME}`)

// Seed the temp vault: ME.md via the real bootstrap + a project file.
vault.bootstrapVault(HOME, '# ME\n\n- template\n')
mkdirSync(join(VAULT_ROOT, 'projects', KEY), { recursive: true })
writeFileSync(MEMORY_PATH, 'project note\n', 'utf8')
const meShaBefore = sha256File(REAL_ME_PATH)
assert(meShaBefore !== null, 'ME.md missing — the M1 vault bootstrap should have created it')

try {
  // ------------------------------------------------- check 1 (read-then-…) --
  await (async () => {
    const t = tracker()
    t.observeToolCall('read', { file_path: MEMORY_PATH }, 1000)
    t.observeToolCall('write', { file_path: '/proj/a.txt' }, 2000)
    const snap = t.snapshot()
    assert(snap.memoryReadAt === 1000 && snap.firstMutationAt === 2000, `timestamps wrong: ${JSON.stringify(snap)}`)
    assert(snap.compliant === true, `expected compliant true, got ${snap.compliant}`)
    assert(snap.violations.length === 0, 'no violations expected')
    record(true, '1', 'read-then-mutate → compliant: true')
  })()

  // ------------------------------------------------- check 2 (mutate-then-…) --
  await (async () => {
    const t = tracker()
    t.observeToolCall('edit', { file_path: '/proj/a.txt' }, 1000)
    t.observeToolCall('read', { file_path: MEMORY_PATH }, 2000)
    const snap = t.snapshot()
    assert(snap.compliant === false, `expected compliant false, got ${snap.compliant}`)
    assert(snap.violations.length === 1, `expected exactly one violation, got ${snap.violations.length}`)
    assert(snap.violations[0].kind === 'mutation-before-memory-read', 'wrong violation kind')
    record(true, '2', 'mutate-then-read → compliant: false, one violation entry')
  })()

  // ------------------------------------------------- check 3 (read-only) ----
  await (async () => {
    const t = tracker()
    t.observeToolCall('read', { file_path: MEMORY_PATH }, 1000)
    const snap = t.snapshot()
    assert(snap.firstMutationAt === null, 'no mutation expected')
    assert(snap.compliant === true, `read-only session must be compliant, got ${snap.compliant}`)
    record(true, '3', 'read-only session → compliant: true')
  })()

  // ------------------------------------------------- check 4 (no MEMORY.md) --
  await (async () => {
    const t = tracker({ ritualRequired: false })
    t.observeToolCall('write', { file_path: '/proj/a.txt' }, 1000)
    const snap = t.snapshot()
    assert(snap.ritualRequired === false, 'ritualRequired must be false')
    assert(snap.compliant === null, `no ritual → compliant must be null, got ${snap.compliant}`)
    assert(snap.violations.length === 0, 'a missing project file is never a violation')
    record(true, '4', 'no project MEMORY.md → ritualRequired: false, compliant: null')
  })()

  // ------------------------------------------------- check 5 (shell read) ---
  await (async () => {
    // Shorthand form (the spec's own example):
    const t1 = tracker()
    t1.observeToolCall('bash', { command: 'rg SENTINEL ~/.dsh/memory/ME.md' }, 1000)
    assert(t1.snapshot().memoryReadAt === 1000, 'shorthand ~/.dsh/memory not detected as a vault read')
    // Real-root form (custom DSH_HOME):
    const t2 = tracker()
    t2.observeToolCall('bash', { command: `head -5 ${MEMORY_PATH}` }, 1000)
    assert(t2.snapshot().memoryReadAt === 1000, 'real vault root not detected as a vault read')
    record(true, '5', 'shell command referencing the vault counts as memoryReadAt (shorthand + real root)')
  })()

  // ------------------------------------------------- check 6 (classifier) ---
  await (async () => {
    const mutations = ['node build.mjs', "sed -i 's/old/new/' f", 'echo x > f', 'git commit -m x', 'git push', 'cp a b']
    const nonMutations = ['ls', 'rg pattern dir/', 'git status', 'curl -s https://example.com', 'cat f']
    for (const command of mutations) {
      assert(compliance.isMutationCommand(command) === true, `expected mutation: ${command}`)
    }
    for (const command of nonMutations) {
      assert(compliance.isMutationCommand(command) === false, `expected NOT a mutation: ${command}`)
    }
    record(true, '6', 'mutation classifier: 6 mutating / 5 read-only commands classified correctly')
  })()

  // ------------------------------------------------- check 7 (rolling log) --
  await (async () => {
    const cap = compliance.COMPLIANCE_LOG_CAP
    assert(cap === 500, `expected cap 500, got ${cap}`)
    // One line per ended session:
    const t = tracker()
    t.observeToolCall('read', { file_path: MEMORY_PATH }, 1)
    t.observeToolCall('write', { file_path: '/proj/a.txt' }, 2)
    compliance.appendComplianceLog(LOG_PATH, { sessionId: 'accept-1', ...t.snapshot() })
    compliance.appendComplianceLog(LOG_PATH, { sessionId: 'accept-2', compliant: true })
    let lines = readFileSync(LOG_PATH, 'utf8').trim().split('\n')
    assert(lines.length === 2, `expected 2 lines, got ${lines.length}`)
    for (const line of lines) JSON.parse(line) // every line is valid JSON
    // Rotation at the cap: append cap+10 more, the file must hold exactly cap.
    for (let i = 0; i < cap + 10; i++) {
      compliance.appendComplianceLog(LOG_PATH, { sessionId: `fill-${i}` })
    }
    lines = readFileSync(LOG_PATH, 'utf8').trim().split('\n')
    assert(lines.length === cap, `expected ${cap} lines after overflow, got ${lines.length}`)
    const last = JSON.parse(lines[lines.length - 1])
    assert(last.sessionId === `fill-${cap + 9}`, 'newest entry must be the last line')
    assert(!lines.some((l) => l.includes('"accept-1"')), 'oldest entries must have rotated out')
    record(true, '7', `one line per ended session; capped at ${cap} lines with oldest rotated out`)
  })()

  // ------------------------------------------------- check 8 (ME.md sha) ---
  await (async () => {
    assert(sha256File(REAL_ME_PATH) === meShaBefore, 'ME.md sha256 changed across the run')
    record(true, '8', 'ME.md sha256 unchanged across the entire run')
  })()

  // ------------------------------------------------- check 9 (cache stable) --
  await (async () => {
    const build = () => vault.buildInjectBlockWithRitual(vault.readVault(HOME, KEY), HOME)
    const a = build()
    const b = build()
    assert(a.block.length > 0, 'block must not be empty')
    assert(a.block.includes('<!-- ritual -->'), 'directive must be present in the block')
    assert(a.block.includes(MEMORY_PATH), 'directive must name the absolute project file path')
    assert(a.block === b.block, 'block must be byte-identical across steps (cache stability)')
    assert(a.chars === a.block.length, 'chars must equal block length')
    // And without a project file the directive is omitted entirely:
    const bare = vault.buildInjectBlockWithRitual(vault.readVault(HOME, '--empty--'), HOME)
    assert(!bare.block.includes('ritual'), 'directive must be omitted when the project file is absent')
    record(true, '9', 'directive present, byte-identical across steps, omitted without project file')
  })()

  // ------------------------------------------------- live bonus (non-gating) --
  try {
    const res = await fetch(BASE + '/api/dsh-memento/health', { signal: AbortSignal.timeout(4000) })
    const health = await res.json()
    const milestoneNum = Number(String(health?.milestone ?? '').replace(/\D/g, ''))
    if (milestoneNum >= 3) {
      const cRes = await fetch(BASE + '/api/dsh-memento/compliance', { signal: AbortSignal.timeout(4000) })
      const c = await cRes.json()
      assert(cRes.status === 200 && c?.ok === true, `live compliance route not ok (status ${cRes.status})`)
      record(true, 'LIVE', `:3090 runs milestone ${health.milestone}; GET /compliance → ok:true`)
    } else {
      console.log(`  note  :3090 serves milestone ${health?.milestone} (pre-M3) — live route probe skipped; synthetic checks are the gate.`)
      console.log('        After the human restart: ./agent/boot-3090.sh, then re-run this script for the live probe.')
    }
  } catch {
    console.log('  note  :3090 unreachable — live route probe skipped; synthetic checks are the gate.')
  }
} catch (error) {
  record(false, 'crash', String(error?.message ?? error))
} finally {
  rmSync(HOME, { recursive: true, force: true })
}

const failed = results.some((r) => !r.ok)
console.log(failed ? '\nM3 acceptance: FAIL' : '\nM3 acceptance: PASS')
process.exit(failed ? 1 : 0)
