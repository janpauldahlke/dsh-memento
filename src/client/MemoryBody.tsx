/**
 * The Memory pane body (M4 + REVIEW-01): the human surface for bounded-file
 * memory — edit the vault, see what was injected, stop the plugin, and read
 * the inbox.
 *
 * Inline styles only (no CSS pipeline). Runtime imports: react (+jsx-runtime)
 * and the local modules — the platform baseline for the CJS bundle.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InboxLinePayload, StatePayload } from '../shared/types.ts'
import { adoptFileText } from '../shared/reconcile.ts'
import { useMemory } from './useMemory.ts'
import { MemoryIcon } from './MemoryIcon.tsx'

/** Seed written by Create (must match assets/MEMORY.template.md). */
const PROJECT_CREATE_SEED =
  '# MEMORY — project lore (cap: 45 lines, hand-edited only)\n' +
  '<!-- Rules: 1) never record what `rg` can find  2) must still be true in 3 months\n' +
  '     3) if you had to say it twice, it belongs here -->\n'

/** Editor-style line count (identical convention to the host's `countLines`). */
function countLines(text: string): number {
  if (text.length === 0) return 0
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  if (text.charCodeAt(text.length - 1) !== 10) n++
  return n
}

/** Home-dir shortening for path display (`/home/you/dev/x` → `~/dev/x`). */
function shortPath(cwd: string): string {
  if (cwd.startsWith('/home/')) {
    const slash = cwd.indexOf('/', 6)
    if (slash > 0) return `~${cwd.slice(slash)}`
  }
  return cwd
}

/** Parse an inbox line into display parts; falls back to raw text. */
function parseInboxLine(text: string): { time: string | null; key: string | null; body: string } {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}) \[([^\]]+)\] ([\s\S]*)$/.exec(text)
  if (match === null) return { time: null, key: null, body: text }
  return { time: match[1], key: match[2], body: match[3] }
}

