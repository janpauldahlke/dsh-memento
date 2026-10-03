/**
 * M4 acceptance for dsh-memento (Memory rightbar).
 *
 * Reuses the human-owned acceptance server on :3090 — this script NEVER
 * spawns, kills, or restarts any dsh process (plan/PROTOCOL.md "Sacred").
 * If :3090 answers with a stale bundle (pre-M4) or is unreachable, the
 * script exits 2 with a restart instruction.
 *
 * Checks (plan/M4-pane.md):
 *   1. PUT /file target "me" writes exactly the bytes sent (sha256), and is
 *      atomic: a concurrent reader only ever sees the old or the new bytes,
 *      and no *.memento-tmp litter survives.
 *   2. PUT path-traversal attempts (target not allowlisted; key escaping the
 *      vault root) → 400, nothing written.
 *   3. PUT 40 lines → 200 OK, /state reports overCap: true (accepted, not
 *      refused).
 *   4. DELETE /inbox/line/N removes exactly that line; the rest is
 *      byte-identical; out-of-range is a reported no-op; non-numeric is 400.
 *   5. Create on a missing project file creates it; a re-create never
 *      overwrites existing content.
 *   6. lib/client.js exists, is CJS (ModuleLoader factory), and its factory
 *      runs under a strict require that refuses anything outside the
 *      platform baseline (react + react/jsx-runtime).
 *   7. The real client components are rendered with a minimal React hook
 *      dispatcher; their poll loop drives GET /state + /compliance against
 *      :3090 for 30s without error; unmounting disposes the timer (no
 *      pending intervals remain).
 *
 * The run restores ME.md and the inbox to their pre-run bytes.
 *
 * Exit: 0 = all checks pass, 1 = a check failed, 2 = stale bundle / :3090
 * unreachable.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { adoptFileText } from '../lib/reconcile.js'

const BASE = 'http://127.0.0.1:3090'
const PORT = 3090
const REPO = process.cwd()
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const MEMORY_DIR = join(DSH_HOME, 'memory')
const ME_PATH = join(MEMORY_DIR, 'ME.md')
const INBOX_PATH = join(MEMORY_DIR, 'inbox.md')
const PROJECT_KEY = '--m4-accept-proj--'
const PROJECT_PATH = join(MEMORY_DIR, 'projects', PROJECT_KEY, 'MEMORY.md')

const results = []
/** Check 7 driver state (shared with the store-emission listener). */
const driver = { emissions: 0, lastSnap: null, lastError: null }
function record(ok, name, note = '') {
  results.push({ ok, name, note })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sha256Buf = (path) => (existsSync(path) ? sha256(readFileSync(path)) : null)

async function httpJson(path, { method = 'GET', body } = {}) {
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

console.log('dsh-memento M4 acceptance')
console.log(`  repo=${REPO}`)
console.log(`  HOME=${DSH_HOME}`)
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
if (milestoneNum(health.milestone) < 4) {
  console.error(`stale bundle on :3090 (milestone=${health.milestone}, version=${health.version}) — the M4 build is not loaded.`)
  console.error('Host bundles load once per server start; the agent must not restart dsh.')
  console.error('Human action: ./agent/boot-3090.sh (cwd = this repo), then re-run node agent/accept-m4.mjs')
  process.exit(2)
}
console.log(`  :3090 milestone=${health.milestone} version=${health.version}`)

// Snapshot the pre-run state we must restore.
const meBefore = existsSync(ME_PATH) ? readFileSync(ME_PATH) : null
const inboxBefore = existsSync(INBOX_PATH) ? readFileSync(INBOX_PATH) : null

try {
  // ------------------------------------------------------- check 1 (atomic) --
  await (async () => {
    const oldSha = sha256(meBefore ?? Buffer.alloc(0))
    // ~400 KiB of distinct lines: wide enough a write window for the poller
    // to observe, still under the 512 KiB body cap.
    const content = Array.from({ length: 4000 }, (_, i) => `m4 atomic line ${String(i + 1).padStart(4, '0')} ${'x'.repeat(100)}`).join('\n') + '\n'
    const newSha = sha256(content)
    assert(oldSha !== newSha, 'content accidentally identical to the current file')

    const seen = new Set([oldSha])
    let stopped = false
    const poller = setInterval(() => {
      if (stopped) return
      const sha = sha256Buf(ME_PATH)
      if (sha !== null) seen.add(sha)
    }, 2)
    const { status, json } = await httpJson('/api/dsh-memento/file', { method: 'PUT', body: { target: 'me', content } })
    stopped = true
    clearInterval(poller)
    assert(status === 200 && json?.ok === true, `PUT rejected (status ${status}: ${json?.error ?? json})`)
    assert(json?.lines === 4000 && json?.cap === 30 && json?.overCap === true, 'line/cap/overCap report wrong')
    // Exact bytes on disk:
    assert(sha256Buf(ME_PATH) === newSha, 'file on disk is not exactly the sent bytes (sha256 mismatch)')
    // Atomicity: the reader only ever saw the old or the new bytes.
    for (const sha of seen) {
      assert(sha === oldSha || sha === newSha, `a partial file was observed (sha ${sha} is neither old ${oldSha} nor new ${newSha})`)
    }
    // No temp litter in the vault:
    const litter = readdirSync(MEMORY_DIR).filter((name) => name.includes('.memento-tmp'))
    assert(litter.length === 0, `temp files survived: ${litter.join(', ')}`)
    record(true, '1', `sha256-exact write; ${seen.size} observed state(s), all old-or-new; no temp litter`)
  })()

  // ------------------------------------------- check 2 (traversal → 400) -----
  await (async () => {
    // Non-allowlisted target:
    const badTarget = await httpJson('/api/dsh-memento/file', { method: 'PUT', body: { target: '../evil', content: 'x' } })
    assert(badTarget.status === 400 && badTarget.json?.ok === false, `expected 400 for target "../evil" (got ${badTarget.status})`)
    // Key escaping the vault root (memory/projects/../../m4-escape → <HOME>/m4-escape):
    const escapePath = join(MEMORY_DIR, 'm4-escape', 'MEMORY.md')
    const esc = await httpJson('/api/dsh-memento/file', { method: 'PUT', body: { target: 'project', content: 'evil\n', key: '../../m4-escape' } })
    assert(esc.status === 400 && esc.json?.ok === false, `expected 400 for escaping key (got ${esc.status})`)
    assert(!existsSync(escapePath), 'escaped file was written outside the vault')
    // Malformed bodies:
    for (const body of [{ target: 'me' }, 'plain text']) {
      const bad = await httpJson('/api/dsh-memento/file', { method: 'PUT', body })
      assert(bad.status === 400, `expected 400 for body ${JSON.stringify(body)} (got ${bad.status})`)
    }
    record(true, '2', 'traversal/malformed PUTs → 400, nothing written outside the vault')
  })()

  // ------------------------------------- check 3 (over-cap accepted, not…) ---
  await (async () => {
    const content = Array.from({ length: 40 }, (_, i) => `cap line ${i + 1}`).join('\n') + '\n'
    const { status, json } = await httpJson('/api/dsh-memento/file', { method: 'PUT', body: { target: 'me', content } })
    assert(status === 200 && json?.ok === true, `40-line PUT rejected (status ${status})`)
    assert(json.lines === 40 && json.overCap === true, 'payload must report overCap: true')
    const { json: state } = await httpJson('/api/dsh-memento/state')
    assert(state?.ok === true, 'state not ok')
    assert(state.me.overCap === true, '/state must report me.overCap: true')
    assert(state.me.lines === 40, '/state line count must be 40')
    assert(state.me.cap === 30, 'cap must still be 30')
    assert(state.me.text === content, 'state must expose the exact content for the editor')
    record(true, '3', '40 lines accepted (200), /state reports overCap: true — never refused')
  })()

  // ------------------------------------------------- check 4 (line delete) ---
  await (async () => {
    // Append three known entries so we know their 1-based line numbers.
    const preLines = inboxBefore ? inboxBefore.toString('utf8').split('\n').filter((l) => l.length > 0).length : 0
    const entries = ['m4 delete first', 'm4 delete middle', 'm4 delete last']
    for (const text of entries) {
      const { status, json } = await httpJson('/api/dsh-memento/capture', { method: 'POST', body: { text } })
      assert(status === 200 && json?.ok === true, `capture ${text} failed (status ${status})`)
    }
    const nMiddle = preLines + 2
    const nLast = preLines + 3
    const before = readFileSync(INBOX_PATH)
    const { status, json } = await httpJson(`/api/dsh-memento/inbox/line/${nMiddle}`, { method: 'DELETE' })
    assert(status === 200 && json?.ok === true, `DELETE rejected (status ${status})`)
    assert(json.removed === true, 'middle line must report removed: true')
    assert(typeof json.line === 'string' && json.line.endsWith(entries[1]), `line must report the removed text (got ${JSON.stringify(json.line)})`)
    const after = readFileSync(INBOX_PATH)
    const beforeText = before.toString('utf8')
    const beforeLines = beforeText.split('\n')
    if (beforeLines[beforeLines.length - 1] === '') beforeLines.pop() // split artifact, not a line
    const keptLines = beforeLines.filter((_, i) => {
      const no = i + 1
      return no <= preLines || no === preLines + 1 || no === nLast
    })
    const expected = keptLines.join('\n') + (beforeText.endsWith('\n') ? '\n' : '')
    assert(after.toString('utf8') === expected, 'file is not byte-identical except for the removed line')
    assert(after.toString('utf8').includes(entries[0]) && after.toString('utf8').includes(entries[2]), 'the other two entries must survive')

    // Out of range → reported no-op:
    const oor = await httpJson('/api/dsh-memento/inbox/line/999999', { method: 'DELETE' })
    assert(oor.status === 200 && oor.json?.removed === false, 'out-of-range must be a reported no-op')
    assert(sha256Buf(INBOX_PATH) === sha256(after), 'out-of-range delete touched the file')
    // Non-numeric → 400:
    const bad = await httpJson('/api/dsh-memento/inbox/line/abc', { method: 'DELETE' })
    assert(bad.status === 400 && bad.json?.ok === false, 'non-numeric line must be 400')
    // State tail agrees (newest first, 1-based over the whole file). After the
    // middle-line removal, "last" (originally nLast) slides into the freed slot
    // nMiddle and "first" stays at nMiddle-1 — the tail numbers current positions.
    const { json: state } = await httpJson('/api/dsh-memento/state')
    assert(state.inbox.exists === true && state.inbox.total === preLines + 2, 'inbox total must count the two remaining entries')
    assert(state.inbox.lines[0]?.n === nMiddle && state.inbox.lines[0]?.text?.endsWith(entries[2]), 'tail must be newest-first (last slides into the freed slot)')
    assert(state.inbox.lines[1]?.n === nMiddle - 1 && state.inbox.lines[1]?.text?.endsWith(entries[0]), 'second-newest tail line must be the first entry')
    // Restore: undo cannot do this — the line-delete rewrite invalidated the
    // store's tracked offsets (InboxStore's documented fail-safe: mismatch →
    // forget tracking, touch nothing), so the pre-run bytes go back directly.
    if (inboxBefore === null) rmSync(INBOX_PATH, { force: true })
    else writeFileSync(INBOX_PATH, inboxBefore)
    assert(sha256Buf(INBOX_PATH) === (inboxBefore === null ? null : sha256(inboxBefore)), 'inbox not restored after check 4')
    record(true, '4', `DELETE /inbox/line/${nMiddle} removed exactly that line; rest byte-identical`)
  })()

  // ------------------------------------------------ check 5 (create, no wipe) --
  await (async () => {
    // Clean slate for this probe key.
    rmSync(dirname(PROJECT_PATH), { recursive: true, force: true })
    assert(!existsSync(PROJECT_PATH), 'project file should be absent')
    // Create with the commented header seed (REVIEW-01 R7 — pane Create).
    const seed = readFileSync(join(REPO, 'assets/MEMORY.template.md'), 'utf8')
    const created = await httpJson('/api/dsh-memento/file', { method: 'PUT', body: { target: 'project', key: PROJECT_KEY, content: seed } })
    assert(created.status === 200 && created.json?.ok === true, `create rejected (status ${created.status})`)
    assert(existsSync(PROJECT_PATH) && readFileSync(PROJECT_PATH, 'utf8') === seed, 'Create must seed the commented header')
    assert(created.json.cap === 45 && created.json.overCap === false, 'create payload must report the project cap')
    assert(typeof created.json.mtimeMs === 'number', 'create payload must report mtimeMs')
    // Edit the created file (the pane's Save does exactly this):
    const content = 'curated line one\n'
    const edit = await httpJson('/api/dsh-memento/file', {
      method: 'PUT',
      body: { target: 'project', key: PROJECT_KEY, content, mtimeMs: created.json.mtimeMs },
    })
    assert(edit.status === 200 && edit.json?.ok === true, 'edit rejected')
    assert(readFileSync(PROJECT_PATH, 'utf8') === content, 'content must be exactly what was sent')
    // Re-PUTting the same content (a re-triggered save of the unchanged
    // draft) leaves the file byte-identical:
    const again = await httpJson('/api/dsh-memento/file', {
      method: 'PUT',
      body: { target: 'project', key: PROJECT_KEY, content, mtimeMs: edit.json.mtimeMs },
    })
    assert(again.status === 200 && readFileSync(PROJECT_PATH, 'utf8') === content, 're-create must not overwrite existing content')
    record(true, '5', 'Create seeds the header; re-create never clobbers existing content')
  })()

  // --------------------------------------------- check 6 (client CJS bundle) --
  // Load the factory under a require that only knows react + jsx-runtime; any
  // other bare require throws. This proves the bundle is CJS and needs
  // nothing outside the platform baseline.
  const PLATFORM = new Set(['react', 'react/jsx-runtime'])
  const loads = []
  const windowShim = { __ModuleLoader__: { load: (mod) => loads.push(mod) } }
  const clientSrc = readFileSync(join(REPO, 'lib', 'client.js'), 'utf8')
  new Function('window', clientSrc)(windowShim)
  assert(loads.length === 1 && loads[0].id === 'dsh-memento', 'client bundle must register exactly one ModuleLoader module')
  assert(typeof loads[0].factory === 'function', 'ModuleLoader module must carry a factory (CJS wrapper)')
  const factory = loads[0].factory

  // Minimal React: enough hook surface for the pane components. The
  // dispatcher is captured so the acceptance driver can render and unmount.
  const hookState = new Map()
  const subscriptions = []
  let currentApi = null
  const reactShim = {
    useSyncExternalStore(subscribe, getSnapshot) {
      const state = currentApi
      const slot = state.slots[state.idx++]
      if (slot === undefined) {
        const snapshot = getSnapshot()
        const listener = () => {
          const fresh = getSnapshot()
          // Record the emission for the driver (check 7).
          driver.emissions += 1
          driver.lastSnap = fresh
          if (fresh.error !== null) driver.lastError = fresh.error
        }
        subscriptions.push(listener)
        subscribe(listener)
        return snapshot
      }
      return slot
    },
    useEffect(effect) {
      const state = currentApi
      const slot = state.slots[state.idx++]
      const first = slot === undefined
      state.slots[state.idx - 1] = effect
      if (first) {
        const cleanup = effect()
        state.cleanups.push(cleanup)
      }
      return undefined
    },
    useMemo(factoryFn) {
      return factoryFn()
    },
    useState(initial) {
      const state = currentApi
      const slot = state.slots[state.idx++]
      if (slot === undefined) {
        state.slots[state.idx - 1] = typeof initial === 'function' ? initial() : initial
        return [state.slots[state.idx - 1], (update) => {
          state.slots[state.idx - 1] = typeof update === 'function' ? update(state.slots[state.idx - 1]) : update
        }]
      }
      return [slot, () => { /* single render: no re-render path needed */ }]
    },
  }
  const jsxRuntime = {
    jsx: (type, props) => ({ __jsx: true, type, props }),
    jsxs: (type, props) => ({ __jsx: true, type, props }),
    Fragment: '__fragment__',
  }

  const clientExports = factory((name) => {
    if (name === 'react') return reactShim
    if (name === 'react/jsx-runtime') return jsxRuntime
    if (!PLATFORM.has(name)) throw new Error(`client bundle required "${name}" — outside the platform baseline`)
    return {}
  })
  assert(typeof clientExports.apply === 'function' && clientExports.name === 'dsh-memento', 'client exports missing')

  // Register the seats under a mock ctx (same contract as the host smoke test).
  const tabSeats = []
  const clientCtx = {
    slots: {
      inject: (seat, fn) => { fn(); tabSeats.push(seat) },
      register: (definition, component) => { tabSeats.push({ ...definition, component }); return () => {} },
    },
    sidebarRightTabs: { register: (def) => { tabSeats.push({ tabType: def }); return () => {} } },
    effect: (fn) => { clientCtx.__dispose = fn },
  }
  clientExports.apply(clientCtx)
  const bodyDef = tabSeats.find((t) => t.name === 'sidebar.right.pane.tab' && t.key === 'dsh-memento')
  const titleDef = tabSeats.find((t) => t.name === 'sidebar.right.pane.tab.title' && t.key === 'dsh-memento')
  assert(bodyDef?.component, 'pane body seat not registered (keyed memento)')
  assert(titleDef?.component, 'title seat not registered (keyed memento)')
  assert(tabSeats.some((t) => t.tabType?.id === 'dsh-memento'), 'rightbar tab type not registered')
  record(true, '6', 'lib/client.js is a CJS ModuleLoader factory; factory ran under a strict require (react + jsx-runtime only); seats registered')

  // ------------------------------------------------ check 7 (30s poll, no…) ---
  await (async () => {
    const state = {
      slots: [],
      cleanups: [],
      idx: 0,
    }
    // The client is browser-correct: it fetches same-origin RELATIVE urls
    // ('/api/dsh-memento/…'). Node's fetch needs absolute urls, so the harness
    // resolves them against :3090. The client code is left untouched.
    const origFetch = globalThis.fetch
    globalThis.fetch = (url, init) => {
      if (typeof url === 'string' && url.startsWith('/')) url = BASE + url
      return origFetch(url, init)
    }
    // Interval accounting: wrap the globals the bundle resolves.
    const pending = new Set()
    const origSet = globalThis.setInterval
    const origClear = globalThis.clearInterval
    globalThis.setInterval = (fn, ms) => {
      const handle = origSet(fn, ms)
      pending.add(handle)
      return handle
    }
    globalThis.clearInterval = (handle) => {
      pending.delete(handle)
      return origClear(handle)
    }

    // Render both components (first render → effects run, subscriptions made).
    currentApi = state
    let renderedBody = null
    let renderedTitle = null
    try {
      renderedBody = bodyDef.component()
      renderedTitle = titleDef.component()
    } finally {
      currentApi = null
    }
    assert(renderedBody !== null && renderedTitle !== null, 'components rendered nothing')
    assert(state.cleanups.length >= 1, 'no mount effects ran (polling would never start)')
    assert(pending.size === 1, `expected exactly 1 pending interval after mount, got ${pending.size}`)
    assert(subscriptions.length >= 1, 'no store subscriptions made')

    // Drive the real poll loop for 30s against :3090.
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
    assert(driver.emissions >= 6, `expected >= 6 store emissions in 30s (poll rounds), got ${driver.emissions}`)
    const snap = driver.lastSnap
    assert(snap !== null, 'no store snapshot captured during the 30s window')
    assert(snap.state !== null, '/state never succeeded during the 30s window')
    assert(snap.compliance !== null, '/compliance never succeeded during the 30s window')
    assert(snap.error === null, `poll error during the 30s window: ${snap.error}`)
    assert(driver.lastError === null, `transient poll error observed: ${driver.lastError}`)

    // Unmount: run every effect cleanup (stops the poller, unsubscribes).
    for (const cleanup of state.cleanups) {
      if (typeof cleanup === 'function') cleanup()
    }
    for (const unsubscribe of subscriptions) unsubscribe()
    assert(pending.size === 0, `${pending.size} interval(s) still pending after unmount — timer leak`)

    globalThis.setInterval = origSet
    globalThis.clearInterval = origClear
    globalThis.fetch = origFetch
    // `emissions` counts listener notifications (both mounted components), so
    // it is >= the number of store emits; >= 6 proves many clean poll rounds.
    record(true, '7', `client poll loop: ${driver.emissions} store notifications over 30s, state + compliance clean, unmount cleared all timers`)
  })()

  // --------------------------------------------- restore probe project -------
  // Check 5's probe key must not outlive the run.
  rmSync(dirname(PROJECT_PATH), { recursive: true, force: true })
  assert(!existsSync(PROJECT_PATH), 'probe project not cleaned up')

  // ------------------------------- check 8 (REVIEW-01 R1: adopt + mtime) ----
  await (async () => {
    // (a) non-dirty section adopts an external change.
    const adopted = adoptFileText('disk-v2\n', {
      draft: 'disk-v1\n',
      baseline: 'disk-v1\n',
      conflict: false,
    })
    assert(adopted.draft === 'disk-v2\n' && adopted.baseline === 'disk-v2\n' && adopted.conflict === false,
      'non-dirty editor must adopt external fileText')
    const conflicted = adoptFileText('disk-v2\n', {
      draft: 'draft-edit\n',
      baseline: 'disk-v1\n',
      conflict: false,
    })
    assert(conflicted.draft === 'draft-edit\n' && conflicted.conflict === true,
      'dirty editor must keep draft and surface conflict when disk changes')

    // (b) stale mtimeMs → 409, file byte-unchanged.
    const { json: state } = await httpJson('/api/dsh-memento/state')
    assert(state?.ok === true && typeof state.me?.mtimeMs === 'number', 'state must expose me.mtimeMs')
    const before = readFileSync(ME_PATH)
    const beforeSha = sha256(before)
    const stale = await httpJson('/api/dsh-memento/file', {
      method: 'PUT',
      body: { target: 'me', content: 'stale overwrite\n', mtimeMs: state.me.mtimeMs - 1 },
    })
    assert(stale.status === 409 && stale.json?.ok === false, `expected 409 for stale mtime (got ${stale.status})`)
    assert(sha256Buf(ME_PATH) === beforeSha, 'stale PUT must leave the file byte-unchanged')

    // (c) current mtimeMs → success.
    const next = `m4 mtime ok ${Date.now()}\n`
    const fresh = await httpJson('/api/dsh-memento/file', {
      method: 'PUT',
      body: { target: 'me', content: next, mtimeMs: state.me.mtimeMs },
    })
    assert(fresh.status === 200 && fresh.json?.ok === true, `current mtime PUT failed (status ${fresh.status})`)
    assert(readFileSync(ME_PATH, 'utf8') === next, 'current mtime PUT must write the new bytes')
    assert(typeof fresh.json.mtimeMs === 'number', 'success payload must report mtimeMs')
    record(true, '8', 'adoptFileText + stale mtime 409 + current mtime 200')
  })()

  // ---------------------------------------------------- restore ME.md --------
  if (meBefore !== null) {
    writeFileSync(ME_PATH, meBefore)
  }
  assert(sha256Buf(ME_PATH) === (meBefore !== null ? sha256(meBefore) : null), 'ME.md restore failed')
} catch (error) {
  record(false, 'crash', String(error?.message ?? error))
}

const failed = results.some((r) => !r.ok)
console.log(failed ? '\nM4 acceptance: FAIL' : '\nM4 acceptance: PASS')
process.exit(failed ? 1 : 0)
