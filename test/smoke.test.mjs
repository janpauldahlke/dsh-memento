/**
 * Smoke test for the dsh-memento host bundle (lib/index.js) under a mock
 * harness context — validates the M4 wiring (exports, route table, tool
 * registration, pre-step listeners, route/tool behavior, the file-write and
 * inbox line-delete routes) without a server.
 * Run: node --test test/smoke.test.mjs
 *
 * The bundle is self-contained (all @deepseek-ai/* imports are type-only and
 * erased at build time), so plain `node --test` can import it. DSH_HOME is
 * pointed at a temp dir BEFORE the dynamic import because the bundle resolves
 * it once at module load.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'memento-smoke-'))
process.env.DSH_HOME = home
const INBOX = join(home, 'memory', 'inbox.md')

const mod = await import('../lib/index.js')

// ---------------------------------------------------------------- exports ---

test('bundle exports: name, inject seat, route constants', () => {
  assert.equal(mod.name, 'dsh-local-memento')
  assert.deepEqual(mod.inject, ['tools'])
  assert.equal(mod.HEALTH_ROUTE, '/api/dsh-memento/health')
  assert.equal(mod.STATE_ROUTE, '/api/dsh-memento/state')
  assert.equal(mod.CAPTURE_ROUTE, '/api/dsh-memento/capture')
  assert.equal(mod.UNDO_ROUTE, '/api/dsh-memento/undo')
  assert.equal(mod.COMPLIANCE_ROUTE, '/api/dsh-memento/compliance')
  assert.equal(mod.FILE_ROUTE, '/api/dsh-memento/file')
  assert.equal(mod.INBOX_DELETE_ROUTE, '/api/dsh-memento/inbox/line')
  assert.equal(mod.ENABLED_ROUTE, '/api/dsh-memento/enabled')
  assert.equal(typeof mod.apply, 'function')
})

// ------------------------------------------------------------- mock ctx ----

const noopLogger = () => ({ info: () => {}, warn: () => {}, error: () => {} })
const routes = []
const listeners = []
const effects = []
const toolDefs = []

const ctx = {
  tools: { register: (def) => { toolDefs.push(def); return () => {} } },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  on: (event, handler) => { listeners.push({ event, handler }); return { dispose: () => {} } },
  inject: (deps, cb) => { if (deps.includes('webServer')) cb(ctx) },
  effect: (fn, name) => { effects.push({ fn, name }) },
  logger: noopLogger,
}

test('apply: registers 8 routes, 2 tools, 2 pre-step + 2 session listeners, no throw', () => {
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.deepEqual(
    routes.map((r) => r.path),
    [
      '/api/dsh-memento/health',
      '/api/dsh-memento/state',
      '/api/dsh-memento/capture',
      '/api/dsh-memento/undo',
      '/api/dsh-memento/compliance',
      '/api/dsh-memento/file',
      '/api/dsh-memento/inbox/line',
      '/api/dsh-memento/enabled',
    ],
  )
  const lineDelete = routes.find((r) => r.path === '/api/dsh-memento/inbox/line')
  assert.equal(lineDelete.kind, 'prefix', 'line delete is a prefix route (line number in URL)')
  assert.equal(toolDefs.length, 2)
  assert.equal(toolDefs[0].name, 'memory_remember')
  assert.deepEqual(toolDefs[0].parameters.required, ['text'])
  assert.equal(toolDefs[0].parameters.properties.text.type, 'string')
  assert.deepEqual(toolDefs[0].output.schema.required, ['ok', 'captured'])
  assert.equal(toolDefs[1].name, 'memory_history_search')
  assert.deepEqual(toolDefs[1].parameters.required, ['query'])
  assert.equal(toolDefs[1].parameters.properties.query.type, 'string')
  assert.equal(toolDefs[1].parameters.properties.allProjects.type, 'boolean')
  assert.deepEqual(toolDefs[1].output.schema.required, ['ok', 'scanned', 'hits', 'truncated', 'degraded'])
  // Nullable hit fields must use oneOf — type arrays are rejected by dsh tools.
  const hitProps = toolDefs[1].output.schema.properties.hits.items.properties
  for (const key of ['sessionId', 'time', 'eventType']) {
    assert.ok(Array.isArray(hitProps[key].oneOf), `${key} must use oneOf for nullability`)
    assert.equal(hitProps[key].type, undefined, `${key} must not use a type array`)
  }
  assert.deepEqual(
    listeners.map((l) => l.event),
    ['agent/pre-step', 'agent/pre-step', 'session/created', 'session/event', 'session/disposed'],
  )
  assert.ok(effects.length >= 6, `expected at least 6 effects, got ${effects.length}`)
})

// ----------------------------------------------------------- route driver ---

function mockReq(method, body, url) {
  return {
    method,
    url,
    on(event, cb) {
      if (event === 'data' && body !== undefined) cb(Buffer.from(body))
      if (event === 'end') setImmediate(cb)
      // 'error' never fires in the mock
    },
  }
}
function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    done: false,
    writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers ?? {}) },
    end(chunk) { this.body = typeof chunk === 'string' ? chunk : ''; this.done = true },
  }
}
async function invoke(path, method = 'GET', body) {
  const [routePath, query] = path.split('?')
  // Exact route first; otherwise a prefix route whose registered path is a
  // path-segment prefix of the requested path (the line-delete route).
  const route =
    routes.find((r) => r.path === routePath) ??
    routes.find((r) => r.kind === 'prefix' && (routePath === r.path || routePath.startsWith(`${r.path}/`)))
  assert.ok(route, `route ${routePath} not registered`)
  const res = mockRes()
  route.handler(mockReq(method, body, query ? `/${routePath.slice(1)}?${query}` : `/${routePath.slice(1)}`), res)
  for (let i = 0; i < 200 && !res.done; i++) await new Promise((resolve) => setImmediate(resolve))
  assert.ok(res.done, `handler for ${path} did not finish`)
  return { status: res.statusCode, json: JSON.parse(res.body) }
}

const ENTRY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \[--[A-Za-z0-9._-]+--\] \S[\s\S]*$/

test('health route: 200 ok, milestone + version match the bundle exports', async () => {
  const { status, json } = await invoke('/api/dsh-memento/health')
  assert.equal(status, 200)
  // Health must report exactly the milestone/version the bundle exports.
  assert.equal(mod.MILESTONE, 'M5')
  assert.equal(mod.VERSION, '1.0.1')
  assert.deepEqual(json, { ok: true, plugin: 'dsh-local-memento', version: mod.VERSION, milestone: mod.MILESTONE })
  const wrong = await invoke('/api/dsh-memento/health', 'POST')
  assert.equal(wrong.status, 405)
})

test('state route: 200 ok, bootstrap seeded ME.md under the temp DSH_HOME, inbox tail field present', async () => {
  const { status, json } = await invoke('/api/dsh-memento/state')
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.enabled, true)
  assert.equal(json.me.exists, true)
  assert.equal(json.me.cap, 30)
  assert.equal(json.me.lines, 10)
  assert.equal(typeof json.me.text, 'string', 'me.text is exposed for the pane editor (M4)')
  assert.equal(typeof json.me.mtimeMs, 'number', 'me.mtimeMs for optimistic concurrency')
  assert.equal(json.inject.budget, 4000)
  assert.ok(json.inject.chars > 0)
  assert.equal(typeof json.inject.text, 'string', 'inject.text is the trust surface (R3)')
  assert.equal(json.inject.text.length, json.inject.chars)
  assert.ok(json.project.key.startsWith('--'), json.project.key)
  assert.equal(typeof json.project.cwd, 'string')
  assert.equal(typeof json.inbox.path, 'string')
  assert.equal(json.inbox.exists, false, 'fresh home: no inbox yet')
  assert.equal(json.inbox.total, 0)
  assert.deepEqual(json.inbox.lines, [])
})

test('capture route: JSON body → formatted line; plain text body also works', async () => {
  const { status, json } = await invoke('/api/dsh-memento/capture', 'POST', JSON.stringify({ text: 'smoke note' }))
  assert.equal(status, 200)
  assert.deepEqual({ ok: json.ok, captured: json.captured }, { ok: true, captured: true })
  assert.match(json.line, ENTRY)
  assert.ok(json.line.endsWith('smoke note'))

  const plain = await invoke('/api/dsh-memento/capture', 'POST', 'plain text note')
  assert.equal(plain.status, 200)
  assert.ok(plain.json.line.endsWith('plain text note'))

  const bad = await invoke('/api/dsh-memento/capture', 'POST', '')
  assert.equal(bad.status, 400)
  assert.equal(bad.json.ok, false)
})

test('undo route: last entry removed, then a no-op', async () => {
  const before = existsSync(INBOX) ? readFileSync(INBOX, 'utf8') : ''
  const linesBefore = before.split('\n').filter((l) => l.length > 0).length
  await invoke('/api/dsh-memento/undo', 'POST') // remove 'plain text note'
  const again = await invoke('/api/dsh-memento/undo', 'POST') // remove 'smoke note'
  assert.equal(again.json.ok, true)
  assert.equal(again.json.undone, true)
  const after = existsSync(INBOX) ? readFileSync(INBOX, 'utf8') : ''
  const linesAfter = after.split('\n').filter((l) => l.length > 0).length
  assert.equal(linesBefore - linesAfter, 2, 'exactly the two captured entries removed')
  const empty = await invoke('/api/dsh-memento/undo', 'POST')
  assert.equal(empty.json.ok, true)
  assert.equal(empty.json.undone, false)
  assert.equal(after, existsSync(INBOX) ? readFileSync(INBOX, 'utf8') : '', 'no-op undo touched nothing')
})

// ---------------------------------------------------------------- tool ------

test('memory_remember tool: session cwd key, empty text rejects', async () => {
  const tool = toolDefs[0]
  const result = await tool.execute({ text: 'tool note' }, { agent: { session: { header: { cwd: '/tmp/smoke-proj' } } } })
  assert.deepEqual({ ok: result.ok, captured: result.captured }, { ok: true, captured: true })
  assert.match(result.line, ENTRY)
  assert.ok(result.line.includes('[--tmp-smoke-proj--]'), result.line)
  await assert.rejects(tool.execute({ text: '' }, { agent: {} }), /non-empty/)
  await assert.rejects(tool.execute({}, {}), /non-empty/)
  // Cleanup so the next run starts fresh.
  const undo = await invoke('/api/dsh-memento/undo', 'POST')
  assert.equal(undo.json.undone, true)
})

test('memory_history_search tool: fail-open result, empty query rejects', async () => {
  const tool = toolDefs[1]
  // The mock DSH_HOME has no sessions tree, so a search must fail-open:
  // ok:true, zero hits, a degraded entry naming the missing root.
  const result = await tool.execute({ query: 'anything' }, { agent: { session: { header: { cwd: '/tmp/smoke-proj' } } } })
  assert.equal(result.ok, true)
  assert.equal(result.scanned, 0)
  assert.deepEqual(result.hits, [])
  assert.equal(result.truncated, false)
  assert.ok(result.degraded.length >= 1, 'a missing sessions root must be reported degraded')
  await assert.rejects(tool.execute({ query: '   ' }, { agent: {} }), /non-empty/)
  await assert.rejects(tool.execute({}, {}), /non-empty/)
})

// ---------------------------------------------------- trigger pre-step -----

test('trigger pre-step: user message starting with a trigger appends; others pass untouched', async () => {
  const triggerListener = listeners[1].handler
  const baseArgs = {
    agent: { session: { header: { cwd: '/tmp/smoke-proj' } } },
    messages: [],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }
  const next = async () => ({ messages: [], stop: false, stopReason: 'test' })

  // 1) A trigger message → one inbox line.
  const d1 = await triggerListener({
    ...baseArgs,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Remember: the smoke test note' }] }],
  }, next)
  assert.deepEqual(d1, { messages: [], stop: false, stopReason: 'test' }, 'decision must pass through untouched')
  const text1 = existsSync(INBOX) ? readFileSync(INBOX, 'utf8') : ''
  assert.equal(text1.split('\n').filter((l) => l.length > 0).length, 1)
  assert.ok(text1.includes('the smoke test note'))

  // 2) A non-trigger message → no new line.
  await triggerListener({
    ...baseArgs,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'please remember this is not a trigger' }] }],
  }, next)
  const text2 = readFileSync(INBOX, 'utf8')
  assert.equal(text2, text1, 'non-trigger message must not write')

  // 3) Our own injected block (attributed) → no new line even if it starts oddly.
  await triggerListener({
    ...baseArgs,
    messages: [{ role: 'user', source: { kind: 'dsh-memento' }, content: [{ type: 'text', text: 'Note this: injected block' }] }],
  }, next)
  assert.equal(readFileSync(INBOX, 'utf8'), text1)

  // 4) A step with no messages → untouched decision, no write.
  const d4 = await triggerListener({ ...baseArgs, messages: [] }, next)
  assert.equal(d4.stopReason, 'test')

  // Cleanup.
  const undo = await invoke('/api/dsh-memento/undo', 'POST')
  assert.equal(undo.json.undone, true)
})

// -------------------------------------------------------- M3 ritual --------

const M3_CWD = '/tmp/smoke-proj-m3'
const M3_KEY = '--tmp-smoke-proj-m3--'
const M3_MEMORY = join(home, 'memory', 'projects', M3_KEY, 'MEMORY.md')

test('inject (M3): ritual directive appended when the project MEMORY.md exists; no duplicate on step 2', async () => {
  mkdirSync(join(home, 'memory', 'projects', M3_KEY), { recursive: true })
  writeFileSync(M3_MEMORY, 'm3 project note\n', 'utf8')
  const injectListener = listeners[0].handler
  const session = { header: { id: 'sess-m3-inject', cwd: M3_CWD }, surface: { nodes: [] } }
  const baseArgs = { agent: { session }, turn: 1, step: 1, signal: new AbortController().signal }

  const u1 = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello m3' }] }
  const out = await injectListener(
    { ...baseArgs, messages: [u1] },
    async () => ({ kind: 'enter', messages: [u1], stop: false, stopReason: 'test' }),
  )
  assert.equal(out.messages.length, 2, 'exactly one message spliced')
  assert.equal(out.messages[0], u1, 'the direct prompt precedes the baseline')
  const text = out.messages[1].content[0].text
  assert.equal(out.messages[1].source.kind, 'dsh-memento')
  assert.ok(text.includes('<!-- ritual -->'), text)
  assert.ok(text.includes(M3_MEMORY), 'directive must name the absolute project file path')

  // Second step, same session: already delivered → no duplicate splice.
  const u2 = { id: 'u2', role: 'user', content: [{ type: 'text', text: 'again' }] }
  const out2 = await injectListener(
    { ...baseArgs, messages: [u2] },
    async () => ({ kind: 'enter', messages: [u2, out.messages[1]], stop: false, stopReason: 'test' }),
  )
  assert.equal(out2.messages.length, 2, 'no duplicate on the second step')
})

test('compliance (M3): event fold, route payload, default target, disposed log line', async () => {
  const byEvent = Object.fromEntries(listeners.map((l) => [l.event, l.handler]))
  const call = (session, name, argsObj, seq) =>
    byEvent['session/event'](session, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: `c${seq}`, name, arguments: JSON.stringify(argsObj) },
    })

  const bad = { header: { id: 'sess-m3-bad', cwd: M3_CWD } }
  const good = { header: { id: 'sess-m3-good', cwd: M3_CWD } }

  // Unknown session → known: false.
  const unknown = await invoke('/api/dsh-memento/compliance?sessionId=sess-m3-bad')
  assert.equal(unknown.status, 200)
  assert.equal(unknown.json.ok, true)
  assert.equal(unknown.json.known, false)

  // Bad session: mutate before any read.
  call(bad, 'bash', { command: 'echo x > out.txt' }, 1)
  call(bad, 'bash', { command: `cat ${M3_MEMORY}` }, 2)
  const badReport = await invoke('/api/dsh-memento/compliance?sessionId=sess-m3-bad')
  assert.equal(badReport.json.ritualRequired, true)
  assert.equal(badReport.json.projectKey, M3_KEY)
  assert.equal(badReport.json.compliant, false)
  assert.equal(badReport.json.violations.length, 1)
  assert.equal(badReport.json.violations[0].kind, 'mutation-before-memory-read')
  assert.ok(badReport.json.firstMutationAt, 'mutation time reported')
  assert.ok(badReport.json.memoryReadAt, 'read time reported')

  // Good session: read before mutating.
  call(good, 'bash', { command: `cat ${M3_MEMORY}` }, 1)
  call(good, 'write', { file_path: '/tmp/smoke-proj-m3/a.txt' }, 2)
  const goodReport = await invoke('/api/dsh-memento/compliance?sessionId=sess-m3-good')
  assert.equal(goodReport.json.compliant, true)
  assert.deepEqual(goodReport.json.violations, [])

  // Default target (no query): the most recently active session (good).
  const latest = await invoke('/api/dsh-memento/compliance')
  assert.equal(latest.json.sessionId, 'sess-m3-good')
  assert.equal(latest.json.compliant, true)

  // Disposed: tracker removed + one JSONL line per ended session.
  byEvent['session/disposed'](bad)
  byEvent['session/disposed'](good)
  const gone = await invoke('/api/dsh-memento/compliance?sessionId=sess-m3-bad')
  assert.equal(gone.json.known, false)
  const log = join(home, 'memory', '.compliance.log')
  const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(lines.length, 2)
  const byId = Object.fromEntries(lines.map((l) => [l.sessionId, l]))
  assert.equal(byId['sess-m3-bad'].compliant, false)
  assert.equal(byId['sess-m3-bad'].violations.length, 1)
  assert.equal(byId['sess-m3-good'].compliant, true)
  assert.ok(byId['sess-m3-bad'].endedAt, 'endedAt present')
})

// ---------------------------------------------------------- M4 routes ------

test('compliance (M4): history from .compliance.log included in the payload', async () => {
  // The M3 test disposed both sessions (1 non-compliant, 1 compliant).
  const { status, json } = await invoke('/api/dsh-memento/compliance?sessionId=sess-m4-unknown')
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.known, false)
  assert.deepEqual(json.history, { total: 2, compliant: 1, nonCompliant: 1 })
})

test('file route (M4): PUT me → exact bytes on disk, overCap reported not enforced', async () => {
  const mePath = join(home, 'memory', 'ME.md')
  const content = 'alpha\nbeta\ngamma\n'
  const { status, json } = await invoke('/api/dsh-memento/file', 'PUT', JSON.stringify({ target: 'me', content }))
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.target, 'me')
  assert.equal(json.lines, 3)
  assert.equal(json.cap, 30)
  assert.equal(json.overCap, false)
  assert.equal(readFileSync(mePath, 'utf8'), content, 'exact bytes written, no reformat')

  // 40 lines (> 30 cap): accepted, overCap reported.
  const big = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const over = await invoke('/api/dsh-memento/file', 'PUT', JSON.stringify({ target: 'me', content: big }))
  assert.equal(over.status, 200)
  assert.equal(over.json.overCap, true)
  assert.equal(over.json.lines, 40)
  assert.equal(readFileSync(mePath, 'utf8'), big, 'over-cap content stored verbatim')
})

test('file route (M4): validation + path-traversal refusal', async () => {
  const badTarget = await invoke('/api/dsh-memento/file', 'PUT', JSON.stringify({ target: 'x', content: 'a' }))
  assert.equal(badTarget.status, 400)
  const noContent = await invoke('/api/dsh-memento/file', 'PUT', JSON.stringify({ target: 'me' }))
  assert.equal(noContent.status, 400)
  const notJson = await invoke('/api/dsh-memento/file', 'PUT', 'plain text')
  assert.equal(notJson.status, 400)

  // A key override that escapes the vault (memory/projects/../../tmp/evil)
  // is refused, and nothing is written outside ~/.dsh/memory/.
  const escapedPath = join(home, 'tmp', 'evil', 'MEMORY.md')
  const esc = await invoke('/api/dsh-memento/file', 'PUT', JSON.stringify({
    target: 'project',
    content: 'evil\n',
    key: '../../tmp/evil',
  }))
  assert.equal(esc.status, 400)
  assert.ok(!existsSync(escapedPath), `escaped path must not exist: ${escapedPath}`)

  // Same key via a project target with no key → the process-cwd project is
  // used; writing it is allowed (it stays inside the vault).
  const proj = await invoke('/api/dsh-memento/file', 'PUT', JSON.stringify({
    target: 'project',
    content: 'proj note\n',
    key: '--m4-smoke-proj--',
  }))
  assert.equal(proj.status, 200)
  const projPath = join(home, 'memory', 'projects', '--m4-smoke-proj--', 'MEMORY.md')
  assert.equal(readFileSync(projPath, 'utf8'), 'proj note\n')
})

test('inbox line-delete (M4): removes exactly the Nth line; rest byte-identical', async () => {
  const content = 'l1\nl2\nl3\nl4\n'
  writeFileSync(INBOX, content, 'utf8')
  const { status, json } = await invoke('/api/dsh-memento/inbox/line/2', 'DELETE')
  assert.equal(status, 200)
  assert.deepEqual(json, { ok: true, removed: true, line: 'l2' }, 'line reports the removed text')
  assert.equal(readFileSync(INBOX, 'utf8'), 'l1\nl3\nl4\n', 'exactly line 2 gone, newline state preserved')

  // Out of range → reported, file untouched.
  const oor = await invoke('/api/dsh-memento/inbox/line/99', 'DELETE')
  assert.equal(oor.status, 200)
  assert.equal(oor.json.removed, false)
  assert.equal(readFileSync(INBOX, 'utf8'), 'l1\nl3\nl4\n')

  // Non-numeric line → 400.
  const bad = await invoke('/api/dsh-memento/inbox/line/abc', 'DELETE')
  assert.equal(bad.status, 400)
  assert.equal(bad.json.ok, false)

  // The state route now reports the inbox tail, newest first, 1-based.
  const st = await invoke('/api/dsh-memento/state')
  assert.equal(st.json.inbox.exists, true)
  assert.equal(st.json.inbox.total, 3)
  assert.deepEqual(st.json.inbox.lines, [{ n: 3, text: 'l4' }, { n: 2, text: 'l3' }, { n: 1, text: 'l1' }])
  assert.equal(st.json.me.lines, 40, 'file-route write visible in state')
  assert.equal(st.json.me.overCap, true)
})

test('teardown: temp DSH_HOME removed', () => {
  rmSync(home, { recursive: true, force: true })
})
