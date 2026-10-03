/**
 * Unit tests for the dsh-memento inbox core (pure + temp-dir IO, no network).
 * Run: node --test test/inbox.test.mjs
 *
 * Covers the M2 spec: trigger matching (start-anchored, case-insensitive,
 * the three phrases, nothing else), entry format (one line, ISO-local
 * timestamp, `--key--`, newlines collapsed), append/undo semantics (last
 * entry only, byte-identical restore, second undo is a no-op, external
 * edits invalidate the trail).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The built inbox core (ESM, node-only — no harness imports, so it runs
// under plain `node --test` without the dsh resolution environment).
import {
  ENTRY_LINE_PATTERN,
  InboxStore,
  detectTrigger,
  formatEntry,
  inboxPath,
  insertInboxLine,
  isoLocal,
  removeInboxLine,
} from '../lib/inbox.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'memento-'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const KEY = '--home-hagbard-dev-dsh-memento--'

// ---------------------------------------------------------------- trigger ---

test('detectTrigger: the three phrases match, case-insensitively, at start', () => {
  assert.equal(detectTrigger('Remember: the deploy script is ~/bin/deploy'), 'the deploy script is ~/bin/deploy')
  assert.equal(detectTrigger('remember this: llama needs 12GB of headroom'), 'llama needs 12GB of headroom')
  assert.equal(detectTrigger('REMEMBER THIS: port 3090 is the acceptance port'), 'port 3090 is the acceptance port')
  assert.equal(detectTrigger('Note this: the human owns :3090'), 'the human owns :3090')
  assert.equal(detectTrigger('note this:  keep two leading spaces'), 'keep two leading spaces')
})

test('detectTrigger: anything else is not a trigger', () => {
  assert.equal(detectTrigger('please remember: the password'), null)
  assert.equal(detectTrigger('I will remember that'), null)
  assert.equal(detectTrigger('Don\'t forget: the password'), null)
  assert.equal(detectTrigger('Keep in mind: the password'), null)
  assert.equal(detectTrigger('Remembering this is hard'), null)
  assert.equal(detectTrigger('mid-sentence Remember: the password'), null)
})

test('detectTrigger: leading whitespace is allowed, nothing left over is not', () => {
  assert.equal(detectTrigger('   Remember: x'), 'x')
  assert.equal(detectTrigger('Remember:'), null)
  assert.equal(detectTrigger('Remember:   '), null)
  assert.equal(detectTrigger(''), null)
  assert.equal(detectTrigger(null), null)
})

test('detectTrigger: newlines collapse to single spaces', () => {
  assert.equal(detectTrigger('Remember: one\ntwo'), 'one two')
  assert.equal(detectTrigger('Remember: one\n\n\ntwo'), 'one two')
  // Each run of newlines becomes exactly one space; pre-existing spaces stay.
  assert.equal(detectTrigger('Remember: one \ntwo'), 'one  two')
})

// ------------------------------------------------------------ entry format ---

test('formatEntry: exact line shape', () => {
  const now = new Date('2026-10-03T00:42:11')
  const line = formatEntry('the thing', KEY, now)
  assert.match(line, ENTRY_LINE_PATTERN)
  assert.equal(line.split(' ').length, 3 + line.split(' ')[2].split(' ').length) // sanity: ts [key] payload
  assert.ok(line.startsWith(isoLocal(now) + ' [' + KEY + '] '))
  assert.equal(line, `${isoLocal(now)} [${KEY}] the thing`)
})

test('formatEntry: multi-line input never produces an embedded newline', () => {
  const line = formatEntry('a\nb\nc', KEY)
  assert.doesNotMatch(line, /\n/)
  assert.equal(line, `${isoLocal(new Date())} [${KEY}] a b c`)
})

test('isoLocal: local offset, second precision', () => {
  const now = new Date()
  const iso = isoLocal(now)
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  // The numeric offset matches the platform's actual timezone offset.
  const match = iso.match(/([+-])(\d{2}):(\d{2})$/)
  assert.ok(match)
  const minutes = (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
  assert.equal(minutes, -now.getTimezoneOffset())
})

test('inboxPath: under memory/', () => {
  assert.equal(inboxPath('/home/hagbard/.dsh'), join('/home/hagbard/.dsh', 'memory', 'inbox.md'))
})

// ------------------------------------------------------------ append + undo ---

test('append: creates the file, one line per entry', () => {
  const dir = tmp()
  try {
    const store = new InboxStore(join(dir, 'memory', 'inbox.md'))
    const a = store.append(KEY, 'first note')
    const b = store.append(KEY, 'second note')
    assert.match(a.line, ENTRY_LINE_PATTERN)
    assert.match(b.line, ENTRY_LINE_PATTERN)
    const text = readFileSync(store.path, 'utf8')
    assert.equal(text.split('\n').filter((l) => l.length > 0).length, 2)
    assert.ok(text.includes(`[${KEY}] first note`))
    assert.ok(text.includes(`[${KEY}] second note`))
    assert.equal(b.startOffset, a.startOffset + Buffer.byteLength(`${a.line}\n`, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('undo: last entry only, byte-identical restore, second undo is a no-op', () => {
  const dir = tmp()
  try {
    const inbox = join(dir, 'memory', 'inbox.md')
    const pre = 'pre-existing line\n'
    mkdirSync(join(dir, 'memory'))
    writeFileSync(inbox, pre)
    const preHash = sha256(pre)

    const store = new InboxStore(inbox)
    const first = store.append(KEY, 'first')
    const second = store.append(KEY, 'second')
    assert.notEqual(sha256(readFileSync(inbox)), preHash)

    // Undo the last (second) entry only.
    let result = store.undo()
    assert.equal(result.undone, true)
    assert.equal(result.line, second.line)
    assert.ok(readFileSync(inbox, 'utf8').includes(`[${KEY}] first`))
    assert.ok(!readFileSync(inbox, 'utf8').includes('second'))

    // Undo the first entry → byte-identical to the pre-existing state.
    result = store.undo()
    assert.equal(result.undone, true)
    assert.equal(result.line, first.line)
    assert.equal(sha256(readFileSync(inbox)), preHash)

    // Nothing left: not an error.
    result = store.undo()
    assert.equal(result.undone, false)
    assert.equal(sha256(readFileSync(inbox)), preHash)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('undo: empty store → undone:false, nothing created', () => {
  const dir = tmp()
  try {
    const inbox = join(dir, 'memory', 'inbox.md')
    const store = new InboxStore(inbox)
    assert.equal(store.undo().undone, false)
    assert.throws(() => readFileSync(inbox)) // file was never created
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('undo: external edit over the entry invalidates the trail', () => {
  const dir = tmp()
  try {
    const inbox = join(dir, 'memory', 'inbox.md')
    const store = new InboxStore(inbox)
    const entry = store.append(KEY, 'will be overwritten')
    // A human edits exactly the region we wrote (same length, new bytes).
    const text = readFileSync(inbox, 'utf8')
    const start = entry.startOffset
    writeFileSync(inbox, text.slice(0, start) + 'x'.repeat(text.length - start))
    assert.equal(store.undo().undone, false)
    // The file is untouched by the failed undo.
    assert.ok(!readFileSync(inbox, 'utf8').includes('will be overwritten'))
    assert.equal(readFileSync(inbox, 'utf8').slice(start, start + 1), 'x')
    assert.equal(store.undo().undone, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('undo: file deleted → undone:false, trail forgotten', () => {
  const dir = tmp()
  try {
    const inbox = join(dir, 'memory', 'inbox.md')
    const store = new InboxStore(inbox)
    store.append(KEY, 'note one')
    rmSync(inbox)
    assert.equal(store.undo().undone, false)
    assert.equal(store.undo().undone, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('separate instances do not share undo trails', () => {
  const dir = tmp()
  try {
    const inbox = join(dir, 'memory', 'inbox.md')
    const a = new InboxStore(inbox)
    a.append(KEY, 'from instance A')
    const b = new InboxStore(inbox)
    assert.equal(b.undo().undone, false) // B appended nothing
    const text = readFileSync(inbox, 'utf8')
    assert.ok(text.includes('from instance A'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('insertInboxLine restores a removed line at the preferred position (R9 Undo)', () => {
  const dir = tmp()
  try {
    const inbox = join(dir, 'memory', 'inbox.md')
    mkdirSync(join(dir, 'memory'), { recursive: true })
    writeFileSync(inbox, 'one\ntwo\nthree\n')
    const removed = removeInboxLine(inbox, 2)
    assert.equal(removed.removed, true)
    assert.equal(removed.line, 'two')
    assert.equal(readFileSync(inbox, 'utf8'), 'one\nthree\n')
    const inserted = insertInboxLine(inbox, 2, 'two')
    assert.equal(inserted.inserted, true)
    assert.equal(inserted.n, 2)
    assert.equal(readFileSync(inbox, 'utf8'), 'one\ntwo\nthree\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
