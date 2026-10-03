// src/shared/promote.ts
function inboxFact(line) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}) \[([^\]]+)\] ([\s\S]*)$/.exec(line);
  if (match === null) return line;
  return match[3];
}
function appendPromoteToDraft(draft, fact) {
  const body = fact.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
  if (body.length === 0) return draft;
  if (draft.length === 0) return `${body}
`;
  const base = draft.endsWith("\n") ? draft : `${draft}
`;
  return `${base}${body}
`;
}
function draftContainsFact(draft, fact) {
  const needle = fact.replace(/\r\n/g, "\n").replace(/\n+$/g, "").trim();
  if (needle.length === 0) return false;
  return draft.includes(needle);
}
export {
  appendPromoteToDraft,
  draftContainsFact,
  inboxFact
};
//# sourceMappingURL=promote.js.map
