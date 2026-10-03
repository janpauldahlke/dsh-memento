/**
 * The Memory pane body (M4): the human surface for bounded-file memory.
 *
 * Three jobs only — read the files, edit them, and see cap pressure:
 *
 * 1. ME.md — editable textarea, live line counter `n / 30`. At or over cap
 *    the counter warns and shows the exact design sentence:
 *    "at cap — adding a line means removing one".
 * 2. Project `<key>` — same, cap 45; absent → "no project memory" + Create.
 * 3. Inbox (tail 20, newest first) — read-only lines, each deletable, total
 *    shown. No promote action: promotion is the human copying a line up.
 *
 * Plus the M3 compliance strip: "ritual: 7/9 sessions" + the current
 * session's state, one small line.
 *
 * Inline styles only (no CSS pipeline). Runtime imports: react (+jsx-runtime)
 * and the local modules — the platform baseline for the CJS bundle.
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InboxLinePayload, StatePayload } from '../shared/types.ts'
import { useMemory } from './useMemory.ts'
import { MemoryIcon } from './MemoryIcon.tsx'

/** Editor-style line count (identical convention to the host's `countLines`). */
function countLines(text: string): number {
  if (text.length === 0) return 0
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  if (text.charCodeAt(text.length - 1) !== 10) n++
  return n
}

const box: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  height: '100%',
  overflowY: 'auto',
  padding: '12px 14px',
  fontSize: 13,
  color: 'inherit',
}

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  marginBottom: 6,
}

const heading: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const counter: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 12,
  fontFamily: 'var(--dsh-font-mono, monospace)',
}

const textareaStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'var(--dsh-font-mono, monospace)',
  fontSize: 12,
  lineHeight: 1.5,
  padding: 8,
  borderRadius: 4,
  border: '1px solid var(--dsh-color-border, #3a3a3a)',
  background: 'var(--dsh-color-bg-subtle, rgba(255,255,255,0.03))',
  color: 'inherit',
  resize: 'vertical',
  whiteSpace: 'pre',
  tabSize: 2,
}

const buttonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 6,
  padding: '3px 12px',
  fontSize: 12,
  borderRadius: 4,
  border: '1px solid var(--dsh-color-border, #4a4a4a)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const muted: CSSProperties = {
  color: 'var(--dsh-color-text-muted, #8a8a8a)',
  fontSize: 12,
}

const stripStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid var(--dsh-color-border, #3a3a3a)',
  color: 'var(--dsh-color-text-muted, #9a9a9a)',
}

const inboxRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  padding: '2px 0',
}

