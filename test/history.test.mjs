/**
 * Unit tests for dsh-memento M5 session-log archaeology (lib/history.js):
 * the bounded, fail-open zstd scanner over a synthetic sessions tree, snippet
 * construction, matching semantics, ordering, limits, and the read-only proof.
 * Run: node --test test/history.test.mjs
 *
 * Files are compressed with the `zstd` CLI (the same decoder the scanner
 * shells out to) — including concatenated multi-frame files, which is the
 * real on-disk format and the case Node's zlib zstd cannot decode.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const history = await import('../lib/history.js')

const ROOT = mkdtempSync(join(tmpdir(), 'memento-history-'))

/** Compress `text` with the zstd CLI; returns the compressed bytes. */
function zstdBytes(text) {
  const plain = join(ROOT, `.plain-${Math.random().toString(36).slice(2)}`)
  writeFileSync(plain, text, 'utf8')
  try {
    const out = `${plain}.zst`
    execFileSync('zstd', ['--quiet', '--force', plain, '-o', out])
    return readFileSync(out)
  } finally {
    rmSync(plain, { force: true })
    rmSync(`${plain}.zst`, { force: true })
  }
}

/** Write one session log file under `ROOT/<projectKey>/<sessionDir>/`. */
function sessionFile(projectKey, sessionDir, lines, { name = 'session.v3.jsonl.zstd', mtime, rawBytes } = {}) {
  const dir = join(ROOT, projectKey, sessionDir)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  if (rawBytes !== undefined) {
    writeFileSync(path, rawBytes)
  } else {
    const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'
    writeFileSync(path, zstdBytes(text))
  }
  if (mtime !== undefined) utimesSync(path, mtime, mtime)
  return path
}

/** Recursive sha256 map of every file under `dir`. */
function treeHashes(dir) {
  const out = {}
  const walk = (d, rel) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full, rel === '' ? entry : `${rel}/${entry}`)
      else out[rel === '' ? entry : `${rel}/${entry}`] = createHash('sha256').update(readFileSync(full)).digest('hex')
    }
  }
  walk(dir, '')
  return out
}

// -------------------------------------------------------- matching ----------

test('literal substring match returns typed hits with metadata', async () => {
  const dir = join(ROOT, '--k1--', 'session-meta')
  mkdirSync(dir, { recursive: true })
  sessionFile('--k1--', 'session-meta', [
    { type: 'session', id: 'session-meta', createdAt: 1000, cwd: '/x' },
    { type: 'user/message', seq: 1, time: 1700000000000, data: { text: 'hello disk is law world' } },
  ])
  const r = await history.scanHistory({ root: ROOT, query: 'disk is law', projectKey: '--k1--' })
  assert.equal(r.ok, true)
  assert.equal(r.scanned, 1)
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].projectKey, '--k1--')
  assert.equal(r.hits[0].sessionId, 'session-meta')
  assert.equal(r.hits[0].eventType, 'user/message')
  assert.ok(typeof r.hits[0].time === 'string' && r.hits[0].time.length > 0, 'time must be an ISO string')
  assert.ok(r.hits[0].snippet.includes('disk is law'))
  assert.ok(r.hits[0].snippet.length <= 400)
  assert.equal(r.truncated, false)
  assert.deepEqual(r.degraded, [])
})

test('unparseable lines are searched as raw text, never an error', async () => {
  sessionFile('--k2--', 'session-raw', [
    'garbage {{ not json at all',
    { type: 'session', id: 'session-raw', createdAt: 1 },
    'tail line with the rawquery in plain text',
  ])
  const r = await history.scanHistory({ root: ROOT, query: 'rawquery', projectKey: '--k2--' })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].eventType, null)
  assert.equal(r.hits[0].time, null)
  // sessionId falls back to the session directory name.
  assert.equal(r.hits[0].sessionId, 'session-raw')
  assert.ok(r.hits[0].snippet.includes('rawquery'))
})