/** Relative time from an ISO-local timestamp; falls back to the raw stamp. */
function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const delta = Math.max(0, nowMs - ms)
  const sec = Math.floor(delta / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

/** Short project chip from a `--slug--` key (last path-ish segment). */
function projectChip(key: string, cwd: string | undefined, currentKey: string): string {
  if (key === currentKey && cwd !== undefined) {
    const base = cwd.split('/').filter(Boolean).pop()
    return base ?? shortPath(cwd)
  }
  const slug = key.replace(/^--/, '').replace(/--$/, '')
  const parts = slug.split('-').filter(Boolean)
  if (parts.length === 0) return key
  // Prefer the trailing segment(s); hyphenated dir names stay joined at the end.
  return parts.length <= 2 ? parts.join('-') : parts.slice(-2).join('-')
}

/** Auto-size height: content up to roughly cap lines, still vertically resizable. */
function editorHeight(lines: number, cap: number): number {
  const linePx = 18 // 12px font × 1.5 line-height
  const pad = 16
  const shown = Math.min(Math.max(lines, 4), cap)
  return shown * linePx + pad
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
  marginBottom: 4,
}

const heading: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const purposeStyle: CSSProperties = {
  color: 'var(--dsh-color-text-muted, #8a8a8a)',
  fontSize: 11.5,
  lineHeight: 1.4,
  marginBottom: 6,
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
  padding: '4px 0',
}

const chipStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 10.5,
  lineHeight: '16px',
  padding: '0 5px',
  borderRadius: 3,
  border: '1px solid var(--dsh-color-border, #3a3a3a)',
  color: 'var(--dsh-color-text-muted, #8a8a8a)',
  maxWidth: 96,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const inboxTextStyle: CSSProperties = {
  flex: 1,
  fontSize: 12,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const meRulesStyle: CSSProperties = {
  ...muted,
  fontSize: 11,
  lineHeight: 1.4,
  marginBottom: 6,
}

/** The cap-pressure counter: muted below cap, warn at cap, crit over cap. */
function Counter({ lines, cap }: { lines: number; cap: number }): ReactNode {
  const atOrOver = lines >= cap
  const over = lines > cap
  const title = `${lines} of ${cap} lines used. The limit is deliberate: a short file gets read, a long one gets skimmed. At the limit, add a line by removing one.`
  return (
    <span
      title={title}
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
  purpose: string
  cap: number
  fileText: string | undefined
  mtimeMs: number | undefined
  /** Present when the file is absent and can be created from this pane. */
  createLabel?: string
  createTitle?: string
  /** Extra note under the purpose (ME.md rules). */
  rules?: string
  target: 'me' | 'project'
  /** Initial seed for Create (project header); default empty for me. */
  createSeed?: string
}

/** One editable file section: counter, textarea, Save — or the absent state. */
function EditSection({
  title,
  purpose,
  cap,
  fileText,
  mtimeMs,
  createLabel,
  createTitle,
  rules,
  target,
  createSeed = '',
}: EditSectionProps): ReactNode {
  const { saveFile } = useMemory()
  const [editor, setEditor] = useState(() => adoptFileText(fileText, {
    draft: null,
    baseline: undefined,
    conflict: false,
  }))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Keep the latest mtime for Save without re-binding the effect.
  const mtimeRef = useRef(mtimeMs)
  mtimeRef.current = mtimeMs

  useEffect(() => {
    setEditor((prev) => adoptFileText(fileText, prev))
  }, [fileText])

  const { draft, baseline, conflict } = editor
  const lines = draft === null ? 0 : countLines(draft)
  const atOrOver = lines >= cap
  const dirty = draft !== null && baseline !== undefined && draft !== baseline

  const save = async (forceMtime?: number): Promise<void> => {
    if (draft === null) return
    setStatus('saving')
    const token = forceMtime ?? mtimeRef.current
    const ok = await saveFile(target, draft, token)
    setStatus(ok ? 'saved' : 'error')
    if (ok) {
      setEditor({ draft, baseline: draft, conflict: false })
    }
  }

  const reload = (): void => {
    if (fileText === undefined) return
    setEditor({ draft: fileText, baseline: fileText, conflict: false })
    setStatus('idle')
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={headerRow}>
        <span style={heading}>{title}</span>
        {fileText !== undefined ? <Counter lines={lines} cap={cap} /> : null}
      </div>
      <div style={purposeStyle}>{purpose}</div>
      {rules !== undefined ? <div style={meRulesStyle}>{rules}</div> : null}
      {fileText === undefined ? (
        <div style={{ ...muted, paddingBottom: 4 }}>
          {createLabel ?? 'no file'}
          {createLabel !== undefined ? (
            <div>
              <button
                type="button"
                title={createTitle}
                style={buttonStyle}
                onClick={() => {
                  void saveFile(target, createSeed).then((ok) => {
                    if (ok) setStatus('saved')
                  })
                }}
              >
                Create
              </button>
              {status === 'saved' ? <span style={{ ...muted, marginLeft: 8 }}>created</span> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <textarea
            style={{ ...textareaStyle, minHeight: editorHeight(lines, cap) }}
            value={draft ?? ''}
            spellCheck={false}
            onChange={(event) => {
              const value = event.target.value
              setEditor((prev) => ({ ...prev, draft: value }))
              if (status !== 'idle') setStatus('idle')
            }}
          />
          {atOrOver ? (
            <div
              title="at cap — adding a line means removing one"
              style={{ ...muted, marginTop: 4, color: 'var(--dsh-color-warning, #d97706)' }}
            >
              at cap — adding a line means removing one
            </div>
          ) : null}
          {conflict ? (
            <div style={{ ...muted, marginTop: 6, color: 'var(--dsh-color-warning, #d97706)' }}>
              changed on disk —{' '}
              <button type="button" style={{ ...buttonStyle, marginTop: 0, display: 'inline', padding: '0 6px' }} onClick={reload}>
                reload
              </button>
              {' / '}
              <button
                type="button"
                style={{ ...buttonStyle, marginTop: 0, display: 'inline', padding: '0 6px' }}
                onClick={() => { void save(mtimeRef.current) }}
              >
                overwrite
              </button>
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
function InboxLineRow({
  line,
  cwd,
  projectKey,
}: {
  line: InboxLinePayload
  cwd: string
  projectKey: string
}): ReactNode {
  const { deleteInboxLine } = useMemory()
  const parsed = parseInboxLine(line.text)
  const chip = parsed.key !== null ? projectChip(parsed.key, cwd, projectKey) : null
  const when = parsed.time !== null ? relativeTime(parsed.time) : null
  return (
    <div style={inboxRowStyle} title={line.text}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          {when !== null ? <span style={{ ...muted, fontSize: 10.5 }}>{when}</span> : null}
          {chip !== null ? (
            <span style={chipStyle} title={parsed.key ?? undefined}>{chip}</span>
          ) : null}
        </div>
        <div style={inboxTextStyle}>{parsed.body}</div>
      </div>
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

/** The M3 compliance strip: plain-language rate + current session (REVIEW-01 R4/R7). */
function ComplianceStrip(): ReactNode {
  const { snapshot } = useMemory()
  const compliance = snapshot.compliance
  if (compliance === null) return null
  const history = compliance.history
  if (history === undefined || history.total <= 0) return null

  const rate =
    `Agent checked your project memory before editing files: ${history.compliant} of ${history.total} sessions.`
  let current: string
  if (compliance.sessionId === null) current = 'Current session: not tracked'
  else if (compliance.compliant === true) current = 'Current session: yes'
  else if (compliance.compliant === false) current = 'Current session: no — it edited first'
  else current = 'Current session: not needed yet'

  return (
    <div
      style={stripStyle}
      title="A session is compliant when the agent read your project MEMORY.md before editing files. Observation only — never blocks."
    >
      <MemoryIcon size={13} />
      <span>
        {rate} {current}
      </span>
    </div>
  )
}

/** Collapsible "What is this?" (exact copy from REVIEW-01 R4). */
function WhatIsThis(): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        style={{ ...buttonStyle, marginTop: 0, padding: '2px 8px', fontSize: 11.5 }}
        onClick={() => { setOpen((v) => !v) }}
        aria-expanded={open}
      >
        {open ? 'What is this? ▾' : 'What is this? ▸'}
      </button>
      {open ? (
        <div style={{ ...purposeStyle, marginTop: 6, marginBottom: 0 }}>
          Memento gives new sessions a warm start. ME.md and the project file below are pasted into the beginning of every new chat, so the agent already knows them. Nothing else in this pane is sent automatically.
        </div>
      ) : null}
    </div>
  )
}

/** Master on/off toggle in the pane header (REVIEW-01 R2). */
function EnableToggle({ enabled }: { enabled: boolean }): ReactNode {
  const { setEnabled } = useMemory()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      style={{ ...buttonStyle, marginTop: 0, marginLeft: 'auto', padding: '2px 10px' }}
      disabled={busy}
      title={enabled
        ? 'Disable Memento (creates ~/.dsh/memory/.off). Stops inject, capture, and compliance tracking.'
        : 'Enable Memento (removes ~/.dsh/memory/.off).'}
      onClick={() => {
        setBusy(true)
        void setEnabled(!enabled).finally(() => { setBusy(false) })
      }}
    >
      {enabled ? 'On' : 'Off'}
    </button>
  )
}

/** Collapsed-by-default inject text (REVIEW-01 R3). Verbatim bytes, no reformat. */
function InjectPreview({ text, enabled }: { text: string; enabled: boolean }): ReactNode {
  const [open, setOpen] = useState(false)
  const label = !enabled
    ? 'Would be sent at session start (currently disabled)'
    : 'Sent to the model at the start of this session'
  return (
    <section style={{ display: 'flex', flexDirection: 'column' }}>
      <button
        type="button"
        style={{ ...buttonStyle, marginTop: 0, padding: '2px 8px', fontSize: 11.5, alignSelf: 'stretch', textAlign: 'left' }}
        onClick={() => { setOpen((v) => !v) }}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {label}
        {text.length === 0 ? ' (nothing)' : ` (${text.length} chars)`}
      </button>
      {open ? (
        <pre
          style={{
            ...textareaStyle,
            marginTop: 6,
            minHeight: 60,
            maxHeight: 220,
            overflow: 'auto',
            resize: 'vertical',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text.length > 0 ? text : '(empty)'}
        </pre>
      ) : null}
    </section>
  )
}

/** The pane: help + ME.md + project + inbox + inject preview + compliance. */
export function MemoryBody(): ReactNode {
  const { snapshot } = useMemory()
  const state: StatePayload | null = snapshot.state
  return (
    <div style={box}>
      {state === null ? (
        <div style={muted}>loading memory…{snapshot.error !== null ? ` (${snapshot.error})` : ''}</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <WhatIsThis />
            <EnableToggle enabled={state.enabled} />
          </div>
          {!state.enabled ? (
            <div style={{ ...stripStyle, color: 'var(--dsh-color-warning, #d97706)' }}>
              Memento is off. New sessions get no memory warm-start, "Remember this:" is ignored, and ritual tracking is paused. The files below stay readable and editable.
            </div>
          ) : null}
          <EditSection
            title={<>ME.md</>}
            purpose="Injected into every new session, everywhere. Keep it to things that stay true: who you are, how you work, hard constraints."
            rules={'never record what `rg` can find · must still be true in three months · if you had to say it twice'}
            cap={state.me.cap}
            fileText={state.me.exists ? state.me.text : undefined}
            mtimeMs={state.me.mtimeMs}
            target="me"
          />
          <EditSection
            title={
              <span title={state.project.key}>
                Project <span style={{ fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 12 }}>{shortPath(state.project.cwd)}</span>
              </span>
            }
            purpose={`Injected only when you work in ${state.project.cwd}. Decisions, gotchas and conventions that are not obvious from the code.`}
            cap={state.project.cap}
            fileText={state.project.exists ? state.project.text : undefined}
            mtimeMs={state.project.mtimeMs}
            createLabel={state.project.exists ? undefined : 'no project memory'}
            createTitle="Creates the file. It stays empty until you write something."
            createSeed={PROJECT_CREATE_SEED}
            target="project"
          />
          <section style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={headerRow}>
              <span style={heading}>Inbox</span>
              <span style={muted}>
                {state.inbox.total === 0 ? 'empty' : `${state.inbox.total} total · newest ${state.inbox.lines.length} shown`}
              </span>
            </div>
            <div style={purposeStyle}>
              A scratch list — <strong>nothing here is sent to the agent</strong>. Saying &apos;Remember this: …&apos; in chat lands a line here. To make it stick, copy the line up into ME.md or the project file.
            </div>
            {state.inbox.total === 0 ? (
              <div style={muted}>nothing captured yet — &quot;Remember this: …&quot; or the memory_remember tool lands here</div>
            ) : (
              <>
                {state.inbox.lines.map((line) => (
                  <InboxLineRow
                    key={line.n}
                    line={line}
                    cwd={state.project.cwd}
                    projectKey={state.project.key}
                  />
                ))}
                <div style={{ ...muted, marginTop: 4 }}>
                  delete removes only that line · copy a line up into ME.md or the project memory to promote it
                </div>
              </>
            )}
          </section>
          <InjectPreview text={state.inject.text} enabled={state.enabled} />
          <ComplianceStrip />
        </>
      )}
      {snapshot.error !== null ? (
        <div style={{ ...muted, color: 'var(--dsh-color-error, #dc2626)' }}>{snapshot.error}</div>
      ) : null}
    </div>
  )
}
