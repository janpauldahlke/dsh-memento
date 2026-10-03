// src/shared/reconcile.ts
function adoptFileText(fileText, state) {
  if (fileText === void 0) {
    return { draft: state.draft, baseline: state.baseline, conflict: false };
  }
  const dirty = state.draft !== null && state.baseline !== void 0 && state.draft !== state.baseline;
  if (state.draft === null || !dirty) {
    return { draft: fileText, baseline: fileText, conflict: false };
  }
  if (fileText !== state.baseline) {
    return { draft: state.draft, baseline: state.baseline, conflict: true };
  }
  return { draft: state.draft, baseline: state.baseline, conflict: false };
}
export {
  adoptFileText
};
//# sourceMappingURL=reconcile.js.map
