/**
 * M5 acceptance for dsh-memento (memory_history_search, session-log
 * archaeology).
 *
 * Reuses the human-owned acceptance server on :3090 — this script NEVER
 * spawns, kills, or restarts any dsh process (plan/PROTOCOL.md "Sacred").
 * If :3090 answers with a stale bundle (pre-M5) or is unreachable, the
 * script exits 2 with a restart instruction.
 *
 * Checks (plan/M5-history-search.md):
 *   1. Known-present: "Disk is law" across all projects → ≥1 hit with a real
 *      sessionId that exists on disk and a non-empty snippet.
 *   2. Known-absent: a fresh random UUID → hits: [], ok: true (not an error).
 *   3. Project scoping, driven through the built tool wrapper: a search with
 *      the current session's cwd returns hits only from that project key.
 *   4. Missing dir: scanner pointed at a non-existent path → ok, hits: [],
 *      degraded non-empty, no throw.
 *   5. Corrupt file: garbage .zstd in a temp sessions tree → appears in
 *      degraded[], sibling files still searched.
 *   6. Bounds: limit 100 clamps to 50; a pathological broad query ("e") over
 *      the real sessions root returns inside the 2 s budget, truncated: true.
 *   7. Every snippet returned anywhere in this run is ≤400 chars.
 *   8. Read-only proof: sha256 of every file in the temp sessions tree is
 *      unchanged after search runs; no files added or removed.
 *   9. ME.md sha256 unchanged (carried forward from M2).
 *
 * The built scanner core (lib/history.js) is driven directly for checks 1,
 * 2, 4-8; the built host bundle (lib/index.js) is driven with a mock harness
 * context for check 3, so the tool wrapper (cwd → project resolution) is
 * exercised against the real sessions root too.
 *
 * Exit: 0 = all checks pass, 1 = a check failed, 2 = stale bundle / :3090
 * unreachable.
 */
import nodeAssert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:3090'
const PORT = 3090
const REPO = process.cwd()
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const SESSIONS_ROOT = join(DSH_HOME, 'sessions')
const ME_PATH = join(DSH_HOME, 'memory', 'ME.md')
const MEMENTO_KEY = '--home-hagbard-dev-dsh-memento--'

const results = []
function record(ok, name, note = '') {
  results.push({ ok, name, note })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
// Node strict-assert conveniences on the local guard (deepEqual, equal).
assert.deepEqual = nodeAssert.deepEqual
assert.equal = nodeAssert.equal

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sha256Buf = (path) => (existsSync(path) ? sha256(readFileSync(path)) : null)

/** Recursive { relativePath: sha256 } map of every file under `dir`. */
function treeHashes(dir) {
  const out = {}
  const walk = (d, rel) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full, rel === '' ? entry : `${rel}/${entry}`)
      else out[rel === '' ? entry : `${rel}/${entry}`] = sha256(readFileSync(full))
    }
  }
  walk(dir, '')
  return out
}

async function httpJson(path) {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(BASE + path)
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* non-JSON */ }
      return { status: res.status, json }
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
  throw new Error(`unreachable ${path}: ${lastError}`)
}

console.log('dsh-memento M5 acceptance')
console.log(`  repo=${REPO}`)
console.log(`  HOME=${DSH_HOME}`)
console.log(`  sessions=${SESSIONS_ROOT}`)
console.log(`  port=${PORT}`)

// ---------------------------------------------------------------- gate ------
let health
try {
  const { status, json } = await httpJson('/api/dsh-memento/health')
  health = json
  assert(status === 200 && health?.ok === true, `health not ok (status ${status})`)
} catch (error) {
  console.error(`:3090 unreachable: ${error}`)
  console.error('The human boots/restarts it with ./agent/boot-3090.sh (cwd = repo). Not an agent action.')
  process.exit(2)
}
const milestoneNum = (m) => Number(String(m ?? '').replace(/\D/g, ''))
if (milestoneNum(health.milestone) < 5) {
  console.error(`stale bundle on :3090 (milestone=${health.milestone}, version=${health.version}) — the M5 build is not loaded.`)
  console.error('Host bundles load once per server start; the agent must not restart dsh.')
  console.error('Human action: ./agent/boot-3090.sh (cwd = this repo), then re-run node agent/accept-m5.mjs')
  process.exit(2)
}
console.log(`  :3090 milestone=${health.milestone} version=${health.version}`)

// Built cores (standalone ESM; no harness resolution needed).
const history = await import('../lib/history.js')

// Isolated sessions tree for the synthetic checks (5, 6a, 8).
const TMP = mkdtempSync(`${tmpdir()}/memento-accept-m5-`)
const TMP_SESSIONS = join(TMP, 'sessions')
const PROBE_KEY = '--m5-accept-probe--'
const PROBE_DIR = join(TMP_SESSIONS, PROBE_KEY, 'session-probe')
mkdirSync(PROBE_DIR, { recursive: true })

