/**
 * M1 acceptance for dsh-memento (vault + session-start inject).
 *
 * Run from the repo root:  node agent/accept-m1.mjs
 *
 * Checks (plan/M1-vault-inject.md):
 *   1. Fresh-vault bootstrap — ME.md created from template (< 30 lines);
 *      re-run → bytes unchanged (idempotent, never overwrites).
 *   2. Cap report — 40-line ME.md → state.me.overCap true, lines 40,
 *      file untouched by the plugin (via GET :3090/api/dsh-memento/state).
 *   3. cwd key — projectKey matches real session dirs under ~/.dsh/sessions.
 *   4. Sentinel-in-log — sentinel appended to ME.md, one real headless turn,
 *      sentinel present in exactly one dsh-memento user/message event in the
 *      session .zstd log.
 *   5. Cache stability — ≥3 steps, the block appears exactly once (not
 *      per-step), byte-identical to the vault block, positioned after the
 *      first user message and before the first assistant message.
 *   6. Fail-open — vault dir chmod 000 → state ok:true exists:false, a turn
 *      still completes with no injected event; recovery after chmod restore.
 *
 * Environment: real DSH_HOME (~/.dsh) unless overridden. A pre-existing
 * ~/.dsh/memory vault is moved aside for the duration and restored (or kept
 * as a backup on failure). Exits 0 only when every check passes.
 *
 * :3090 is HUMAN-OWNED. Start it once with `./agent/boot-3090.sh`. This script
 * reuses a healthy server (GET /api/dsh-memento/health). It does NOT kill or
 * respawn dsh — spawning from inside a dsh agent session inherits DSH_* env
 * and breaks the launcher (unknown option / wrong profile). Override port with
 * MEMENTO_ACCEPT_PORT.
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync, existsSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')
const HOME = process.env.DSH_HOME || join(process.env.HOME, '.dsh')
const MEMORY_DIR = join(HOME, 'memory')
const ME_PATH = join(MEMORY_DIR, 'ME.md')
const TEMPLATE = readFileSync(join(REPO, 'assets/ME.template.md'), 'utf8')
const SESSIONS_HOME = join(HOME, 'sessions')
const PORT = Number(process.env.MEMENTO_ACCEPT_PORT || 3090)
const BASE = `http://127.0.0.1:${PORT}`
const LLAMA = 'http://127.0.0.1:8080'
const ZSTD = 'zstd'

const results = []
async function check(id, label, fn) {
  try {
    const note = (await fn()) ?? ''
    results.push({ id, label, ok: true, note })
    console.log(`  PASS  ${id} ${label}${note ? `  (${note})` : ''}`)
  } catch (err) {
    results.push({ id, label, ok: false, note: String(err && err.message || err) })
    console.error(`  FAIL  ${id} ${label}\n        ${String(err && err.stack || err).split('\n').slice(0, 5).join('\n        ')}`)
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${JSON.stringify(a)}${a === b ? '' : `, want ${JSON.stringify(b)}`})`)

/** Load .env.local exports (no echo). Strips surrounding quotes. */
function envFromDotEnvLocal() {
  const env = {}
  try {
    for (const line of readFileSync(join(REPO, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^export\s+([A-Z0-9_]+)=(.+)$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      env[m[1]] = v
    }
  } catch { /* optional */ }
  return env
}

/** The newest session.v*.jsonl.zstd in a session dir. */
function sessionLog(sessionDir) {
  const files = readdirSync(sessionDir).filter(f => /^session\.v\d+\.jsonl\.zstd$/.test(f))
    .map(f => [f, statSync(join(sessionDir, f)).mtimeMs]).sort((a, b) => b[1] - a[1])
  if (files.length === 0) throw new Error(`no session.v*.jsonl.zstd in ${sessionDir}`)
  return join(sessionDir, files[0][0])
}

/** Decompress + parse a .zstd JSONL session log. */
function readLog(logPath) {
  const out = spawnSync(ZSTD, ['-dc', logPath], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  if (out.status !== 0) throw new Error(`zstd failed on ${logPath}: ${out.stderr?.slice(0, 200)}`)
  const events = out.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  if (events.length === 0) throw new Error(`empty session log ${logPath}`)
  return events
}

/** GET a JSON route. Retries transient network failures (the shared host can
 *  stall the server briefly while a model turn is in flight); HTTP error
 *  statuses are returned as-is, not retried. */
async function httpJson(path, timeoutMs = 30_000, attempts = 5) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
      const body = await res.text()
      let json
      try { json = JSON.parse(body) } catch { json = body }
      return { status: res.status, json }
    } catch (err) {
      lastErr = err
      await new Promise(r => setTimeout(r, 1_500))
    }
  }
  throw lastErr
}

