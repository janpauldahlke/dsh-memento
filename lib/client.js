window.__ModuleLoader__.load({ id: "dsh-memento", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/shared/types.ts
var TAB_ID = "dsh-memento";
var TAB_KIND = "memento";
var TAB_TITLE = "Memory";

// src/client/MemoryBody.tsx
var import_react2 = require("react");

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

// src/client/useMemory.ts
var import_react = require("react");

// src/client/store.ts
var MemoryStore = class {
  snapshot = {
    state: null,
    compliance: null,
    error: null,
    lastUpdated: null
  };
  listeners = /* @__PURE__ */ new Set();
  /** Stable for `useSyncExternalStore`. */
  getSnapshot = () => this.snapshot;
  /** Stable for `useSyncExternalStore`; returns the unsubscribe. */
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  emit(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
  /** Record a `GET /state` result (success keeps the payload, failure keeps the last good one). */
  onState(payload, error) {
    const patch = { error };
    if (payload !== null) {
      patch.state = payload;
      patch.lastUpdated = Date.now();
    }
    this.emit(patch);
  }
  /** Record a `GET /compliance` result (same contract as onState). */
  onCompliance(payload, error) {
    const patch = { error };
    if (payload !== null) {
      patch.compliance = payload;
      patch.lastUpdated = Date.now();
    }
    this.emit(patch);
  }
};
var memoryStore = new MemoryStore();

// src/client/useMemory.ts
var API_BASE = "/api/dsh-memento";
var POLL_MS = 4e3;
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function fetchJson(url, init) {
  const response = await fetch(url, { cache: "no-store", ...init });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}
async function pollState() {
  try {
    const { status, body } = await fetchJson(`${API_BASE}/state`);
    const payload = body;
    if (status === 200 && payload !== null && payload.ok === true) {
      memoryStore.onState(payload, null);
    } else {
      memoryStore.onState(null, `state: HTTP ${status}`);
    }
  } catch (error) {
    memoryStore.onState(null, `state: ${errorMessage(error)}`);
  }
}
async function pollCompliance() {
  try {
    const { status, body } = await fetchJson(`${API_BASE}/compliance`);
    const payload = body;
    if (status === 200 && payload !== null && payload.ok === true) {
      memoryStore.onCompliance(payload, null);
    } else {
      memoryStore.onCompliance(null, `compliance: HTTP ${status}`);
    }
  } catch (error) {
    memoryStore.onCompliance(null, `compliance: ${errorMessage(error)}`);
  }
}
var inFlight = false;
async function pollAll() {
  if (inFlight) return;
  inFlight = true;
  try {
    await Promise.allSettled([pollState(), pollCompliance()]);
  } finally {
    inFlight = false;
  }
}
var subscribers = 0;
var timer = null;
function startPolling() {
  subscribers += 1;
  if (timer === null) {
    void pollAll();
    timer = setInterval(() => {
      void pollAll();
    }, POLL_MS);
  }
}
function stopPolling() {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
function useMemory() {
  const snapshot = (0, import_react.useSyncExternalStore)(memoryStore.subscribe, memoryStore.getSnapshot, memoryStore.getSnapshot);
  (0, import_react.useEffect)(() => {
    startPolling();
    return () => {
      stopPolling();
    };
  }, []);
  return (0, import_react.useMemo)(
    () => ({
      snapshot,
      refresh: () => {
        void pollAll();
      },
      saveFile: async (target, content, mtimeMs) => {
        try {
          const body = { target, content };
          if (mtimeMs !== void 0) body.mtimeMs = mtimeMs;
          const { status, body: responseBody } = await fetchJson(`${API_BASE}/file`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          });
          const payload = responseBody;
          if (status === 200 && payload !== null && payload.ok === true) {
            await pollAll();
            return true;
          }
          if (status === 409) {
            memoryStore.onState(snapshot.state, "changed on disk \u2014 reload or overwrite");
            await pollAll();
            return false;
          }
          memoryStore.onState(snapshot.state, payload?.error ?? `save: HTTP ${status}`);
          return false;
        } catch (error) {
          memoryStore.onState(snapshot.state, `save: ${errorMessage(error)}`);
          return false;
        }
      },
      deleteInboxLine: async (n) => {
        try {
          const { status, body } = await fetchJson(`${API_BASE}/inbox/line/${n}`, { method: "DELETE" });
          const payload = body;
          if (status === 200 && payload !== null && payload.ok === true) {
            await pollAll();
            return payload.removed === true;
          }
          memoryStore.onState(snapshot.state, payload?.error ?? `delete: HTTP ${status}`);
          return false;
        } catch (error) {
          memoryStore.onState(snapshot.state, `delete: ${errorMessage(error)}`);
          return false;
        }
      },
      setEnabled: async (enabled) => {
        try {
          const { status, body } = await fetchJson(`${API_BASE}/enabled`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled })
          });
          const payload = body;
          if (status === 200 && payload !== null && payload.ok === true) {
            await pollAll();
            return true;
          }
          memoryStore.onState(snapshot.state, payload?.error ?? `enabled: HTTP ${status}`);
          return false;
        } catch (error) {
          memoryStore.onState(snapshot.state, `enabled: ${errorMessage(error)}`);
          return false;
        }
      }
    }),
    [snapshot]
  );
}