const inboxTextStyle: CSSProperties = {
  flex: 1,
  fontFamily: 'var(--dsh-font-mono, monospace)',
  fontSize: 11.5,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

/** The cap-pressure counter: muted below cap, warn at cap, crit over cap. */
function Counter({ lines, cap }: { lines: number; cap: number }): ReactNode {
  const atOrOver = lines >= cap
  const over = lines > cap
  return (
    <span
      style={{
        ...counter,
        color: over
          ? 'var(--dsh-color-error, #dc2626)'
          : atOrOver
            ? 'var(--dsh-color-warning, #d97706)'
            : undefined,
      }}
    >
      {lines} / {cap}
    </span>
  )
}

interface EditSectionProps {
  title: ReactNode
  cap: number
  fileText: string | undefined
  /** Present when the file is absent and can be created from this pane. */
  createLabel?: string
  minHeight: number
  target: 'me' | 'project'
}

/** One editable file section: counter, textarea, Save — or the absent state. */
function EditSection({ title, cap, fileText, createLabel, minHeight, target }: EditSectionProps): ReactNode {
  const { snapshot, saveFile } = useMemory()
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Seed the draft the first time the file content arrives; afterwards the
  // draft is the editor's own state (an in-flight edit is never clobbered by
  // a poll, and a file created mid-session is adopted when it appears).
  useEffect(() => {
    if (fileText === undefined) return
    setDraft((current) => (current === null ? fileText : current))
  }, [fileText])

  const lines = draft === null ? 0 : countLines(draft)
  const atOrOver = lines >= cap
  const dirty = draft !== null && fileText !== undefined && draft !== fileText

  const save = async (): Promise<void> => {
    if (draft === null) return
    setStatus('saving')
    const ok = await saveFile(target, draft)
    setStatus(ok ? 'saved' : 'error')
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={headerRow}>
        <span style={heading}>{title}</span>
        {fileText !== undefined ? <Counter lines={lines} cap={cap} /> : null}
      </div>
      {fileText === undefined ? (
        <div style={{ ...muted, paddingBottom: 4 }}>
          {createLabel ?? 'no file'}
          {createLabel !== undefined ? (
            <div>
              <button type="button" style={buttonStyle} onClick={() => { void saveFile(target, '').then((ok) => { if (ok) setStatus('saved') }) }}>
                Create
              </button>
              {status === 'saved' ? <span style={{ ...muted, marginLeft: 8 }}>created</span> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <textarea
            style={{ ...textareaStyle, minHeight }}
            value={draft ?? ''}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value)
              if (status !== 'idle') setStatus('idle')
            }}
          />
          {atOrOver ? (
            <div style={{ ...muted, marginTop: 4, color: 'var(--dsh-color-warning, #d97706)' }}>
              at cap — adding a line means removing one
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...buttonStyle, opacity: dirty || status === 'error' ? 1 : 0.55 }}
            disabled={status === 'saving' || !dirty}
            onClick={() => { void save() }}
          >
            {status === 'saving' ? 'saving…' : status === 'saved' ? 'saved ✓' : 'Save'}
          </button>
          {status === 'error' ? <div style={{ ...muted, marginTop: 4, color: 'var(--dsh-color-error, #dc2626)' }}>save failed — see status line</div> : null}
        </>
      )}
    </section>
  )
}

/** One read-only inbox line with its delete affordance. */
function InboxLineRow({ line }: { line: InboxLinePayload }): ReactNode {
  const { deleteInboxLine } = useMemory()
  return (
    <div style={inboxRowStyle}>
      <span style={inboxTextStyle}>{line.text}</span>
      <button
        type="button"
        aria-label={`delete inbox line ${line.n}`}
        title={`delete line ${line.n}`}
        style={{
          ...buttonStyle,
          marginTop: 0,
          padding: '0 6px',
          lineHeight: '18px',
          fontSize: 12,
          color: 'var(--dsh-color-text-muted, #8a8a8a)',
        }}
        onClick={() => { void deleteInboxLine(line.n) }}
      >
        ×
      </button>
    </div>
  )
}

/** The M3 compliance strip: rolling rate + current session's state. */
function ComplianceStrip(): ReactNode {
  const { snapshot } = useMemory()
  const compliance = snapshot.compliance
  if (compliance === null) return null
  const history = compliance.history
  const rate = history !== undefined && history.total > 0 ? `${history.compliant}/${history.total} sessions` : 'no sessions logged'
  let current: string
  if (compliance.sessionId === null) current = 'no session tracked'
  else if (compliance.compliant === true) current = 'this session: compliant'
  else if (compliance.compliant === false) current = 'this session: non-compliant'
  else current = 'this session: no ritual required'
  return (
    <div style={stripStyle}>
      <MemoryIcon size={13} />
      <span>
        ritual: {rate} · {current}
      </span>
    </div>
  )
}

/** The pane: compliance strip + ME.md + project + inbox. */
export function MemoryBody(): ReactNode {
  const { snapshot } = useMemory()
  const state: StatePayload | null = snapshot.state
  return (
    <div style={box}>
      <ComplianceStrip />
      {state === null ? (
        <div style={muted}>loading memory…{snapshot.error !== null ? ` (${snapshot.error})` : ''}</div>
      ) : (
        <>
          <EditSection
            title={<>ME.md</>}
            cap={state.me.cap}
            fileText={state.me.exists ? state.me.text : undefined}
            minHeight={90}
            target="me"
          />
          <EditSection
            title={<>Project <span style={{ fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 12 }}>{state.project.key}</span></>}
            cap={state.project.cap}
            fileText={state.project.exists ? state.project.text : undefined}
            createLabel={state.project.exists ? undefined : 'no project memory'}
            minHeight={120}
            target="project"
          />
          <section style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={headerRow}>
              <span style={heading}>Inbox</span>
              <span style={muted}>
                {state.inbox.total === 0 ? 'empty' : `${state.inbox.total} total · newest ${state.inbox.lines.length} shown`}
              </span>
            </div>
            {state.inbox.total === 0 ? (
              <div style={muted}>nothing captured yet — "Remember this: …" or the memory_remember tool lands here</div>
            ) : (
              <>
                {state.inbox.lines.map((line) => (
                  <InboxLineRow key={line.n} line={line} />
                ))}
                <div style={{ ...muted, marginTop: 4 }}>
                  delete removes only that line · copy a line up into ME.md or the project memory to promote it
                </div>
              </>
            )}
          </section>
        </>
      )}
      {snapshot.error !== null ? (
        <div style={{ ...muted, color: 'var(--dsh-color-error, #dc2626)' }}>{snapshot.error}</div>
      ) : null}
    </div>
  )
}
