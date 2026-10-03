/**
 * Editor draft reconciliation (REVIEW-01 R1).
 *
 * Pure: the pane calls this when `fileText` from the poller changes. A
 * non-dirty editor adopts the disk bytes; a dirty editor keeps its draft and
 * surfaces a conflict when the baseline no longer matches disk.
 */
export interface EditorState {
  /** Current textarea contents (`null` before the first seed). */
  draft: string | null
  /** Last disk (or saved) text the draft was aligned with. */
  baseline: string | undefined
  /** Disk changed while the draft was dirty. */
  conflict: boolean
}

/**
 * Reconcile an incoming `fileText` with the editor's draft/baseline.
 * @param fileText - verbatim file contents, or `undefined` when absent.
 */
export function adoptFileText(
  fileText: string | undefined,
  state: EditorState,
): EditorState {
  if (fileText === undefined) {
    return { draft: state.draft, baseline: state.baseline, conflict: false }
  }
  const dirty =
    state.draft !== null &&
    state.baseline !== undefined &&
    state.draft !== state.baseline
  if (state.draft === null || !dirty) {
    return { draft: fileText, baseline: fileText, conflict: false }
  }
  if (fileText !== state.baseline) {
    return { draft: state.draft, baseline: state.baseline, conflict: true }
  }
  return { draft: state.draft, baseline: state.baseline, conflict: false }
}