test('regex fallback fires only when the literal is absent', async () => {
  sessionFile('--k3--', 'session-re', [
    { type: 'session', id: 'session-re', createdAt: 1 },
    { type: 'user/message', time: 10, data: { text: 'a' } },
    { type: 'user/note', time: 11, data: { text: 'b' } },
  ])
  const r = await history.scanHistory({ root: ROOT, query: 'user/(message|note)', projectKey: '--k3--' })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 2)
  const types = r.hits.map((h) => h.eventType).sort()
  assert.deepEqual(types, ['user/message', 'user/note'])
  // The literal "user/(message|note)" appears nowhere, so every hit must be
  // regex-derived — both snippets show the actual matched text.
  assert.ok(r.hits.every((h) => h.snippet.includes('user/message') || h.snippet.includes('user/note')))
})

test('invalid regex degrades to literal-only matching without throwing', async () => {
  sessionFile('--k4--', 'session-badre', [
    { type: 'session', id: 'session-badre', createdAt: 1 },
    { type: 'user/message', time: 1, data: { text: 'the (unclosed query is literal' } },
  ])
  const r = await history.scanHistory({ root: ROOT, query: '(unclosed', projectKey: '--k4--' })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 1)
  assert.ok(r.hits[0].snippet.includes('(unclosed'))
})

// ------------------------------------------------------------ ordering ------

test('hits sort newest first by event time, not by scan order', async () => {
  // The newer-event file gets the OLDER mtime, so mtime-desc scan order
  // disagrees with time order; the result must still be time-desc.
  sessionFile('--ko--', 'session-old-event', [
    { type: 'user/message', time: 2_000_000, data: { text: 'needle old-event' } },
  ], { mtime: 9_000_000 })
  sessionFile('--kn--', 'session-new-event', [
    { type: 'user/message', time: 9_000_000_000_000, data: { text: 'needle new-event' } },
  ], { mtime: 1_000_000 })
  const r = await history.scanHistory({ root: ROOT, query: 'needle', projectKey: null })
  // Restrict to just these two keys via a dedicated root would be cleaner,
  // but the query is unique enough: expect exactly these two hits.
  const ours = r.hits.filter((h) => h.sessionId !== null && h.sessionId.startsWith('session-') && h.snippet.includes('needle'))
  const oursOnly = r.hits.filter((h) => h.snippet.includes('old-event') || h.snippet.includes('new-event'))
  assert.ok(oursOnly.length >= 2, `expected both synthetic hits (got ${oursOnly.length})`)
  const first = oursOnly[0]
  const second = oursOnly[1]
  assert.ok(first.snippet.includes('new-event'), 'newest event must sort first')
  assert.ok(second.snippet.includes('old-event'), 'older event must sort second')
})

// ------------------------------------------------------------- limits --------

test('limit is clamped to 50; exceeding the cap sets truncated', async () => {
  const lines = [{ type: 'session', id: 'session-cap', createdAt: 1 }]
  for (let i = 0; i < 60; i++) {
    lines.push({ type: 'user/message', time: i, data: { text: `capneedle ${i}` } })
  }
  sessionFile('--kcap--', 'session-cap', lines)
  const r = await history.scanHistory({ root: ROOT, query: 'capneedle', projectKey: '--kcap--', limit: 100 })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 50)
  assert.equal(r.truncated, true)
})

test('default limit is 10; exceeding it sets truncated', async () => {
  const lines = []
  for (let i = 0; i < 15; i++) {
    lines.push({ type: 'user/message', time: i, data: { text: `defneedle ${i}` } })
  }
  sessionFile('--kdef--', 'session-def', lines)
  const r = await history.scanHistory({ root: ROOT, query: 'defneedle', projectKey: '--kdef--' })
  assert.equal(r.hits.length, 10)
  assert.equal(r.truncated, true)
})

test('within the limit: truncated stays false', async () => {
  sessionFile('--klt--', 'session-lt', [
    { type: 'user/message', time: 1, data: { text: 'ltneedle one' } },
    { type: 'user/message', time: 2, data: { text: 'ltneedle two' } },
  ])
  const r = await history.scanHistory({ root: ROOT, query: 'ltneedle', projectKey: '--klt--' })
  assert.equal(r.hits.length, 2)
  assert.equal(r.truncated, false)
})

// ------------------------------------------------------ fail-open -----------

test('missing root: ok, no hits, degraded non-empty, no throw', async () => {
  const r = await history.scanHistory({ root: join(ROOT, 'definitely-not-here'), query: 'anything' })
  assert.equal(r.ok, true)
  assert.equal(r.scanned, 0)
  assert.deepEqual(r.hits, [])
  assert.equal(r.truncated, false)
  assert.ok(r.degraded.length > 0, 'degraded must name the missing root')
})

