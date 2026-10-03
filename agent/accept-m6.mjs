/**
 * REVIEW-01 R2 acceptance: master on/off via `~/.dsh/memory/.off`.
 *
 * Reuses the human-owned acceptance server on :3090 — never spawns/kills dsh.
 *
 * Checks:
 *   (a) with `.off` present, a session start injects nothing (no dsh-memento
 *       user/message in the session log).
 *   (b) POST /capture → {ok:true, captured:false, reason:"disabled"} and
 *       inbox.md byte-unchanged.
 *   (c) no `.compliance.log` line appended on session end while disabled.
 *   (d) GET /state reports enabled:false.
 *   (e) removing `.off` restores capture + state.enabled without a restart.
 *
 * Exit: 0 = pass, 1 = fail, 2 = stale / :3090 unreachable.
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { offPath, setEnabled, isEnabled } from '../lib/enabled.js'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')
const BASE = 'http://127.0.0.1:3090'
const PORT = 3090
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const MEMORY_DIR = join(DSH_HOME, 'memory')
const ME_PATH = join(MEMORY_DIR, 'ME.md')
const INBOX_PATH = join(MEMORY_DIR, 'inbox.md')
const COMPLIANCE_LOG = join(MEMORY_DIR, '.compliance.log')
const OFF_PATH = offPath(DSH_HOME)
const SESSIONS_DIR = join(DSH_HOME, 'sessions', '--home-hagbard-dev-dsh-memento--')
const ZSTD = 'zstd'

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

async function httpJson(path, { method = 'GET', body } = {}) {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* non-JSON */ }
      return { status: res.status, json, text }
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
  throw new Error(`unreachable ${method} ${path}: ${lastError}`)
}

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

