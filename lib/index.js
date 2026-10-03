// src/host/index.ts
import { cwd as processCwd } from "node:process";

// src/shared/types.ts
var PLUGIN = "dsh-memento";
var HEALTH_ROUTE = "/api/dsh-memento/health";
var STATE_ROUTE = "/api/dsh-memento/state";
var VERSION = "0.1.0";
var MILESTONE = "M1";

// src/host/vault.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var DSH_HOME_ENV = "DSH_HOME";
var DSH_HOME_DIR_NAME = ".dsh";
function resolveDshHome(env = process.env) {
  const fromEnv = env[DSH_HOME_ENV];
  const selected = fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv.trim() : join(homedir(), DSH_HOME_DIR_NAME);
  let expanded = selected;
  if (expanded === "~") expanded = homedir();
  else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) expanded = join(homedir(), expanded.slice(2));
  return resolve(expanded);
}
var ME_CAP = 30;
var PROJECT_CAP = 45;
var INJECT_BUDGET = 4e3;
var MEMORY_DIR_NAME = "memory";
var PROJECTS_DIR_NAME = "projects";
var ME_FILE_NAME = "ME.md";
var MEMORY_FILE_NAME = "MEMORY.md";
function projectKey(cwd) {
  if (cwd.length === 0) throw new Error("cannot encode an empty project path");
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/, "") || "root";
  return `--${slug.slice(0, 251)}--`;
}
function countLines(text) {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.charCodeAt(text.length - 1) !== 10) n++;
  return n;
}
function vaultPaths(dshHome, key) {
  const root = join(dshHome, MEMORY_DIR_NAME);
  const projectsDir = join(root, PROJECTS_DIR_NAME);
  return {
    root,
    projectsDir,
    me: join(root, ME_FILE_NAME),
    project: join(projectsDir, key, MEMORY_FILE_NAME)
  };
}
function bootstrapVault(dshHome, templateText) {
  const paths = vaultPaths(dshHome, "");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.projectsDir, { recursive: true });
  let created = false;
  if (!existsSync(paths.me)) {
    writeFileSync(paths.me, templateText, "utf8");
    created = true;
  }
  return { created, mePath: paths.me, root: paths.root };
}
function readVaultFile(path, cap) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = void 0;
  }
  const lines = text === void 0 ? 0 : countLines(text);
  return {
    path,
    exists: text !== void 0,
    ...text !== void 0 ? { text } : {},
    lines,
    cap,
    overCap: lines > cap
  };
}
function readVault(dshHome, key) {
  const paths = vaultPaths(dshHome, key);
  return {
    me: readVaultFile(paths.me, ME_CAP),
    project: readVaultFile(paths.project, PROJECT_CAP),
    key
  };
}
function buildInjectBlock(state) {
  const meText = state.me.text;
  if (meText === void 0) return { block: "", chars: 0, truncated: false };
  const projectText = state.project.text;
  if (projectText === void 0 || projectText.length === 0) {
    return { block: meText, chars: meText.length, truncated: false };
  }
  const separator = meText.endsWith("\n") ? "" : "\n";
  const full = `${meText}${separator}${projectText}`;
  if (full.length <= INJECT_BUDGET) {
    return { block: full, chars: full.length, truncated: false };
  }
  return { block: meText, chars: meText.length, truncated: true };
}

// src/host/inject.ts
import { randomUUID } from "node:crypto";
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function createMementoUserMessage(content, source) {
  return deepFreeze(structuredClone({
    id: randomUUID(),
    role: "user",
    content: [...content],
    source
  }));
}
function noMessage() {
  return createMementoUserMessage([], {
    kind: "dsh-memento",
    form: "memory-baseline",
    version: 1,
    key: "",
    meLines: 0,
    projectLines: 0,
    truncated: false
  });
}
function alreadyInHistory(session) {
  for (const seq of [...session.surface.nodes].reverse()) {
    const event = session.eventAt(seq);
    if (event?.type === "user/message" && event.data.source?.kind === "dsh-memento") {
      return true;
    }
  }
  return false;
}
function installSessionStartInject(ctx, prepare) {
  const bySession = /* @__PURE__ */ new WeakMap();
  const recordFailure = (session, error) => {
    bySession.set(session, { message: noMessage(), delivered: true, failed: true });
    try {
      ctx.logger?.("dsh-memento")?.warn("session-start inject skipped: %s", error instanceof Error ? error.message : String(error));
    } catch {
    }
  };
  ctx.on("agent/pre-step", async (args, next) => {
    const decision = await next();
    if (decision.kind !== "enter" || decision.messages.length === 0) return decision;
    const session = args.agent.session;
    try {
      let state = bySession.get(session);
      if (state === void 0) {
        const cwd = session.header.cwd;
        if (typeof cwd !== "string" || cwd.length === 0) {
          recordFailure(session, "session header has no cwd");
          return decision;
        }
        const prepared = prepare(projectKey(cwd));
        if (prepared === void 0 || prepared.block.block.length === 0) {
          recordFailure(session, "vault has nothing to inject (absent or unreadable)");
          return decision;
        }
        state = { message: prepared.message, delivered: false, failed: false };
        bySession.set(session, state);
        if (alreadyInHistory(session)) state.delivered = true;
      }
      if (state.delivered || state.failed) return decision;
      const lastClaimedIndex = decision.messages.findLastIndex((message) => args.messages.includes(message));
      const anchor = lastClaimedIndex < 0 ? 0 : lastClaimedIndex + 1;
      const messages = decision.messages.slice();
      messages.splice(anchor, 0, state.message);
      state.delivered = true;
      return { ...decision, messages };
    } catch (error) {
      recordFailure(session, error);
      return decision;
    }
  });
}

