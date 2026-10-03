/**
 * Inbox → injected-tier promotion helpers (REVIEW-02 R9).
 *
 * Pure functions so acceptance can prove draft append / prefix strip without
 * mounting React. The pane owns the UI; these own the bytes.
 */

/** Strip `timestamp [project-key] ` — only the fact text is promoted. */
export function inboxFact(line: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}) \[([^\]]+)\] ([\s\S]*)$/.exec(line)
  if (match === null) return line
  return match[3]
}

/**
 * Append a promoted fact to an editor draft (unsaved). Ensures a trailing
 * newline on the draft and on the new line. Never touches disk.
 */
export function appendPromoteToDraft(draft: string, fact: string): string {
  const body = fact.replace(/\r\n/g, '\n').replace(/\n+$/g, '')
  if (body.length === 0) return draft
  if (draft.length === 0) return `${body}\n`
  const base = draft.endsWith('\n') ? draft : `${draft}\n`
  return `${base}${body}\n`
}

/** Whether a draft still contains the promoted fact text (post-edit tolerant). */
export function draftContainsFact(draft: string, fact: string): boolean {
  const needle = fact.replace(/\r\n/g, '\n').replace(/\n+$/g, '').trim()
  if (needle.length === 0) return false
  return draft.includes(needle)
}