function sessionDirs() {
  try {
    return readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

function sessionLog(sessionDir) {
  const files = readdirSync(sessionDir)
    .filter((f) => /^session\.v\d+\.jsonl\.zstd$/.test(f))
    .map((f) => [f, statSync(join(sessionDir, f)).mtimeMs])
    .sort((a, b) => b[1] - a[1])
  if (files.length === 0) throw new Error(`no session log in ${sessionDir}`)
  return join(sessionDir, files[0][0])
}

function readLog(logPath) {
  const out = spawnSync(ZSTD, ['-dc', logPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (out.status !== 0) throw new Error(`zstd failed: ${out.stderr?.slice(0, 200)}`)
  return out.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

function complianceLineCount() {
  if (!existsSync(COMPLIANCE_LOG)) return 0
  return readFileSync(COMPLIANCE_LOG, 'utf8').split('\n').filter((l) => l.length > 0).length
}

console.log('dsh-memento M6 acceptance (REVIEW-01 R2 on/off)')
console.log(`  repo=${REPO}`)
console.log(`  HOME=${DSH_HOME}`)
console.log(`  port=${PORT}`)

let health
try {
  const { status, json } = await httpJson('/api/dsh-memento/health')
  health = json
  assert(status === 200 && health?.ok === true, `health not ok (status ${status})`)
} catch (error) {
  console.error(`:3090 unreachable: ${error}`)
  console.error('Human action: ./agent/boot-3090.sh (cwd = this repo), then re-run.')
  process.exit(2)
}
{
  const probe = await httpJson('/api/dsh-memento/state')
  if (probe.json?.enabled === undefined) {
    console.error(`stale bundle on :3090 (no state.enabled) — rebuild + ./agent/boot-3090.sh`)
    process.exit(2)
  }
}
console.log(`  :3090 milestone=${health.milestone} version=${health.version}`)

const meBefore = existsSync(ME_PATH) ? readFileSync(ME_PATH) : null
const inboxBefore = existsSync(INBOX_PATH) ? readFileSync(INBOX_PATH) : null
const offBefore = existsSync(OFF_PATH)
const SENTINEL = `SENTINEL-M6-${randomUUID().replace(/-/g, '').slice(0, 12)}`

try {
  // Ensure a distinctive ME.md so a wrongful inject would be visible.
  const meBase = meBefore ? meBefore.toString('utf8') : '# ME\n'
  writeFileSync(ME_PATH, meBase.endsWith('\n') ? `${meBase}${SENTINEL}\n` : `${meBase}\n${SENTINEL}\n`)

  // -------------------------------------------------------------- disable --
  setEnabled(DSH_HOME, false)
  assert(existsSync(OFF_PATH) && isEnabled(DSH_HOME) === false, '.off must be present')

  // (d) state.enabled
  await (async () => {
    const { status, json } = await httpJson('/api/dsh-memento/state')
    assert(status === 200 && json?.ok === true, 'state not ok')
    assert(json.enabled === false, `expected enabled:false, got ${json.enabled}`)
    record(true, 'd', 'GET /state reports enabled:false')
  })()

  // (b) capture refused, inbox unchanged
  await (async () => {
    const beforeSha = sha256File(INBOX_PATH)
    const { status, json } = await httpJson('/api/dsh-memento/capture', {
      method: 'POST',
      body: { text: 'should not land while disabled' },
    })
    assert(status === 200 && json?.ok === true, `capture status ${status}`)
    assert(json.captured === false && json.reason === 'disabled', `expected disabled capture, got ${JSON.stringify(json)}`)
    assert(sha256File(INBOX_PATH) === beforeSha, 'inbox.md must be byte-unchanged')
    record(true, 'b', 'POST /capture → captured:false reason:disabled; inbox unchanged')
  })()

  // (a) + (c): headless session while disabled — no inject, no compliance line
  await (async () => {
    const logLinesBefore = complianceLineCount()
    const before = new Set(sessionDirs())
    const turn = runHeadless('Reply with exactly one word: done')
    assert(turn.code === 0, `headless exit ${turn.code}: ${turn.stderr?.split('\n').slice(0, 3).join(' | ')}`)
    assert(/done/i.test(turn.stdout), `expected done, got ${JSON.stringify(turn.stdout.slice(0, 120))}`)
    const fresh = sessionDirs().filter((d) => !before.has(d))
    assert(fresh.length === 1, `expected exactly one new session dir, got ${fresh.length}`)
    const events = readLog(sessionLog(join(SESSIONS_DIR, fresh[0])))
    const injected = events.filter((e) =>
      e.type === 'user/message' && e.data?.source?.kind === 'dsh-memento',
    )
    assert(injected.length === 0, `expected no inject while disabled, got ${injected.length}`)
    const hasSentinel = events.some((e) => JSON.stringify(e).includes(SENTINEL))
    assert(!hasSentinel, 'sentinel must be absent from the session log while disabled')
    // Session end should have run; give the host a moment to flush dispose.
    await new Promise((r) => setTimeout(r, 500))
    const logLinesAfter = complianceLineCount()
    assert(logLinesAfter === logLinesBefore, `compliance log grew while disabled (${logLinesBefore} → ${logLinesAfter})`)
    record(true, 'a+c', 'no inject in session log; compliance log unchanged on session end')
  })()

  // (e) re-enable without restart
  await (async () => {
    setEnabled(DSH_HOME, true)
    assert(!existsSync(OFF_PATH) && isEnabled(DSH_HOME) === true, '.off must be gone')
    const { status, json } = await httpJson('/api/dsh-memento/state')
    assert(status === 200 && json.enabled === true, `expected enabled:true after rm .off, got ${json.enabled}`)
    const beforeSha = sha256File(INBOX_PATH)
    const cap = await httpJson('/api/dsh-memento/capture', {
      method: 'POST',
      body: { text: 'm6 re-enabled capture' },
    })
    assert(cap.status === 200 && cap.json?.captured === true, `capture after re-enable failed: ${JSON.stringify(cap.json)}`)
    assert(sha256File(INBOX_PATH) !== beforeSha, 'inbox must gain a line after re-enable')
    // Undo the probe line so we don't leave litter (best-effort).
    await httpJson('/api/dsh-memento/undo', { method: 'POST' })
    record(true, 'e', 'removing .off restores enabled + capture without restart')
  })()
} catch (error) {
  record(false, 'crash', String(error?.message ?? error))
} finally {
  // Restore prior on/off + ME.md + inbox.
  if (offBefore) setEnabled(DSH_HOME, false)
  else {
    try { unlinkSync(OFF_PATH) } catch { /* absent */ }
  }
  if (meBefore !== null) writeFileSync(ME_PATH, meBefore)
  if (inboxBefore !== null) writeFileSync(INBOX_PATH, inboxBefore)
}

const failed = results.some((r) => !r.ok)
console.log(failed ? '\nM6 acceptance: FAIL' : '\nM6 acceptance: PASS')
process.exit(failed ? 1 : 0)
