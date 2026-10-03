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
      saveFile: async (target, content) => {
        try {
          const { status, body } = await fetchJson(`${API_BASE}/file`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ target, content })
          });
          const payload = body;
          if (status === 200 && payload !== null && payload.ok === true) {
            await pollAll();
            return true;
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
function countLines(text) {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.charCodeAt(text.length - 1) !== 10) n++;
  return n;
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
  marginBottom: 6
};
var heading = {
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 6
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
  padding: "2px 0"
};
var inboxTextStyle = {
  flex: 1,
  fontFamily: "var(--dsh-font-mono, monospace)",
  fontSize: 11.5,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word"
};
function Counter({ lines, cap }) {
  const atOrOver = lines >= cap;
  const over = lines > cap;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "span",
    {
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
function EditSection({ title, cap, fileText, createLabel, minHeight, target }) {
  const { snapshot, saveFile } = useMemory();
  const [draft, setDraft] = (0, import_react2.useState)(null);
  const [status, setStatus] = (0, import_react2.useState)("idle");
  (0, import_react2.useEffect)(() => {
    if (fileText === void 0) return;
    setDraft((current) => current === null ? fileText : current);
  }, [fileText]);
  const lines = draft === null ? 0 : countLines(draft);
  const atOrOver = lines >= cap;
  const dirty = draft !== null && fileText !== void 0 && draft !== fileText;
  const save = async () => {
    if (draft === null) return;
    setStatus("saving");
    const ok = await saveFile(target, draft);
    setStatus(ok ? "saved" : "error");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: headerRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: heading, children: title }),
      fileText !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Counter, { lines, cap }) : null
    ] }),
    fileText === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...muted, paddingBottom: 4 }, children: [
      createLabel ?? "no file",
      createLabel !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: buttonStyle, onClick: () => {
          void saveFile(target, "").then((ok) => {
            if (ok) setStatus("saved");
          });
        }, children: "Create" }),
        status === "saved" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...muted, marginLeft: 8 }, children: "created" }) : null
      ] }) : null
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "textarea",
        {
          style: { ...textareaStyle, minHeight },
          value: draft ?? "",
          spellCheck: false,
          onChange: (event) => {
            setDraft(event.target.value);
            if (status !== "idle") setStatus("idle");
          }
        }
      ),
      atOrOver ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...muted, marginTop: 4, color: "var(--dsh-color-warning, #d97706)" }, children: "at cap \u2014 adding a line means removing one" }) : null,
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
function InboxLineRow({ line }) {
  const { deleteInboxLine } = useMemory();
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: inboxRowStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: inboxTextStyle, children: line.text }),
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
  const rate = history !== void 0 && history.total > 0 ? `${history.compliant}/${history.total} sessions` : "no sessions logged";
  let current;
  if (compliance.sessionId === null) current = "no session tracked";
  else if (compliance.compliant === true) current = "this session: compliant";
  else if (compliance.compliant === false) current = "this session: non-compliant";
  else current = "this session: no ritual required";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: stripStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MemoryIcon, { size: 13 }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
      "ritual: ",
      rate,
      " \xB7 ",
      current
    ] })
  ] });
}
function MemoryBody() {
  const { snapshot } = useMemory();
  const state = snapshot.state;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: box, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ComplianceStrip, {}),
    state === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: muted, children: [
      "loading memory\u2026",
      snapshot.error !== null ? ` (${snapshot.error})` : ""
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        EditSection,
        {
          title: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_jsx_runtime2.Fragment, { children: "ME.md" }),
          cap: state.me.cap,
          fileText: state.me.exists ? state.me.text : void 0,
          minHeight: 90,
          target: "me"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        EditSection,
        {
          title: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            "Project ",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontFamily: "var(--dsh-font-mono, monospace)", fontSize: 12 }, children: state.project.key })
          ] }),
          cap: state.project.cap,
          fileText: state.project.exists ? state.project.text : void 0,
          createLabel: state.project.exists ? void 0 : "no project memory",
          minHeight: 120,
          target: "project"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: { display: "flex", flexDirection: "column" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: headerRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: heading, children: "Inbox" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: muted, children: state.inbox.total === 0 ? "empty" : `${state.inbox.total} total \xB7 newest ${state.inbox.lines.length} shown` })
        ] }),
        state.inbox.total === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: muted, children: 'nothing captured yet \u2014 "Remember this: \u2026" or the memory_remember tool lands here' }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          state.inbox.lines.map((line) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(InboxLineRow, { line }, line.n)),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...muted, marginTop: 4 }, children: "delete removes only that line \xB7 copy a line up into ME.md or the project memory to promote it" })
        ] })
      ] })
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
