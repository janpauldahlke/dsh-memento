/**
 * M2 acceptance for dsh-memento (inbox write + Undo).
 *
 * Reuses the human-owned acceptance server on :3090 — this script NEVER
 * spawns, kills, or restarts any dsh process (plan/PROTOCOL.md "Sacred").
 * M2 needs no model turns: every check is an HTTP call, a file assertion, or
 * a pure function call against the built inbox core.
 *
 * Checks (plan/M2-inbox-write.md):
 *   1. POST /capture → inbox.md gains exactly one line, format regex,
 *      parseable ISO timestamp, correct cwd key.
 *   2. POST /undo → inbox.md byte-identical (sha256) to the pre-capture
 *      snapshot.
 *   3. Second /undo → { ok: true, undone: false }, file still unchanged.
 *   4. Multi-line input → exactly one line written, no embedded \n.
 *   5. Trigger unit tests: `Remember: x` / `remember this: x` match;
 *      `please remember: x` and `I will remember` do not.
 *   6. ME.md sha256 unchanged across the entire run (mandatory).
 *   7. 200 sequential captures → 200 lines, no corruption/truncation, and
 *      state.inject.chars unchanged (the inbox is never injected).
 *
 * If :3090 answers with a stale bundle (pre-M2), the script exits 2 with a
 * restart instruction — the host bundle is loaded once per server start and
 * the human restarts :3090 with ./agent/boot-3090.sh (never an agent).
 *
 * Exit: 0 = all checks pass, 1 = a check failed, 2 = stale bundle / :3090
 * unreachable.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { detectTrigger } from '../lib/inbox.js'

const BASE = 'http://127.0.0.1:3090'
const PORT = 3090
const REPO = process.cwd()
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const MEMORY_DIR = join(DSH_HOME, 'memory')
const ME_PATH = join(MEMORY_DIR, 'ME.md')
const INBOX_PATH = join(MEMORY_DIR, 'inbox.md')
const EXPECTED_KEY = '--home-hagbard-dev-dsh-memento--'

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

/** Read the inbox as bytes; absent file → empty buffer (pre-existing state). */
function inboxBytes() {
  return existsSync(INBOX_PATH) ? readFileSync(INBOX_PATH) : Buffer.alloc(0)
}
/** Inbox line count (non-empty lines). */
function inboxLineCount() {
  return inboxBytes().toString('utf8').split('\n').filter((l) => l.length > 0).length
}