// src/client/MemoryIcon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function MemoryIcon({ size = 16, className, style }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
      className,
      style,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "M7.5 3.1C6.2 2.4 4.5 2.2 3 2.5V12.5C4.5 12.2 6.2 12.4 7.5 13.1",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "M8.5 3.1C9.8 2.4 11.5 2.2 13 2.5V12.5C11.5 12.2 9.8 12.4 8.5 13.1",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 2.8V13.4", stroke: "currentColor", strokeLinecap: "round" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M11 4.2V8.4L10 7.8L9 8.4V4.2Z", fill: "currentColor" })
      ]
    }
  );
}

// src/client/MemoryBody.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var PROJECT_CREATE_SEED = "# MEMORY \u2014 project lore (cap: 45 lines, hand-edited only)\n<!-- Rules: 1) never record what `rg` can find  2) must still be true in 3 months\n     3) if you had to say it twice, it belongs here -->\n";
function countLines(text) {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.charCodeAt(text.length - 1) !== 10) n++;
  return n;
}
function shortPath(cwd) {
  if (cwd.startsWith("/home/")) {
    const slash = cwd.indexOf("/", 6);
    if (slash > 0) return `~${cwd.slice(slash)}`;
  }
  return cwd;
}
function parseInboxLine(text) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}) \[([^\]]+)\] ([\s\S]*)$/.exec(text);
  if (match === null) return { time: null, key: null, body: text };
  return { time: match[1], key: match[2], body: match[3] };
}
function relativeTime(iso, nowMs = Date.now()) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const delta = Math.max(0, nowMs - ms);
  const sec = Math.floor(delta / 1e3);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
function projectChip(key, cwd, currentKey) {
  if (key === currentKey && cwd !== void 0) {
    const base = cwd.split("/").filter(Boolean).pop();
    return base ?? shortPath(cwd);
  }
  const slug = key.replace(/^--/, "").replace(/--$/, "");
  const parts = slug.split("-").filter(Boolean);
  if (parts.length === 0) return key;
  return parts.length <= 2 ? parts.join("-") : parts.slice(-2).join("-");
}
function editorHeight(lines, cap) {
  const linePx = 18;
  const pad = 16;
  const shown = Math.min(Math.max(lines, 4), cap);
  return shown * linePx + pad;
}
var box = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  height: "100%",
  overflowY: "auto",
  padding: "12px 14px",
  fontSize: 13,
  color: "inherit"
};
var headerRow = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  marginBottom: 4
};
var heading = {
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 6
};
var purposeStyle = {
  color: "var(--dsh-color-text-muted, #8a8a8a)",
  fontSize: 11.5,
  lineHeight: 1.4,
  marginBottom: 6
};
var counter = {
  marginLeft: "auto",
  fontSize: 12,
  fontFamily: "var(--dsh-font-mono, monospace)"
};
var textareaStyle = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--dsh-font-mono, monospace)",
  fontSize: 12,
  lineHeight: 1.5,
  padding: 8,
  borderRadius: 4,
  border: "1px solid var(--dsh-color-border, #3a3a3a)",
  background: "var(--dsh-color-bg-subtle, rgba(255,255,255,0.03))",
  color: "inherit",
  resize: "vertical",
  whiteSpace: "pre",
  tabSize: 2
};
var buttonStyle = {
  alignSelf: "flex-start",
  marginTop: 6,
  padding: "3px 12px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid var(--dsh-color-border, #4a4a4a)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer"
};
var muted = {
  color: "var(--dsh-color-text-muted, #8a8a8a)",
  fontSize: 12
};
var stripStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  padding: "4px 8px",
  borderRadius: 4,
  border: "1px solid var(--dsh-color-border, #3a3a3a)",
  color: "var(--dsh-color-text-muted, #9a9a9a)"
};
var inboxRowStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  padding: "4px 0"
};
var chipStyle = {
  flexShrink: 0,
  fontSize: 10.5,
  lineHeight: "16px",
  padding: "0 5px",
  borderRadius: 3,
  border: "1px solid var(--dsh-color-border, #3a3a3a)",
  color: "var(--dsh-color-text-muted, #8a8a8a)",
  maxWidth: 96,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};