/** Wait until the health route answers with the expected payload. */
async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let last = 'no response yet'
  while (Date.now() < deadline) {
    try {
      const { status, json } = await httpJson('/api/dsh-memento/health')
      last = `HTTP ${status}: ${JSON.stringify(json).slice(0, 120)}`
      if (status === 200 && json?.ok === true && json?.plugin === 'dsh-memento') return json
    } catch (err) { last = err.message }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(
    `acceptance host not healthy on ${BASE}: ${last}. ` +
    `Human must boot it once: ./agent/boot-3090.sh (do not spawn dsh from this script)`,
  )
}

/** Env for headless child turns: .env.local + strip only the session-binding
 *  vars (same trio as agent/boot-3090.sh). Profile vars MUST stay — dropping
 *  them makes the launcher mis-resolve `dsh headless` (empty stdout). Never
 *  leak LLAMA_API_KEY (llama-server maps that name to --api-key). */
function standaloneEnv() {
  const env = { ...process.env, ...envFromDotEnvLocal() }
  for (const v of ['DSH_WEB_URL', 'DSH_SHELL', 'DSH_SESSION_ID', 'LLAMA_API_KEY', 'LLAMA_API_KEY_FILE']) {
    delete env[v]
  }
  return env
}

function runHeadless(task) {
  const out = spawnSync('dsh', ['headless', task], {
    cwd: REPO, env: standaloneEnv(), encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
  })
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' }
}

const REPO_KEY = null // filled after build (below)
let SESSIONS_DIR = null

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------
console.log('dsh-memento M1 acceptance')
console.log(`  repo=${REPO}`)
console.log(`  HOME=${HOME}`)
console.log(`  port=${PORT}`)