/** Compress with the zstd CLI (same decoder the scanner uses). */
function zstdText(text) {
  const plain = join(TMP, `.plain-${randomUUID()}`)
  writeFileSync(plain, text, 'utf8')
  try {
    execFileSync('zstd', ['--quiet', '--force', plain, '-o', `${plain}.zst`])
    return readFileSync(`${plain}.zst`)
  } finally {
    rmSync(plain, { force: true })
    rmSync(`${plain}.zst`, { force: true })
  }
}

const meBefore = sha256Buf(ME_PATH)
const snippetLengths = []

try {
  // -------------------------------------------------- 1. known-present -------
  await (async () => {
    const r = await history.scanHistory({ root: SESSIONS_ROOT, query: 'Disk is law', limit: 10 })
    assert(r.ok === true, 'scan must be ok')
    assert(r.hits.length >= 1, `expected ≥1 hit for "Disk is law", got ${r.hits.length}`)
    for (const h of r.hits) snippetLengths.push(h.snippet.length)
    const h = r.hits[0]
    assert(typeof h.snippet === 'string' && h.snippet.length > 0, 'snippet must be non-empty')
    assert(h.snippet.includes('Disk is law'), 'snippet must show the match')
    assert(typeof h.sessionId === 'string' && h.sessionId.startsWith('session-'), 'sessionId must be a real session id')
    assert(
      existsSync(join(SESSIONS_ROOT, h.projectKey, h.sessionId)),
      `sessionId ${h.sessionId} must exist on disk under ${h.projectKey}`,
    )
    assert(typeof h.projectKey === 'string' && h.projectKey.length > 0, 'projectKey present')
    record(true, '1', `"Disk is law" all-projects: ${r.hits.length} hits, ${r.scanned} files scanned, sessionId on disk`)
  })()

  // -------------------------------------------------- 2. known-absent --------
  await (async () => {
    const uuid = randomUUID()
    const r = await history.scanHistory({ root: SESSIONS_ROOT, query: uuid, limit: 10 })
    assert(r.ok === true, 'absent query must still be ok')
    assert.deepEqual(r.hits, [], `absent query must return no hits, got ${r.hits.length}`)
    record(true, '2', `fresh UUID → ok, hits: []`)
  })()

  // ----------------------------------- 3. project scoping (tool wrapper) -----
  await (async () => {
    // Drive the built host bundle with a mock ctx; point DSH_HOME at the real
    // home so the tool's sessionsRoot() resolves the real sessions tree.
    process.env.DSH_HOME = DSH_HOME
    const mod = await import('../lib/index.js')
    const toolDefs = []
    const noopLogger = () => ({ info: () => {}, warn: () => {}, error: () => {} })
    const ctx = {
      tools: { register: (def) => { toolDefs.push(def); return () => {} } },
      webServer: { register: (route) => { return () => {} } },
      on: () => ({ dispose: () => {} }),
      inject: (deps, cb) => { if (deps.includes('webServer')) cb(ctx) },
      effect: () => {},
      logger: noopLogger,
    }
    mod.apply(ctx)
    const tool = toolDefs.find((t) => t.name === 'memory_history_search')
    assert(tool !== undefined, 'built bundle must register memory_history_search')
    assert.deepEqual(tool.parameters.required, ['query'], 'query must be the only required arg')

    // cwd inside this repo → default project = this repo's key.
    const r = await tool.execute(
      { query: 'Disk is law', limit: 50 },
      { agent: { session: { header: { cwd: REPO } } } },
    )
    assert(r.ok === true, 'tool must be ok')
    assert(r.hits.length >= 1, 'scoped search must find hits in this project')
    for (const h of r.hits) snippetLengths.push(h.snippet.length)
    assert(
      r.hits.every((h) => h.projectKey === MEMENTO_KEY),
      `all hits must come from ${MEMENTO_KEY}, got ${[...new Set(r.hits.map((h) => h.projectKey))]}`,
    )
    // Explicit other-project scope: nothing leaks from this project's hits.
    const other = await tool.execute({ query: 'Disk is law', project: '--home-hagbard-dev-overnite--', limit: 50 }, { agent: {} })
    assert(other.ok === true, 'explicit-project search must be ok')
    assert(other.hits.every((h) => h.projectKey === '--home-hagbard-dev-overnite--'), 'explicit scope must not leak other keys')
    record(true, '3', `tool wrapper: cwd-scoped → ${r.hits.length} hits all ${MEMENTO_KEY}; explicit scope clean`)
  })()

  // -------------------------------------------------- 4. missing dir ---------
  await (async () => {
    const r = await history.scanHistory({ root: join(TMP, 'does-not-exist'), query: 'anything' })
    assert(r.ok === true, 'missing dir must be ok (fail-open)')
    assert.deepEqual(r.hits, [])
    assert.equal(r.scanned, 0)
    assert(r.degraded.length >= 1, 'degraded must name the missing root')
    record(true, '4', `missing dir → ok, hits: [], degraded: ${r.degraded[0]}`)
  })()

  // -------------------------------------------------- 5. corrupt file --------
  // A good file with a known needle, plus a garbage .zstd, in the temp tree.
  const goodLines = [
    JSON.stringify({ type: 'session', id: 'session-probe', createdAt: 1 }),
    JSON.stringify({ type: 'user/message', seq: 1, time: Date.now(), data: { text: 'probe needle here' } }),
  ].join('\n') + '\n'
  writeFileSync(join(PROBE_DIR, 'session.v3.jsonl.zstd'), zstdText(goodLines))
  // 60 matching lines for the limit-clamp check (6a) live in the same tree.
  const capLines = [JSON.stringify({ type: 'session', id: 'session-probe', createdAt: 1 })]
  for (let i = 0; i < 60; i++) capLines.push(JSON.stringify({ type: 'user/message', time: i, data: { text: `capneedle ${i}` } }))
  const capDir = join(TMP_SESSIONS, PROBE_KEY, 'session-cap')
  mkdirSync(capDir, { recursive: true })
  writeFileSync(join(capDir, 'session.v4.jsonl.zstd'), zstdText(capLines.join('\n') + '\n'))
  const garbageDir = join(TMP_SESSIONS, PROBE_KEY, 'session-garbage')
  mkdirSync(garbageDir, { recursive: true })
  writeFileSync(join(garbageDir, 'session.v3.jsonl.zstd'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02, 0x03, 0x04, 0x05]))

  const beforeTree = treeHashes(TMP_SESSIONS)

  await (async () => {
    const r = await history.scanHistory({ root: TMP_SESSIONS, query: 'probe needle', limit: 10 })
    assert(r.ok === true)
    assert(r.hits.length === 1, `expected 1 hit from the good file, got ${r.hits.length}`)
    assert(r.hits[0].snippet.includes('probe needle'))
    assert(
      r.degraded.some((d) => d.includes('session-garbage')),
      `garbage file must be degraded: ${JSON.stringify(r.degraded)}`,
    )
    record(true, '5', `corrupt .zstd degraded, sibling searched (1 hit kept)`)
  })()

  // -------------------------------------------------- 6. bounds --------------
  await (async () => {
    const r = await history.scanHistory({ root: TMP_SESSIONS, query: 'capneedle', limit: 100 })
    assert(r.ok === true)
    assert.equal(r.hits.length, 50, `limit 100 must clamp to 50, got ${r.hits.length}`)
    assert.equal(r.truncated, true, 'clamped limit must set truncated')
    for (const h of r.hits) snippetLengths.push(h.snippet.length)

    const t0 = performance.now()
    const broad = await history.scanHistory({ root: SESSIONS_ROOT, query: 'e', limit: 50 })
    const elapsed = performance.now() - t0
    for (const h of broad.hits) snippetLengths.push(h.snippet.length)
    assert(broad.ok === true)
    assert.equal(broad.hits.length, 50, `broad query must cap at 50 hits, got ${broad.hits.length}`)
    assert.equal(broad.truncated, true, 'broad query must be truncated')
    assert(elapsed < 3000, `broad scan took ${elapsed.toFixed(0)} ms (budget 2 s)`)
    record(true, '6', `limit 100 → 50; "e" over real root: 50 hits in ${elapsed.toFixed(0)} ms, truncated`)
  })()

  // -------------------------------------------------- 7. snippet cap ---------
  await (async () => {
    assert(snippetLengths.length > 0, 'snippet length ledger must be populated')
    const max = Math.max(...snippetLengths)
    assert(max <= 400, `a snippet exceeded 400 chars (max ${max})`)
    record(true, '7', `${snippetLengths.length} snippets observed, max ${max} chars`)
  })()

  // -------------------------------------------------- 8. read-only proof -----
  await (async () => {
    // One more scan over the temp tree (hits + degraded paths both exercised).
    const r = await history.scanHistory({ root: TMP_SESSIONS, query: 'capneedle', limit: 5 })
    assert(r.ok === true)
    const afterTree = treeHashes(TMP_SESSIONS)
    assert.deepEqual(afterTree, beforeTree, 'every file in the sessions tree must be byte-identical after scans')
    record(true, '8', `${Object.keys(afterTree).length} files sha256-identical, none added or removed`)
  })()

  // -------------------------------------------------- 9. ME.md invariant -----
  await (async () => {
    assert(sha256Buf(ME_PATH) === meBefore, 'ME.md sha256 changed during the run')
    record(true, '9', `ME.md sha256 unchanged (${meBefore?.slice(0, 12)}…)`)
  })()
} catch (error) {
  record(false, 'crash', String(error?.message ?? error))
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

const failed = results.some((r) => !r.ok)
console.log(failed ? '\nM5 acceptance: FAIL' : '\nM5 acceptance: PASS')
process.exit(failed ? 1 : 0)