async function httpJson(path, { method = 'GET', body } = {}) {
  // Transient retries: the shared host can briefly stall the server's event
  // loop (model turns elsewhere) — same policy as accept-m1.
  let lastError
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
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

// ---------------------------------------------------------------------------
console.log('dsh-memento M2 acceptance')
console.log(`  repo=${REPO}`)
console.log(`  HOME=${DSH_HOME}`)
console.log(`  port=${PORT}`)

// Check :3090 is up and running the M2 bundle (stale → actionable exit 2).
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
// Stale check: the bundle must include M2 (its own milestone or a later one —
// a later bundle still carries the M2 routes, which is what the checks below
// actually verify).
const milestoneNum = (m) => Number(String(m ?? '').replace(/\D/g, ''))
if (milestoneNum(health.milestone) < 2) {
  console.error(`stale bundle on :3090 (milestone=${health.milestone}, version=${health.version}) — the M2 build is not loaded.`)
  console.error('Host bundles load once per server start; the agent must not restart dsh.')
  console.error('Human action: ./agent/boot-3090.sh (cwd = this repo), then re-run node agent/accept-m2.mjs')
  process.exit(2)
}
console.log(`  :3090 milestone=${health.milestone} version=${health.version}`)

const meShaBefore = sha256File(ME_PATH)
assert(meShaBefore !== null, 'ME.md missing — the M1 vault bootstrap should have created it')

try {
  // ------------------------------------------- check 5 (pure, run early) ---
  await (async () => {
    assert(detectTrigger('Remember: x') === 'x', 'Remember: x must match')
    assert(detectTrigger('remember this: x') === 'x', 'remember this: x must match (case-insensitive)')
    assert(detectTrigger('please remember: x') === null, 'mid-sentence remember must not match')
    assert(detectTrigger('I will remember') === null, 'no colon, not at start — no match')
    record(true, '5', 'trigger: Remember:/remember this: match; please remember: and I will remember do not')
  })()

  // ------------------------------------------------------- check 1 (fail) ---
  await (async () => {
    const preBytes = inboxBytes()
    const preCount = inboxLineCount()
    const payload = 'acceptance note one'
    const { status, json } = await httpJson('/api/dsh-memento/capture', { method: 'POST', body: { text: payload } })
    assert(status === 200 && json?.ok === true && json?.captured === true, `capture rejected (status ${status}: ${json?.error ?? json})`)
    const line = json.line
    assert(typeof line === 'string' && line.length > 0, 'no line returned')
    // Exactly one new line, matching the format.
    const text = inboxBytes().toString('utf8')
    assert(text === preBytes.toString('utf8') + line + '\n', 'file did not gain exactly one line at the end')
    assert(inboxLineCount() === preCount + 1, 'line count off by more than one')
    const ENTRY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \[--[A-Za-z0-9._-]+--\] \S[\s\S]*$/
    assert(ENTRY.test(line), `line fails format regex: ${line}`)
    const [ts, keyPart] = [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf('['), line.indexOf(']') + 1)]
    const date = new Date(ts)
    assert(!Number.isNaN(date.getTime()), `timestamp not parseable: ${ts}`)
    assert(Math.abs(Date.now() - date.getTime()) < 10 * 60 * 1000, `timestamp not near now: ${ts}`)
    assert(keyPart === `[${EXPECTED_KEY}]`, `wrong cwd key: ${keyPart} (expected [${EXPECTED_KEY}])`)
    assert(line.endsWith(payload), `payload missing from line: ${line}`)
    // Leave the file as found: undo this entry.
    const undone = await httpJson('/api/dsh-memento/undo', { method: 'POST' })
    assert(undone.status === 200 && undone.json?.ok === true && undone.json?.undone === true, 'cleanup undo failed')
    assert(sha256(inboxBytes()) === sha256(preBytes), 'cleanup undo did not restore bytes')
    record(true, '1', `one formatted line, key ${keyPart}, ISO ts parseable`)
  })()

  // ------------------------------------------------------- check 2 (fail) ---
  await (async () => {
    const preBytes = inboxBytes()
    const preSha = sha256(preBytes)
    const { json } = await httpJson('/api/dsh-memento/capture', { method: 'POST', body: { text: 'byte-identity probe' } })
    assert(json?.ok === true, 'capture rejected')
    assert(sha256(inboxBytes()) !== preSha, 'capture did not change the file')
    const { json: undo } = await httpJson('/api/dsh-memento/undo', { method: 'POST' })
    assert(undo?.ok === true && undo?.undone === true, 'undo did not report an entry')
    assert(sha256(inboxBytes()) === preSha, 'file not byte-identical after undo')
    record(true, '2', 'undo restored the exact pre-capture bytes (sha256)')
  })()

  // ------------------------------------------------------- check 3 (fail) ---
  await (async () => {
    const preSha = sha256(inboxBytes())
    const { json } = await httpJson('/api/dsh-memento/undo', { method: 'POST' })
    assert(json?.ok === true, 'second undo not ok')
    assert(json?.undone === false, 'second undo should report undone:false')
    assert(sha256(inboxBytes()) === preSha, 'file changed on no-op undo')
    record(true, '3', 'second undo → { ok: true, undone: false }, file untouched')
  })()

  // ------------------------------------------------------- check 4 (fail) ---
  await (async () => {
    const preBytes = inboxBytes()
    const preCount = inboxLineCount()
    const multi = 'line one\nline two\n\nline three'
    const { json } = await httpJson('/api/dsh-memento/capture', { method: 'POST', body: { text: multi } })
    assert(json?.ok === true, 'capture rejected')
    assert(inboxLineCount() === preCount + 1, 'multi-line input wrote more than one line')
    const line = json.line
    assert(!line.includes('\n'), 'written line contains an embedded newline')
    assert(line.endsWith('line one line two line three'), `collapsed payload wrong: ${line}`)
    const undone = await httpJson('/api/dsh-memento/undo', { method: 'POST' })
    assert(undone.json?.undone === true && sha256(inboxBytes()) === sha256(preBytes), 'cleanup undo failed')
    record(true, '4', 'multi-line input → exactly one line, no embedded \\n')
  })()

  // ------------------------------------------------------- check 7 (fail) ---
  await (async () => {
    const preBytes = inboxBytes()
    const preCount = inboxLineCount()
    const { json: stateBefore } = await httpJson('/api/dsh-memento/state')
    const charsBefore = stateBefore?.inject?.chars
    assert(typeof charsBefore === 'number', 'state.inject.chars missing before')
    for (let i = 1; i <= 200; i++) {
      const { status, json } = await httpJson('/api/dsh-memento/capture', { method: 'POST', body: { text: `seq ${i} of 200` } })
      if (status !== 200 || json?.ok !== true) throw new Error(`capture ${i} failed (status ${status})`)
    }
    const text = inboxBytes().toString('utf8')
    const lines = text.split('\n').filter((l) => l.length > 0)
    assert(lines.length === preCount + 200, `expected ${preCount + 200} lines, got ${lines.length}`)
    const added = lines.slice(preCount)
    const ENTRY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \[--[A-Za-z0-9._-]+--\] \S[\s\S]*$/
    for (let i = 0; i < 200; i++) {
      assert(ENTRY.test(added[i]), `added line ${i + 1} malformed: ${added[i]}`)
      assert(added[i].endsWith(`seq ${i + 1} of 200`), `added line ${i + 1} truncated or reordered: ${added[i]}`)
    }
    // Restore: undo all 200, verify byte-identical.
    for (let i = 0; i < 200; i++) {
      const { json } = await httpJson('/api/dsh-memento/undo', { method: 'POST' })
      assert(json?.undone === true, `undo ${i + 1} did not remove an entry`)
    }
    assert(sha256(inboxBytes()) === sha256(preBytes), 'file not restored after 200 undos')
    const { json: stateAfter } = await httpJson('/api/dsh-memento/state')
    assert(stateAfter?.inject?.chars === charsBefore, `state.inject.chars changed (${charsBefore} → ${stateAfter?.inject?.chars})`)
    record(true, '7', '200 captures → 200 intact lines, restore byte-identical, inject.chars unchanged')
  })()

  // ------------------------------------------------------- check 6 (fail) ---
  await (async () => {
    assert(sha256File(ME_PATH) === meShaBefore, 'ME.md sha256 changed across the run')
    record(true, '6', 'ME.md sha256 unchanged across the entire run')
  })()
} catch (error) {
  record(false, 'crash', String(error?.message ?? error))
}

const failed = results.some((r) => !r.ok)
console.log(failed ? '\nM2 acceptance: FAIL' : '\nM2 acceptance: PASS')
process.exit(failed ? 1 : 0)