var inboxTextStyle = {
  flex: 1,
  fontSize: 12,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word"
};
var meRulesStyle = {
  ...muted,
  fontSize: 11,
  lineHeight: 1.4,
  marginBottom: 6
};
function Counter({ lines, cap }) {
  const atOrOver = lines >= cap;
  const over = lines > cap;
  const title = `${lines} of ${cap} lines used. The limit is deliberate: a short file gets read, a long one gets skimmed. At the limit, add a line by removing one.`;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "span",
    {
      title,
      style: {
        ...counter,
        color: over ? "var(--dsh-color-error, #dc2626)" : atOrOver ? "var(--dsh-color-warning, #d97706)" : void 0
      },
      children: [
        lines,
        " / ",
        cap
      ]
    }
  );
}
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
  createSeed = ""
}) {
  const { saveFile } = useMemory();
  const [editor, setEditor] = (0, import_react2.useState)(() => adoptFileText(fileText, {
    draft: null,
    baseline: void 0,
    conflict: false
  }));
  const [status, setStatus] = (0, import_react2.useState)("idle");
  const mtimeRef = (0, import_react2.useRef)(mtimeMs);
  mtimeRef.current = mtimeMs;
  (0, import_react2.useEffect)(() => {
    setEditor((prev) => adoptFileText(fileText, prev));
  }, [fileText]);
  const { draft, baseline, conflict } = editor;
  const lines = draft === null ? 0 : countLines(draft);
  const atOrOver = lines >= cap;
  const dirty = draft !== null && baseline !== void 0 && draft !== baseline;
  const save = async (forceMtime) => {
    if (draft === null) return;
    setStatus("saving");
    const token = forceMtime ?? mtimeRef.current;
    const ok = await saveFile(target, draft, token);
    setStatus(ok ? "saved" : "error");
    if (ok) {
      setEditor({ draft, baseline: draft, conflict: false });
    }
  };
  const reload = () => {
    if (fileText === void 0) return;
    setEditor({ draft: fileText, baseline: fileText, conflict: false });
    setStatus("idle");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: headerRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: heading, children: title }),
      fileText !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Counter, { lines, cap }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: purposeStyle, children: purpose }),
    rules !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: meRulesStyle, children: rules }) : null,
    fileText === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...muted, paddingBottom: 4 }, children: [
      createLabel ?? "no file",
      createLabel !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            title: createTitle,
            style: buttonStyle,
            onClick: () => {
              void saveFile(target, createSeed).then((ok) => {
                if (ok) setStatus("saved");
              });
            },
            children: "Create"
          }
        ),
        status === "saved" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...muted, marginLeft: 8 }, children: "created" }) : null
      ] }) : null
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "textarea",
        {
          style: { ...textareaStyle, minHeight: editorHeight(lines, cap) },
          value: draft ?? "",
          spellCheck: false,
          onChange: (event) => {
            const value = event.target.value;
            setEditor((prev) => ({ ...prev, draft: value }));
            if (status !== "idle") setStatus("idle");
          }
        }
      ),
      atOrOver ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "div",
        {
          title: "at cap \u2014 adding a line means removing one",
          style: { ...muted, marginTop: 4, color: "var(--dsh-color-warning, #d97706)" },
          children: "at cap \u2014 adding a line means removing one"
        }
      ) : null,
      conflict ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...muted, marginTop: 6, color: "var(--dsh-color-warning, #d97706)" }, children: [
        "changed on disk \u2014",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: { ...buttonStyle, marginTop: 0, display: "inline", padding: "0 6px" }, onClick: reload, children: "reload" }),
        " / ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            style: { ...buttonStyle, marginTop: 0, display: "inline", padding: "0 6px" },
            onClick: () => {
              void save(mtimeRef.current);
            },
            children: "overwrite"
          }
        )
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "button",
        {
          type: "button",
          style: { ...buttonStyle, opacity: dirty || status === "error" ? 1 : 0.55 },
          disabled: status === "saving" || !dirty,
          onClick: () => {
            void save();
          },
          children: status === "saving" ? "saving\u2026" : status === "saved" ? "saved \u2713" : "Save"
        }
      ),
      status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...muted, marginTop: 4, color: "var(--dsh-color-error, #dc2626)" }, children: "save failed \u2014 see status line" }) : null
    ] })
  ] });
}
function InboxLineRow({
  line,
  cwd,
  projectKey
}) {
  const { deleteInboxLine } = useMemory();
  const parsed = parseInboxLine(line.text);
  const chip = parsed.key !== null ? projectChip(parsed.key, cwd, projectKey) : null;
  const when = parsed.time !== null ? relativeTime(parsed.time) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: inboxRowStyle, title: line.text, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }, children: [
        when !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...muted, fontSize: 10.5 }, children: when }) : null,
        chip !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: chipStyle, title: parsed.key ?? void 0, children: chip }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: inboxTextStyle, children: parsed.body })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        type: "button",
        "aria-label": `delete inbox line ${line.n}`,
        title: `delete line ${line.n}`,
        style: {
          ...buttonStyle,
          marginTop: 0,
          padding: "0 6px",
          lineHeight: "18px",
          fontSize: 12,
          color: "var(--dsh-color-text-muted, #8a8a8a)"
        },
        onClick: () => {
          void deleteInboxLine(line.n);
        },
        children: "\xD7"
      }
    )
  ] });
}
function ComplianceStrip() {
  const { snapshot } = useMemory();
  const compliance = snapshot.compliance;
  if (compliance === null) return null;
  const history = compliance.history;
  if (history === void 0 || history.total <= 0) return null;
  const rate = `Agent checked your project memory before editing files: ${history.compliant} of ${history.total} sessions.`;
  let current;
  if (compliance.sessionId === null) current = "Current session: not tracked";
  else if (compliance.compliant === true) current = "Current session: yes";
  else if (compliance.compliant === false) current = "Current session: no \u2014 it edited first";
  else current = "Current session: not needed yet";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      style: stripStyle,
      title: "A session is compliant when the agent read your project MEMORY.md before editing files. Observation only \u2014 never blocks.",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MemoryIcon, { size: 13 }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          rate,
          " ",
          current
        ] })
      ]
    }
  );
}
function WhatIsThis() {
  const [open, setOpen] = (0, import_react2.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        type: "button",
        style: { ...buttonStyle, marginTop: 0, padding: "2px 8px", fontSize: 11.5 },
        onClick: () => {
          setOpen((v) => !v);
        },
        "aria-expanded": open,
        children: open ? "What is this? \u25BE" : "What is this? \u25B8"
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...purposeStyle, marginTop: 6, marginBottom: 0 }, children: "Memento gives new sessions a warm start. ME.md and the project file below are pasted into the beginning of every new chat, so the agent already knows them. Nothing else in this pane is sent automatically." }) : null
  ] });
}
function EnableToggle({ enabled }) {
  const { setEnabled } = useMemory();
  const [busy, setBusy] = (0, import_react2.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "button",
    {
      type: "button",
      style: { ...buttonStyle, marginTop: 0, marginLeft: "auto", padding: "2px 10px" },
      disabled: busy,
      title: enabled ? "Disable Memento (creates ~/.dsh/memory/.off). Stops inject, capture, and compliance tracking." : "Enable Memento (removes ~/.dsh/memory/.off).",
      onClick: () => {
        setBusy(true);
        void setEnabled(!enabled).finally(() => {
          setBusy(false);
        });
      },
      children: enabled ? "On" : "Off"
    }
  );
}
function InjectPreview({ text, enabled }) {
  const [open, setOpen] = (0, import_react2.useState)(false);
  const label = !enabled ? "Would be sent at session start (currently disabled)" : "Sent to the model at the start of this session";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "button",
      {
        type: "button",
        style: { ...buttonStyle, marginTop: 0, padding: "2px 8px", fontSize: 11.5, alignSelf: "stretch", textAlign: "left" },
        onClick: () => {
          setOpen((v) => !v);
        },
        "aria-expanded": open,
        children: [
          open ? "\u25BE" : "\u25B8",
          " ",
          label,
          text.length === 0 ? " (nothing)" : ` (${text.length} chars)`
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "pre",
      {
        style: {
          ...textareaStyle,
          marginTop: 6,
          minHeight: 60,
          maxHeight: 220,
          overflow: "auto",
          resize: "vertical",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word"
        },
        children: text.length > 0 ? text : "(empty)"
      }
    ) : null
  ] });
}
function MemoryBody() {
  const { snapshot } = useMemory();
  const state = snapshot.state;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: box, children: [
    state === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: muted, children: [
      "loading memory\u2026",
      snapshot.error !== null ? ` (${snapshot.error})` : ""
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(WhatIsThis, {}),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EnableToggle, { enabled: state.enabled })
      ] }),
      !state.enabled ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...stripStyle, color: "var(--dsh-color-warning, #d97706)" }, children: 'Memento is off. New sessions get no memory warm-start, "Remember this:" is ignored, and ritual tracking is paused. The files below stay readable and editable.' }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        EditSection,
        {
          title: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_jsx_runtime2.Fragment, { children: "ME.md" }),
          purpose: "Injected into every new session, everywhere. Keep it to things that stay true: who you are, how you work, hard constraints.",
          rules: "never record what `rg` can find \xB7 must still be true in three months \xB7 if you had to say it twice",
          cap: state.me.cap,
          fileText: state.me.exists ? state.me.text : void 0,
          mtimeMs: state.me.mtimeMs,
          target: "me"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        EditSection,
        {
          title: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { title: state.project.key, children: [
            "Project ",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontFamily: "var(--dsh-font-mono, monospace)", fontSize: 12 }, children: shortPath(state.project.cwd) })
          ] }),
          purpose: `Injected only when you work in ${state.project.cwd}. Decisions, gotchas and conventions that are not obvious from the code.`,
          cap: state.project.cap,
          fileText: state.project.exists ? state.project.text : void 0,
          mtimeMs: state.project.mtimeMs,
          createLabel: state.project.exists ? void 0 : "no project memory",
          createTitle: "Creates the file. It stays empty until you write something.",
          createSeed: PROJECT_CREATE_SEED,
          target: "project"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: { display: "flex", flexDirection: "column" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: headerRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: heading, children: "Inbox" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: muted, children: state.inbox.total === 0 ? "empty" : `${state.inbox.total} total \xB7 newest ${state.inbox.lines.length} shown` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: purposeStyle, children: [
          "A scratch list \u2014 ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "nothing here is sent to the agent" }),
          ". Saying 'Remember this: \u2026' in chat lands a line here. To make it stick, copy the line up into ME.md or the project file."
        ] }),
        state.inbox.total === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: muted, children: 'nothing captured yet \u2014 "Remember this: \u2026" or the memory_remember tool lands here' }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          state.inbox.lines.map((line) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            InboxLineRow,
            {
              line,
              cwd: state.project.cwd,
              projectKey: state.project.key
            },
            line.n
          )),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...muted, marginTop: 4 }, children: "delete removes only that line \xB7 copy a line up into ME.md or the project memory to promote it" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(InjectPreview, { text: state.inject.text, enabled: state.enabled }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ComplianceStrip, {})
    ] }),
    snapshot.error !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...muted, color: "var(--dsh-color-error, #dc2626)" }, children: snapshot.error }) : null
  ] });
}

