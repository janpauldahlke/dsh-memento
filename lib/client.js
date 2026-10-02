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

// src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var MemoryBody = () => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
  "div",
  {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      padding: 24,
      color: "var(--dsh-color-text-muted, #888)",
      fontSize: 13
    },
    children: [
      TAB_TITLE,
      " \u2014 no content yet (M0)"
    ]
  }
);
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
      description: () => "Bounded-file memory: ME.md, project MEMORY.md, inbox (stub)"
    }]
  };
  const disposeType = ctx.sidebarRightTabs.register(definition);
  const disposeBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab", key: TAB_ID },
    MemoryBody
  ));
  ctx.effect(() => () => {
    disposeBody();
    disposeType();
  }, "memento: rightbar tab type");
}
return module.exports; } });
//# sourceMappingURL=client.js.map