// assets/ME.template.md
var ME_template_default = "# ME \u2014 operator profile (cap: 30 lines, hand-edited only)\n<!-- Rules: 1) never record what `rg` can find  2) must still be true in 3 months\n     3) if you had to say it twice, it belongs here -->\n\n- Jan Dahlke (`janpauldahlke`), solo developer. Author of Eris (Rust, Apache 2.0).\n- Sacred ports: never bounce :3080 (dsh web), :8080 (llama), :11434 (ollama).\n- Local-only agents. Small models. Precision over recall in every prompt.\n- Prefers: direct answers, no fluff, peer tone, no test theater.\n";

// src/host/index.ts
var name = PLUGIN;
var inject = [];
var DSH_HOME = resolveDshHome();
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function registerHealthRoute(ctx) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: HEALTH_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "GET") {
            send(res, 405, { ok: false, error: "method not allowed; use GET" });
            return;
          }
          const payload = {
            ok: true,
            plugin: PLUGIN,
            version: VERSION,
            milestone: MILESTONE
          };
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: health route");
}
function registerStateRoute(ctx) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: STATE_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "GET") {
            send(res, 405, { ok: false, error: "method not allowed; use GET" });
            return;
          }
          const key = projectKey(processCwd());
          const state = readVault(DSH_HOME, key);
          const block = buildInjectBlock(state);
          const payload = {
            ok: true,
            me: {
              path: state.me.path,
              lines: state.me.lines,
              cap: state.me.cap,
              overCap: state.me.overCap,
              exists: state.me.exists
            },
            project: {
              key,
              path: state.project.path,
              lines: state.project.lines,
              cap: state.project.cap,
              overCap: state.project.overCap,
              exists: state.project.exists
            },
            inject: {
              chars: block.chars,
              budget: INJECT_BUDGET,
              truncated: block.truncated
            }
          };
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: state route");
}
function bootstrap(ctx) {
  try {
    const result = bootstrapVault(DSH_HOME, ME_template_default);
    ctx.logger?.("dsh-memento").info("vault ready at %s (ME.md %s)", result.root, result.created ? "created from template" : "already present");
  } catch (error) {
    ctx.logger?.("dsh-memento").warn("vault bootstrap failed (continuing without vault): %s", errorMessage(error));
  }
}
function prepareInject(key) {
  const state = readVault(DSH_HOME, key);
  const block = buildInjectBlock(state);
  if (block.block.length === 0) return void 0;
  const message = createMementoUserMessage(
    [{ type: "text", text: block.block }],
    {
      kind: "dsh-memento",
      form: "memory-baseline",
      version: 1,
      key,
      meLines: state.me.lines,
      projectLines: state.project.lines,
      truncated: block.truncated
    }
  );
  return { message, block };
}
function installInject(ctx) {
  try {
    const prepare = (key) => prepareInject(key);
    installSessionStartInject(ctx, prepare);
  } catch (error) {
    ctx.logger?.("dsh-memento").warn("session-start inject install failed (continuing without inject): %s", errorMessage(error));
  }
}
function apply(ctx) {
  bootstrap(ctx);
  installInject(ctx);
  ctx.inject(["webServer"], (webCtx) => {
    try {
      registerHealthRoute(webCtx);
      registerStateRoute(webCtx);
    } catch (error) {
      webCtx.logger?.("dsh-memento").error("route registration failed: %s", errorMessage(error));
    }
  });
}
export {
  HEALTH_ROUTE,
  STATE_ROUTE,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
