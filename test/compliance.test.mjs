/**
 * Unit tests for dsh-memento M3 ritual compliance (lib/compliance.js +
 * lib/vault.js): the state machine over synthetic event sequences, the
 * mutation classifier, the rolling log, and the ME.md invariant.
 * Run: node --test test/compliance.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const compliance = await import('../lib/compliance.js')
const vault = await import('../lib/vault.js')

const HOME = mkdtempSync(join(tmpdir(), 'memento-compliance-'))
const VAULT_ROOT = join(HOME, 'memory')
const PROJECT_KEY = '--smoke-project--'
const MEMORY_PATH = join(VAULT_ROOT, 'projects', PROJECT_KEY, 'MEMORY.md')

// Seed the vault once: ME.md via the real bootstrap, plus a project file so
// the tracker's ritualRequired=true path is exercised meaningfully.
vault.bootstrapVault(HOME, '# ME\n\n- template\n')
mkdirSync(join(VAULT_ROOT, 'projects', PROJECT_KEY), { recursive: true })
writeFileSync(join(MEMORY_PATH), 'project note\n', 'utf8')

function tracker(overrides = {}) {
  return new compliance.SessionComplianceTracker({
    projectKey: PROJECT_KEY,
    ritualRequired: true,
    vaultRoot: VAULT_ROOT,
    now: () => 0,
    ...overrides,
  })
}

// ---------------------------------------------------- state machine ---------

test('read-then-mutate → compliant, no violations', () => {
  const t = tracker()
  t.observeToolCall('read', { file_path: MEMORY_PATH }, 1000)
  t.observeToolCall('write', { file_path: '/tmp/proj/a.txt' }, 2000)
  const snap = t.snapshot()
  assert.equal(snap.memoryReadAt, 1000)
  assert.equal(snap.firstMutationAt, 2000)
  assert.equal(snap.compliant, true)
  assert.deepEqual(snap.violations, [])
})

test('mutate-then-read → not compliant, exactly one violation', () => {
  const t = tracker()
  t.observeToolCall('edit', { file_path: '/tmp/proj/a.txt' }, 1000)
  t.observeToolCall('read', { file_path: MEMORY_PATH }, 2000)
  const snap = t.snapshot()
  assert.equal(snap.memoryReadAt, 2000)
  assert.equal(snap.firstMutationAt, 1000)
  assert.equal(snap.compliant, false)
  assert.equal(snap.violations.length, 1)
  assert.equal(snap.violations[0].kind, 'mutation-before-memory-read')
  assert.equal(snap.violations[0].at, 1000)
  assert.equal(snap.violations[0].tool, 'edit')
})

test('read-only session (ritual required) → compliant', () => {
  const t = tracker()
  t.observeToolCall('read', { file_path: MEMORY_PATH }, 1000)
  const snap = t.snapshot()
  assert.equal(snap.firstMutationAt, null)
  assert.equal(snap.compliant, true)
})

test('no project MEMORY.md (ritual not required) → compliant null, even with a mutation', () => {
  const t = tracker({ ritualRequired: false })
  t.observeToolCall('write', { file_path: '/tmp/proj/a.txt' }, 1000)
  const snap = t.snapshot()
  assert.equal(snap.firstMutationAt, 1000)
  assert.equal(snap.compliant, null)
  assert.deepEqual(snap.violations, [])
})

test('multiple mutations before any read → still exactly one violation', () => {
  const t = tracker()
  t.observeToolCall('write', { file_path: '/tmp/proj/a.txt' }, 1000)
  t.observeToolCall('edit', { file_path: '/tmp/proj/b.txt' }, 1500)
  const snap = t.snapshot()
  assert.equal(snap.firstMutationAt, 1000)
  assert.equal(snap.compliant, false)
  assert.equal(snap.violations.length, 1)
})

test('a vault-path mutation (e.g. editing MEMORY.md itself) is read + mutate at once → compliant', () => {
  const t = tracker()
  t.observeToolCall('write', { file_path: MEMORY_PATH }, 1000)
  const snap = t.snapshot()
  assert.equal(snap.memoryReadAt, 1000)
  assert.equal(snap.firstMutationAt, 1000)
  assert.equal(snap.compliant, true)
})

test('same-millisecond mutate-then-read → violation and NOT compliant (no tie-break to true)', () => {
  const t = tracker()
  t.observeToolCall('bash', { command: 'echo x > out.txt' }, 1000)
  t.observeToolCall('bash', { command: `cat ${MEMORY_PATH}` }, 1000)
  const snap = t.snapshot()
  assert.equal(snap.compliant, false)
  assert.equal(snap.violations.length, 1)
})

test('raw JSON-string arguments (the session-log shape) are handled', () => {
  const t = tracker()
  t.observeToolCall('bash', JSON.stringify({ command: `cat ${MEMORY_PATH}` }), 1000)
  t.observeToolCall('write', JSON.stringify({ file_path: '/tmp/proj/a.txt' }), 2000)
  const snap = t.snapshot()
  assert.equal(snap.memoryReadAt, 1000)
  assert.equal(snap.firstMutationAt, 2000)
  assert.equal(snap.compliant, true)
})

test('snapshot() returns a defensive copy of violations', () => {
  const t = tracker()
  t.observeToolCall('write', { file_path: '/tmp/proj/a.txt' }, 1000)
  const snap1 = t.snapshot()
  snap1.violations.push({ kind: 'forged', at: 0, tool: 'nope' })
  const snap2 = t.snapshot()
  assert.equal(snap2.violations.length, 1)
  assert.equal(snap2.violations[0].kind, 'mutation-before-memory-read')
})

// ------------------------------------------------------ vault paths ---------

test('shell commands referencing the vault are reads: real root and ~/.dsh shorthand', () => {
  const real = tracker()
  real.observeToolCall('bash', { command: `rg SENTINEL ${MEMORY_PATH}` }, 1000)
  assert.equal(real.snapshot().memoryReadAt, 1000)

  const shorthand = tracker()
  shorthand.observeToolCall('bash', { command: 'rg SENTINEL ~/.dsh/memory/ME.md' }, 1000)
  assert.equal(shorthand.snapshot().memoryReadAt, 1000)
})

test('matchesVaultPath: empty and unrelated text do not match', () => {
  assert.equal(compliance.matchesVaultPath('', VAULT_ROOT), false)
  assert.equal(compliance.matchesVaultPath('ls -la /tmp', VAULT_ROOT), false)
  assert.equal(compliance.matchesVaultPath(MEMORY_PATH, VAULT_ROOT), true)
  assert.equal(compliance.matchesVaultPath('read ~/.dsh/memory/projects/k/MEMORY.md', VAULT_ROOT), true)
})

// ------------------------------------------------------- mutation list ------

test('mutation classifier: mutating shell commands are detected', () => {
  for (const command of [
    'node build.mjs',
    'node ./scripts/build.mjs',
    "sed -i 's/old/new/' file.txt",
    'echo x > out.txt',
    'echo x >> out.txt',
    'cat a | tee b',
    'git commit -m "msg"',
    'git push origin main',
    'cp a b',
    'mv a b',
    'rm -rf build',
    'mkdir -p dist',
    'touch stamp',
  ]) {
    assert.equal(compliance.isMutationCommand(command), true, command)
  }
})

test('mutation classifier: read-only shell commands are NOT mutations', () => {
  for (const command of [
    'ls -la',
    'rg pattern src/',
    'git status',
    'curl -s https://example.com',
    'cat file.txt',
    'pwd',
    'rg SENTINEL ~/.dsh/memory/ME.md',
  ]) {
    assert.equal(compliance.isMutationCommand(command), false, command)
  }
})

test('write/edit tool names are mutations by name alone', () => {
  const t = tracker()
  t.observeToolCall('write', { file_path: '/tmp/proj/a.txt' }, 1000)
  assert.equal(t.snapshot().firstMutationAt, 1000)
  const t2 = tracker()
  t2.observeToolCall('edit', { file_path: '/tmp/proj/b.txt' }, 1000)
  assert.equal(t2.snapshot().firstMutationAt, 1000)
})

test('a non-shell tool with a command-like argument is not auto-shell', () => {
  const t = tracker()
  t.observeToolCall('mystery_tool', { command: 'node build.mjs' }, 1000)
  // `command` argument is still honored (name-agnostic shell detection).
  assert.equal(t.snapshot().firstMutationAt, 1000)
})

// ------------------------------------------------------------- rolling log -

test('appendComplianceLog: one JSON line per ended session, oldest rotated out', () => {
  const log = join(HOME, 'memory', '.compliance.log')
  if (existsSync(log)) rmSync(log)
  for (let i = 1; i <= 5; i++) {
    compliance.appendComplianceLog(log, { sessionId: `sess-${i}`, n: i }, 3)
  }
  const lines = readFileSync(log, 'utf8').trim().split('\n')
  assert.equal(lines.length, 3)
  const parsed = lines.map((l) => JSON.parse(l))
  assert.deepEqual(parsed.map((p) => p.n), [3, 4, 5])
  // The file is valid JSONL (trailing newline, one object per line).
  assert.ok(readFileSync(log, 'utf8').endsWith('\n'))
})

// ------------------------------------------------------ inject + ME.md ------

test('ritual directive is appended only when the project MEMORY.md exists', () => {
  const withProject = vault.readVault(HOME, PROJECT_KEY)
  assert.equal(withProject.project.exists, true)
  const withBlock = vault.buildInjectBlockWithRitual(withProject, HOME)
  assert.ok(withBlock.block.includes('<!-- ritual -->'), withBlock.block)
  assert.ok(withBlock.block.includes(MEMORY_PATH), 'directive must name the absolute path')
  assert.equal(withBlock.chars, withBlock.block.length)

  const keyWithout = '--empty-project--'
  const withoutProject = vault.readVault(HOME, keyWithout)
  const plain = vault.buildInjectBlockWithRitual(withoutProject, HOME)
  assert.equal(plain.block.includes('ritual'), false)
  assert.equal(plain.block, vault.buildInjectBlock(withoutProject).block)
})

test('the ritual block is byte-stable across rebuilds (cache stability)', () => {
  const a = vault.buildInjectBlockWithRitual(vault.readVault(HOME, PROJECT_KEY), HOME).block
  const b = vault.buildInjectBlockWithRitual(vault.readVault(HOME, PROJECT_KEY), HOME).block
  assert.equal(a, b)
})

test('ME.md sha256 is unchanged by compliance activity (M2 invariant carried)', () => {
  const mePath = join(VAULT_ROOT, 'ME.md')
  const shaBefore = createHash('sha256').update(readFileSync(mePath, 'utf8')).digest('hex')
  // Full synthetic session lifecycle against this vault.
  const t = tracker()
  t.observeToolCall('bash', { command: `cat ${MEMORY_PATH}` }, 1000)
  t.observeToolCall('node build.mjs', { command: 'node build.mjs' }, 2000)
  compliance.appendComplianceLog(
    compliance.complianceLogPath(HOME),
    { endedAt: 'test', sessionId: 'unit', snapshot: t.snapshot() },
  )
  const shaAfter = createHash('sha256').update(readFileSync(mePath, 'utf8')).digest('hex')
  assert.equal(shaBefore, shaAfter)
})

test('teardown: temp DSH_HOME removed', () => {
  rmSync(HOME, { recursive: true, force: true })
})