test('missing project key: ok, no hits, degraded non-empty', async () => {
  const r = await history.scanHistory({ root: ROOT, query: 'x', projectKey: '--absent-key--' })
  assert.equal(r.ok, true)
  assert.equal(r.scanned, 0)
  assert.deepEqual(r.hits, [])
  assert.ok(r.degraded.some((d) => d.includes('--absent-key--')))
})

test('corrupt zstd is degraded; sibling files are still searched', async () => {
  sessionFile('--kc--', 'session-good', [
    { type: 'user/message', time: 1, data: { text: 'goodneedle here' } },
  ])
  // Magic + garbage: the CLI reports a decoding error and exits non-zero.
  sessionFile('--kc--', 'session-bad', [], {
    rawBytes: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02, 0x03, 0x04, 0x05]),
  })
  const r = await history.scanHistory({ root: ROOT, query: 'goodneedle', projectKey: '--kc--' })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 1)
  assert.ok(r.hits[0].snippet.includes('goodneedle'))
  assert.ok(r.degraded.some((d) => d.includes('session-bad')), `session-bad must be degraded: ${r.degraded}`)
})

test('truncated real file: decodable lines kept, file flagged degraded', async () => {
  const lines = [
    { type: 'session', id: 'session-trunc', createdAt: 1 },
    { type: 'user/message', time: 1, data: { text: 'partneedle first frame' } },
  ]
  for (let i = 0; i < 4000; i++) {
    lines.push({ type: 'user/message', time: i + 2, data: { text: `padding ${i} ` + 'z'.repeat(200) } })
  }
  const full = zstdBytes(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const path = join(ROOT, '--kt--', 'session-trunc', 'session.v3.jsonl.zstd')
  mkdirSync(dirname2(path), { recursive: true })
  writeFileSync(path, full.subarray(0, Math.floor(full.length / 2)))
  const r = await history.scanHistory({ root: ROOT, query: 'partneedle', projectKey: '--kt--' })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 1, 'the decodable line must still be found')
  assert.ok(r.degraded.some((d) => d.includes('session-trunc')), 'the truncated file must be flagged')
})

function dirname2(p) {
  const i = p.lastIndexOf('/')
  return p.slice(0, i)
}

test('zstd binary absent: every file degraded, result still ok', async () => {
  sessionFile('--knz--', 'session-nz', [
    { type: 'user/message', time: 1, data: { text: 'nzneedle' } },
  ])
  const r = await history.scanHistory({
    root: ROOT,
    query: 'nzneedle',
    projectKey: '--knz--',
    zstdBin: '/nonexistent/bin/zstd',
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.hits, [])
  assert.ok(r.degraded.length >= 1)
  assert.ok(r.degraded.every((d) => d.includes('zstd binary unavailable')))
})

// --------------------------------------------------------- decoding ---------

test('multi-frame zstd is fully decoded (frame 2+ content is visible)', async () => {
  // Two concatenated zstd frames — the real on-disk layout (one frame per
  // appended line). Node's zlib zstd stops at frame 1; the CLI sees both.
  const frame1 = zstdBytes('{"type":"session","id":"session-multi","createdAt":1}\n')
  const frame2 = zstdBytes('{"type":"user/message","time":123,"data":{"text":"multiframe needle"}}\n')
  sessionFile('--km--', 'session-multi', [], { rawBytes: Buffer.concat([frame1, frame2]) })
  const r = await history.scanHistory({ root: ROOT, query: 'multiframe needle', projectKey: '--km--' })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].sessionId, 'session-multi')
  assert.equal(r.hits[0].eventType, 'user/message')
  assert.ok(r.hits[0].snippet.includes('multiframe needle'))
})

test('schema-tolerant glob: v3 and v4 file names both scan', async () => {
  sessionFile('--kg--', 'session-glob', [
    { type: 'user/message', time: 1, data: { text: 'globneedle' } },
  ], { name: 'session.v4.jsonl.zstd' })
  const r = await history.scanHistory({ root: ROOT, query: 'globneedle', projectKey: '--kg--' })
  assert.equal(r.hits.length, 1)
})

// ---------------------------------------------------------- snippets --------