// src/client/MemoryTitle.tsx
var import_react3 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function MemoryTitle(_props) {
  const snapshot = (0, import_react3.useSyncExternalStore)(memoryStore.subscribe, memoryStore.getSnapshot, memoryStore.getSnapshot);
  const overCap = snapshot.state !== null && (snapshot.state.me.overCap || snapshot.state.project.overCap);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "span",
    {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: overCap ? "var(--dsh-color-warning, #d97706)" : void 0
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MemoryIcon, { size: 15 }),
        TAB_TITLE,
        overCap ? " \u26A0" : null
      ]
    }
  );
}

// src/client/index.tsx
var name = "dsh-memento";
var inject = ["slots", "sidebarRightTabs"];
function apply(ctx) {
  const definition = {
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => TAB_TITLE,
    guide: [{
      id: "memento",
      order: 270,
      title: () => TAB_TITLE,
      description: () => "Bounded-file memory: ME.md, project MEMORY.md, inbox \u2014 edit, delete, see cap pressure"
    }]
  };
  const disposeType = ctx.sidebarRightTabs.register(definition);
  const disposeBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab", key: TAB_ID },
    MemoryBody
  ));
  const disposeTitle = ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab.title", key: TAB_ID },
    MemoryTitle
  ));
  ctx.effect(() => () => {
    disposeTitle();
    disposeBody();
    disposeType();
  }, "memento: rightbar tab type");
}
return module.exports; } });
//# sourceMappingURL=client.js.map