// Build if stale so acceptance always exercises the current source.
const srcTimes = [
  join(REPO, 'src/host/index.ts'), join(REPO, 'src/host/vault.ts'), join(REPO, 'src/host/inject.ts'),
  join(REPO, 'src/shared/types.ts'), join(REPO, 'assets/ME.template.md'), join(REPO, 'build.mjs'),
].map(f => statSync(f).mtimeMs)
const lib = join(REPO, 'lib/index.js')
if (!existsSync(lib) || Math.max(...srcTimes) > statSync(lib).mtimeMs) {
  console.log('  building (stale or missing lib)…')
  const b = spawnSync('node', [join(REPO, 'build.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 120_000 })
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(1) }
}
// Import after the build so lib/ is guaranteed present and current.
const vault = await import('../lib/vault.js')
SESSIONS_DIR = join(SESSIONS_HOME, vault.projectKey(REPO))

// Local model must be up for the real turns.
{
  const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${LLAMA}/v1/models`], { encoding: 'utf8' })
  if (r.stdout?.trim() !== '200') {
    console.error(`precondition failed: local llama at ${LLAMA}/v1/models did not answer 200 (got ${r.stdout?.trim()})`)
    process.exit(1)
  }
}

// Move an existing vault aside so the fresh-bootstrap check is meaningful.
let vaultBackup = null
if (existsSync(MEMORY_DIR)) {
  vaultBackup = join(tmpdir(), `memento-vault-backup-${randomUUID()}`)
  renameSync(MEMORY_DIR, vaultBackup)
  console.log(`  existing vault moved aside → ${vaultBackup}`)
}

let failed = false
const turn1 = {}
try {
  // Human-owned :3090 must already be up (boot-3090.sh). Never kill/respawn.
  {
    const health = await waitForHealth(15_000)
    console.log(`  reuse :${PORT}  milestone=${health.milestone ?? '?'} version=${health.version ?? '?'}`)
  }

  // ---------------------------------------------------------------- check 1
  await check('1', 'fresh-vault bootstrap from template, idempotent', () => {
    const first = vault.bootstrapVault(HOME, TEMPLATE)
    eq(first.created, true, 'first bootstrap created')
    const bytes1 = readFileSync(first.mePath)
    const lines1 = bytes1.toString('utf8').split('\n').filter(l => l.length > 0).length
    assert(lines1 < 30, `template under 30 lines (got ${lines1})`)
    const second = vault.bootstrapVault(HOME, TEMPLATE)
    eq(second.created, false, 'second bootstrap no-op')
    assert(bytes1.equals(readFileSync(first.mePath)), 'ME.md bytes unchanged by second bootstrap')
    // Pre-existing hand-edited ME.md is never rewritten.
    writeFileSync(first.mePath, 'HAND EDITED\n')
    vault.bootstrapVault(HOME, TEMPLATE)
    eq(readFileSync(first.mePath, 'utf8'), 'HAND EDITED\n', 'hand-edited ME.md untouched')
    // Restore the template for later checks.
    writeFileSync(first.mePath, TEMPLATE)
    return `${lines1}-line template`
  })

  // ---------------------------------------------------------------- check 3
  await check('3', 'cwd key derivation matches real session dirs', () => {
    // The key encoding is intentionally ambiguous for hyphenated path
    // segments (a key cannot be inverted reliably), so verify forward: for
    // real existing directories, projectKey(dir) must name a session dir
    // that DSH itself created.
    const roots = [join(process.env.HOME, 'dev'), process.env.HOME, '/tmp']
    const realDirs = new Set([REPO])
    for (const root of roots) {
      try {
        for (const d of readdirSync(root, { withFileTypes: true })) {
          if (d.isDirectory()) realDirs.add(join(root, d.name))
        }
      } catch { /* root absent */ }
    }
    let matched = 0
    const examples = []
    for (const dir of realDirs) {
      const k = vault.projectKey(dir)
      if (existsSync(join(SESSIONS_HOME, k))) {
        matched++
        if (examples.length < 3) examples.push(`${dir} → ${k}`)
      }
    }
    assert(matched >= 3, `at least 3 real dirs whose key names an existing session dir (got ${matched})`)
    assert(existsSync(SESSIONS_DIR), `this project's session dir ${SESSIONS_DIR} exists`)
    return `${matched} dirs matched: ${examples.join(', ')}`
  })

  // ----------------------------------------------------------- checks 4+5
  const SENTINEL = `SENTINEL-M1-${randomUUID().replace(/-/g, '').slice(0, 12)}`
  await check('4', 'sentinel-in-log: injected block reached the session log', () => {
    const me = readFileSync(ME_PATH, 'utf8')
    writeFileSync(ME_PATH, me.endsWith('\n') ? `${me}${SENTINEL}\n` : `${me}\n${SENTINEL}\n`)
    const before = new Set(sessionDirs())
    // Three read-tool steps (not bash): this host has no usable sandbox
    // backend (AppArmor blocks bwrap user namespaces), and headless turns
    // have no approval channel, so bash calls are refused. read/glob/grep
    // steps need no sandbox and give the ≥3-step session check 5 requires.
    turn1.run = runHeadless(
      'Using the read tool, read these three files in this order: ' +
      'first assets/ME.template.md, then plan/M1-vault-inject.md, then src/host/vault.ts. ' +
      'After the third read succeeds, reply with exactly one word: done',
    )
    eq(turn1.run.code, 0, `headless turn exit code (stderr: ${turn1.run.stderr?.split('\n').slice(0, 3).join(' | ')})`)
    assert(/done/i.test(turn1.run.stdout), `turn replied done (stdout: ${JSON.stringify(turn1.run.stdout?.slice(0, 120))})`)
    const fresh = sessionDirs().filter(d => !before.has(d))
    eq(fresh.length, 1, 'exactly one new session dir')
    turn1.sessionDir = join(SESSIONS_DIR, fresh[0])
    turn1.logPath = sessionLog(turn1.sessionDir)
    turn1.events = readLog(turn1.logPath)
    turn1.meText = readFileSync(ME_PATH, 'utf8')
    const injected = turn1.events.filter(e =>
      e.type === 'user/message' && e.data?.source?.kind === 'dsh-memento',
    )
    eq(injected.length, 1, 'exactly one dsh-memento user/message event')
    const text = (injected[0].data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('')
    assert(text.includes(SENTINEL), `injected text contains ${SENTINEL}`)
    return `seq ${injected[0].seq}, ${text.length} chars`
  })
  await check('5', 'cache stability: single byte-identical block across ≥3 steps', () => {
    const events = turn1.events
    assert(events, 'check 4 must pass first')
    const steps = events.filter(e => e.type === 'step/start').length
    assert(steps >= 3, `session has ≥3 steps (got ${steps})`)
    const injected = events.filter(e =>
      e.type === 'user/message' && e.data?.source?.kind === 'dsh-memento',
    )
    eq(injected.length, 1, 'not re-injected per step (still exactly one event)')
    const text = (injected[0].data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('')
    eq(text, turn1.meText, 'block bytes identical to the vault ME.md content')
    const firstUserSeq = events.find(e => e.type === 'user/message' && e.data?.source?.kind === 'user')?.seq
    const firstAssistantSeq = events.find(e => e.type === 'assistant/message')?.seq
    assert(firstUserSeq !== undefined, 'first user message present')
    assert(firstAssistantSeq !== undefined, 'first assistant message present')
    assert(injected[0].seq > firstUserSeq, `injection after first user message (seq ${injected[0].seq} > ${firstUserSeq})`)
    assert(injected[0].seq < firstAssistantSeq, `injection before first assistant message (seq ${injected[0].seq} < ${firstAssistantSeq})`)
    return `${steps} steps, seq ${injected[0].seq} between user(${firstUserSeq}) and assistant(${firstAssistantSeq})`
  })

  // -------------------------------------------------------- check 2 (state)
  await check('2', 'cap report via GET /api/dsh-memento/state', async () => {
    // Reuse human-owned :3090 — never killPort / spawn from inside an agent.
    const health = await waitForHealth(5_000)
    eq(health.milestone, 'M1', 'health milestone is M1')
    // 40-line ME.md → overCap.
    const body = Array.from({ length: 40 }, (_, i) => `- cap-test line ${i + 1}`).join('\n') + '\n'
    writeFileSync(ME_PATH, body)
    const { status, json } = await httpJson('/api/dsh-memento/state')
    eq(status, 200, 'state route 200')
    eq(json.ok, true, 'state ok')
    eq(json.me?.exists, true, 'me exists')
    eq(json.me?.lines, 40, 'me lines')
    eq(json.me?.cap, 30, 'me cap')
    eq(json.me?.overCap, true, 'me overCap')
    eq(json.project?.key, vault.projectKey(REPO), 'project key')
    eq(json.project?.exists, false, 'project MEMORY.md absent')
    eq(json.inject?.budget, 4000, 'inject budget')
    eq(json.inject?.chars, body.length, 'inject chars = ME.md length')
    eq(json.inject?.truncated, false, 'inject not truncated under budget')
    // The plugin never rewrites what it reads.
    eq(readFileSync(ME_PATH, 'utf8'), body, '40-line ME.md untouched by the state read')
    return `me.lines=40 cap=30 overCap=true, project=${vault.projectKey(REPO)}`
  })

  // -------------------------------------------------------- check 6 (fail)
  await check('6', 'fail-open: unreadable vault degrades, turns still complete', async () => {
    chmodSync(MEMORY_DIR, 0o000)
    try {
      const { status, json } = await httpJson('/api/dsh-memento/state')
      eq(status, 200, 'state route still 200')
      eq(json.ok, true, 'state ok (fail-open)')
      eq(json.me?.exists, false, 'me exists:false')
      eq(json.project?.exists, false, 'project exists:false')
      eq(json.inject?.chars, 0, 'nothing injected')
      const before = new Set(sessionDirs())
      const turn2 = runHeadless('Reply with exactly one word: done')
      eq(turn2.code, 0, `turn completed with unreadable vault (stderr: ${turn2.stderr?.split('\n').slice(0, 3).join(' | ')})`)
      assert(/done/i.test(turn2.stdout), 'turn replied done')
      const fresh = sessionDirs().filter(d => !before.has(d))
      eq(fresh.length, 1, 'second turn produced exactly one session')
      const events = readLog(sessionLog(join(SESSIONS_DIR, fresh[0])))
      const injected = events.filter(e =>
        e.type === 'user/message' && e.data?.source?.kind === 'dsh-memento',
      )
      eq(injected.length, 0, 'no injection while vault unreadable')
    } finally {
      chmodSync(MEMORY_DIR, 0o755)
    }
    const { json } = await httpJson('/api/dsh-memento/state')
    eq(json.me?.exists, true, 'recovered after chmod restore')
    return 'state fail-open + clean turn + recovery'
  })
} catch (err) {
  console.error(`acceptance crashed: ${err && err.stack || err}`)
}
// Determine pass/fail BEFORE teardown: on failure the prior vault backup is
// kept (not deleted) so the real ~/.dsh/memory can be restored by hand.
failed = results.some(r => !r.ok)

function sessionDirs() {
  try { return readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) }
  catch { return [] }
}

// ---------------------------------------------------------------------------
// Teardown / final state  (:3090 is human-owned — never kill it)
// ---------------------------------------------------------------------------
// Leave a clean vault: template ME.md only (drop sentinel + cap-test lines).
if (existsSync(ME_PATH)) writeFileSync(ME_PATH, TEMPLATE)
if (vaultBackup !== null) {
  if (failed) {
    console.error(`FAILED — pre-existing vault kept at ${vaultBackup}`)
  } else if (existsSync(join(vaultBackup, 'ME.md')) && readFileSync(join(vaultBackup, 'ME.md'), 'utf8') !== TEMPLATE) {
    rmSync(MEMORY_DIR, { recursive: true, force: true })
    renameSync(vaultBackup, MEMORY_DIR)
    console.log(`  prior vault restored from ${vaultBackup}`)
  } else {
    rmSync(vaultBackup, { recursive: true, force: true })
  }
}

console.log(failed ? '\nM1 acceptance: FAIL' : '\nM1 acceptance: PASS')
process.exit(failed ? 1 : 0)