test('snippets are <=400 chars and keep the match visible', async () => {
  const long = 'y'.repeat(5000) + 'snipneedle' + 'w'.repeat(15000)
  sessionFile('--ks--', 'session-snip', [
    { type: 'session', id: 'session-snip', createdAt: 1 },
    { type: 'user/message', time: 1, data: { text: long } },
  ])
  const r = await history.scanHistory({ root: ROOT, query: 'snipneedle', projectKey: '--ks--' })
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].snippet.length, 400)
  assert.ok(r.hits[0].snippet.includes('snipneedle'))
})

test('makeSnippet bounds on short and edge lines', () => {
  const s = history.makeSnippet('abcdef', 2, 2)
  assert.equal(s, 'abcdef')
  const long = 'a'.repeat(1000)
  const s2 = history.makeSnippet(long, 500, 1)
  assert.ok(s2.length <= 400)
  assert.ok(s2.includes('a'))
})

test('clampLimit enforces 1..50', () => {
  assert.equal(history.clampLimit(undefined), 10)
  assert.equal(history.clampLimit('nope'), 10)
  assert.equal(history.clampLimit(0), 1)
  assert.equal(history.clampLimit(-5), 1)
  assert.equal(history.clampLimit(1.5), 1)
  assert.equal(history.clampLimit(100), 50)
  assert.equal(history.clampLimit(50), 50)
  assert.equal(history.clampLimit(NaN), 10)
})

// -------------------------------------------------------- read-only ---------

test('scan is read-only: every file byte-identical, no files added or removed', async () => {
  sessionFile('--kr--', 'session-ro1', [
    { type: 'session', id: 'session-ro1', createdAt: 1 },
    { type: 'user/message', time: 1, data: { text: 'ronedle one' } },
  ])
  sessionFile('--kr--', 'session-ro2', [
    { type: 'user/message', time: 2, data: { text: 'ronedle two' } },
  ])
  const before = treeHashes(join(ROOT, '--kr--'))
  const r = await history.scanHistory({ root: ROOT, query: 'ronedle', projectKey: '--kr--' })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 2)
  const after = treeHashes(join(ROOT, '--kr--'))
  assert.deepEqual(after, before, 'the sessions tree must be byte-identical after a scan')
})

test('project scoping: only the requested key is searched', async () => {
  sessionFile('--ka--', 'session-a', [
    { type: 'user/message', time: 1, data: { text: 'scopedneedle' } },
  ])
  sessionFile('--kb--', 'session-b', [
    { type: 'user/message', time: 2, data: { text: 'scopedneedle' } },
  ])
  const r = await history.scanHistory({ root: ROOT, query: 'scopedneedle', projectKey: '--ka--' })
  assert.equal(r.ok, true)
  assert.ok(r.hits.length >= 1)
  assert.ok(r.hits.every((h) => h.projectKey === '--ka--'), 'no hits may leak from other projects')
  const all = await history.scanHistory({ root: ROOT, query: 'scopedneedle' })
  const keys = new Set(all.hits.map((h) => h.projectKey))
  assert.ok(keys.has('--ka--') && keys.has('--kb--'), 'unscoped scan must cover both projects')
})

test('empty query is a request error (ok: false), not a scan', async () => {
  const r = await history.scanHistory({ root: ROOT, query: '' })
  assert.equal(r.ok, false)
  assert.match(r.error, /query/)
})

test('byte budget cut: truncated without a degraded entry for the skipped files', async () => {
  const lines = [{ type: 'session', id: 'session-bytes', createdAt: 1 }]
  for (let i = 0; i < 50; i++) {
    lines.push({ type: 'user/message', time: i, data: { text: `byneedle ${i} ` + 'q'.repeat(5000) } })
  }
  sessionFile('--kbud--', 'session-bytes', lines)
  const r = await history.scanHistory({
    root: ROOT,
    query: 'zzz-not-present-anywhere',
    projectKey: '--kbud--',
    byteBudget: 10_000,
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.hits, [])
  assert.equal(r.truncated, true, 'byte budget must mark truncation')
  // The file was opened (counted as scanned) but cut short; budget stops are
  // reported via truncated, not degraded (the file is not corrupt).
  assert.ok(r.degraded.length === 0, `unexpected degraded entries: ${r.degraded}`)
})

// ---------------------------------------------------------------- teardown --

test.after(() => {
  rmSync(ROOT, { recursive: true, force: true })
})
