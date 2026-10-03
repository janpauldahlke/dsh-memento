/**
 * Unit tests for inbox → draft promotion helpers (REVIEW-02 R9).
 * Run: node --test test/promote.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendPromoteToDraft, draftContainsFact, inboxFact } from '../lib/promote.js'

test('inboxFact strips timestamp [key] prefix', () => {
  assert.equal(
    inboxFact('2026-10-03T14:00:00+02:00 [--home-hagbard-dev-dsh-memento--] prefer peer tone'),
    'prefer peer tone',
  )
  assert.equal(inboxFact('bare fact with no prefix'), 'bare fact with no prefix')
})

test('appendPromoteToDraft appends unsaved and never drops existing bytes', () => {
  assert.equal(appendPromoteToDraft('', 'new fact'), 'new fact\n')
  assert.equal(appendPromoteToDraft('line one\n', 'line two'), 'line one\nline two\n')
  assert.equal(appendPromoteToDraft('no trailing nl', 'x'), 'no trailing nl\nx\n')
})

test('append at cap still grows the draft (ceiling, not a block)', () => {
  const thirty = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const next = appendPromoteToDraft(thirty, 'overflow fact')
  const lines = next.endsWith('\n') ? next.slice(0, -1).split('\n').length : next.split('\n').length
  assert.equal(lines, 31)
  assert.ok(draftContainsFact(next, 'overflow fact'))
})
