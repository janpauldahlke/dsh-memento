/**
 * Unit tests for the dsh-memento vault core (pure, no network, no vault IO
 * beyond temp dirs). Run: node --test test/vault.test.mjs
 *
 * `projectKey` must match the harness's own session-directory naming byte for
 * byte (`@deepseek-ai/dsh-session-persistence-jsonl` projectKey, dsh
 * 0.1.7-rc.2): separators and drive colons collapse to single `-`; `~` and
 * non-[A-Za-z0-9._-] code units escape as `~XXXX` (uppercase hex); leading
 * dashes strip; empty → root; wrapped `--slug--`; 251-char slug bound.
 * Note: NOT lowercased — the harness keeps case.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, statSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'

// The built vault core (ESM, node-only — no harness imports, so it runs under
// plain `node --test` without the dsh resolution environment).
import {
  ME_CAP,
  PROJECT_CAP,
  INJECT_BUDGET,
  projectKey,
  countLines,
  vaultPaths,
  bootstrapVault,
  readVault,
  buildInjectBlock,
  resolveDshHome,
} from '../lib/vault.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'memento-'))

test('projectKey: the four pinned cases', () => {
  assert.equal(projectKey('/home/hagbard/dev/overnite'), '--home-hagbard-dev-overnite--')
  assert.equal(projectKey('/tmp/lh-toy-hello'), '--tmp-lh-toy-hello--')
  assert.equal(projectKey('/home/hagbard/dev/dsh-agent-processes'), '--home-hagbard-dev-dsh-agent-processes--')
  assert.equal(projectKey('/'), '--root--')
})

test('projectKey: separator runs collapse to a single dash', () => {
  assert.equal(projectKey('//a//b'), '--a-b--')
  assert.equal(projectKey('a/b\\c'), '--a-b-c--')
  // A trailing separator run keeps its dash (only LEADING dashes strip).
  assert.equal(projectKey('/a///'), '--a---')
})

test('projectKey: drive colons are separators', () => {
  assert.equal(projectKey('C:/dev/proj'), '--C-dev-proj--')
})

test('projectKey: dots, underscores, hyphens pass through; case is preserved', () => {
  assert.equal(projectKey('/a/b_c.d-E/f.G'), '--a-b_c.d-E-f.G--')
  assert.equal(projectKey('/Home/Hagbard/DEV'), '--Home-Hagbard-DEV--')
})

test('projectKey: unsafe code units escape as ~XXXX uppercase hex', () => {
  assert.equal(projectKey('/a b'), '--a~0020b--')
  assert.equal(projectKey('/a '), '--a~0020--')
  assert.equal(projectKey('/a~b'), `--a~007Eb--`)
  assert.equal(projectKey('/aé'), `--a~00E9--`)
  assert.equal(projectKey('/a#b'), `--a~0023b--`)
})

test('projectKey: empty path throws', () => {
  assert.throws(() => projectKey(''))
})

test('projectKey: slug is bounded to 251 chars', () => {
  const long = '/' + 'a'.repeat(300)
  const key = projectKey(long)
  assert.equal(key, `--${'a'.repeat(251)}--`)
})

test('countLines: editor semantics', () => {
  assert.equal(countLines(''), 0)
  assert.equal(countLines('a'), 1)
  assert.equal(countLines('a\n'), 1)
  assert.equal(countLines('a\nb'), 2)
  assert.equal(countLines('a\nb\n'), 2)
})

test('caps are the design constants', () => {
  assert.equal(ME_CAP, 30)
  assert.equal(PROJECT_CAP, 45)
  assert.equal(INJECT_BUDGET, 4000)
})

test('vaultPaths: layout under the dsh home', () => {
  const paths = vaultPaths('/home/u/.dsh', '--home-u-dev-x--')
  assert.equal(paths.root, '/home/u/.dsh/memory')
  assert.equal(paths.projectsDir, '/home/u/.dsh/memory/projects')
  assert.equal(paths.me, '/home/u/.dsh/memory/ME.md')
  assert.equal(paths.project, '/home/u/.dsh/memory/projects/--home-u-dev-x--/MEMORY.md')
})

test('resolveDshHome: env override wins, tilde expands, default is ~/.dsh', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '/custom/.dsh' }), '/custom/.dsh')
  assert.equal(resolveDshHome({ DSH_HOME: '~/else' }), join(homedir(), 'else'))
  assert.equal(resolveDshHome({ DSH_HOME: '  ' }), join(homedir(), '.dsh')) // blank → default
  assert.equal(resolveDshHome({}), join(homedir(), '.dsh'))
})

test('bootstrapVault: creates dirs + ME.md from template, idempotent, never overwrites', () => {
  const home = tmp()
  const template = '# ME\n- one line\n'
  const first = bootstrapVault(home, template)
  assert.equal(first.created, true)
  assert.equal(readFileSync(first.mePath, 'utf8'), template)
  assert.ok(statSync(join(home, 'memory/projects')).isDirectory())

  // Second run: no rewrite.
  const second = bootstrapVault(home, template)
  assert.equal(second.created, false)
  assert.equal(readFileSync(first.mePath, 'utf8'), template)

  // Existing ME.md is never touched (not merged, not reformatted).
  writeFileSync(first.mePath, 'DO NOT TOUCH\n')
  bootstrapVault(home, template)
  assert.equal(readFileSync(first.mePath, 'utf8'), 'DO NOT TOUCH\n')
})

test('readVault: absent files report exists:false and never throw', () => {
  const home = tmp()
  const state = readVault(home, '--x--')
  assert.equal(state.key, '--x--')
  assert.equal(state.me.exists, false)
  assert.equal(state.me.lines, 0)
  assert.equal(state.project.exists, false)
})

test('readVault: chmod 000 file degrades to exists:false (fail-open)', () => {
  const home = tmp()
  const paths = vaultPaths(home, '--x--')
  mkdirSync(paths.root, { recursive: true })
  writeFileSync(paths.me, 'secret\n')
  chmodSync(paths.me, 0o000)
  try {
    const state = readVault(home, '--x--')
    if (process.getuid?.() !== 0) {
      assert.equal(state.me.exists, false)
      assert.equal(state.me.lines, 0)
    }
  } finally {
    chmodSync(paths.me, 0o644)
  }
})

test('readVault + caps: 40-line ME.md reports overCap, content untouched', () => {
  const home = tmp()
  const paths = vaultPaths(home, '--x--')
  mkdirSync(paths.root, { recursive: true })
  const lines = Array.from({ length: 40 }, (_, i) => `- line ${i + 1}`)
  const body = lines.join('\n') + '\n'
  writeFileSync(paths.me, body)
  const state = readVault(home, '--x--')
  assert.equal(state.me.exists, true)
  assert.equal(state.me.lines, 40)
  assert.equal(state.me.cap, ME_CAP)
  assert.equal(state.me.overCap, true)
  assert.equal(state.me.text, body) // verbatim — read never rewrites
})

test('buildInjectBlock: ME.md verbatim when no project file', () => {
  const home = tmp()
  const paths = vaultPaths(home, '--x--')
  mkdirSync(paths.root, { recursive: true })
  writeFileSync(paths.me, 'ME-BODY\n')
  const state = readVault(home, '--x--')
  const block = buildInjectBlock(state)
  assert.equal(block.block, 'ME-BODY\n')
  assert.equal(block.chars, 'ME-BODY\n'.length)
  assert.equal(block.truncated, false)
})

test('buildInjectBlock: ME.md + MEMORY.md verbatim when under budget', () => {
  const home = tmp()
  const paths = vaultPaths(home, '--x--')
  mkdirSync(dirname(paths.project), { recursive: true })
  writeFileSync(paths.me, 'ME\n')
  writeFileSync(paths.project, 'MEM\n')
  const state = readVault(home, '--x--')
  const block = buildInjectBlock(state)
  assert.equal(block.block, 'ME\nMEM\n')
  assert.equal(block.truncated, false)
})

test('buildInjectBlock: ME.md without trailing newline gets one before the project section', () => {
  const home = tmp()
  const paths = vaultPaths(home, '--x--')
  mkdirSync(dirname(paths.project), { recursive: true })
  writeFileSync(paths.me, 'ME-NO-NEWLINE')
  writeFileSync(paths.project, 'MEM\n')
  const state = readVault(home, '--x--')
  const block = buildInjectBlock(state)
  assert.equal(block.block, 'ME-NO-NEWLINE\nMEM\n')
})

test('buildInjectBlock: over budget → ME.md only, truncated:true (no mid-file cut)', () => {
  const home = tmp()
  const paths = vaultPaths(home, '--x--')
  mkdirSync(dirname(paths.project), { recursive: true })
  const me = 'M'.repeat(2500)
  const mem = 'P'.repeat(3000) // 2500 + 1 + 3000 > 4000
  writeFileSync(paths.me, me)
  writeFileSync(paths.project, mem)
  const state = readVault(home, '--x--')
  const block = buildInjectBlock(state)
  assert.equal(block.block, me)
  assert.equal(block.chars, 2500)
  assert.equal(block.truncated, true)
})

test('buildInjectBlock: exactly-at-budget is not truncated', () => {
  const home = tmp()
  const paths = vaultPaths(home, '--x--')
  mkdirSync(dirname(paths.project), { recursive: true })
  const me = 'M'.repeat(1999) + '\n' // 2000 chars, ends with newline
  const mem = 'P'.repeat(2000)
  writeFileSync(paths.me, me)
  writeFileSync(paths.project, mem)
  const state = readVault(home, '--x--')
  const block = buildInjectBlock(state)
  assert.equal(block.chars, INJECT_BUDGET)
  assert.equal(block.truncated, false)
})

test('buildInjectBlock: no ME.md → empty block, nothing injectable', () => {
  const home = tmp()
  const state = readVault(home, '--x--')
  const block = buildInjectBlock(state)
  assert.equal(block.block, '')
  assert.equal(block.chars, 0)
  assert.equal(block.truncated, false)
})
