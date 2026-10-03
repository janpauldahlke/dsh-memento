// src/host/index.ts
import { existsSync as existsSync3, statSync as statSync4 } from "node:fs";
import { join as join8, resolve as resolve2 } from "node:path";
import { cwd as processCwd2 } from "node:process";

// src/shared/types.ts
var PLUGIN = "dsh-memento";
var HEALTH_ROUTE = "/api/dsh-memento/health";
var STATE_ROUTE = "/api/dsh-memento/state";
var CAPTURE_ROUTE = "/api/dsh-memento/capture";
var UNDO_ROUTE = "/api/dsh-memento/undo";
var COMPLIANCE_ROUTE = "/api/dsh-memento/compliance";
var FILE_ROUTE = "/api/dsh-memento/file";
var INBOX_DELETE_ROUTE = "/api/dsh-memento/inbox/line";
var VERSION = "0.6.2";
var MILESTONE = "M5";
var ENABLED_ROUTE = "/api/dsh-memento/enabled";

// src/host/vault.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// assets/ritual.md
var ritual_default = "<!-- ritual -->\nBefore your first file edit in this session, read\n`<project-file>` (if it exists). If it contradicts this chat, the file wins.\nYour memory vault is `~/.dsh/memory/` \u2014 `ME.md`, the project file, and `inbox.md`. You may read or grep it at any time; only the block above is given to you automatically.\n";

// src/host/vault.ts
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
  let mtimeMs;
  try {
    text = readFileSync(path, "utf8");
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    text = void 0;
    mtimeMs = void 0;
  }
  const lines = text === void 0 ? 0 : countLines(text);
  return {
    path,
    exists: text !== void 0,
    ...text !== void 0 ? { text } : {},
    ...mtimeMs !== void 0 ? { mtimeMs } : {},
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
function ritualDirective(state, dshHome) {
  if (!state.project.exists || state.key.length === 0) return void 0;
  const target = vaultPaths(dshHome, state.key).project;
  return ritual_default.replace("<project-file>", () => target).trimEnd();
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
function buildInjectBlockWithRitual(state, dshHome) {
  const base = buildInjectBlock(state);
  if (base.block.length === 0) return base;
  const directive = ritualDirective(state, dshHome);
  if (directive === void 0) return base;
  const block = base.block.endsWith("\n") ? `${base.block}
${directive}` : `${base.block}

${directive}`;
  return { block, chars: block.length, truncated: base.truncated };
}

// src/host/inbox.ts
import { appendFileSync, mkdirSync as mkdirSync3, readFileSync as readFileSync3, statSync as statSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2, join as join3 } from "node:path";

// src/host/fsutil.ts
import { closeSync, fsyncSync, mkdirSync as mkdirSync2, openSync, readFileSync as readFileSync2, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { randomBytes } from "node:crypto";
function writeFileAtomic(path, text) {
  const dir = dirname(path);
  mkdirSync2(dir, { recursive: true });
  const temp = join2(dir, `.${basenameNoExt(path)}.${process.pid}.${randomBytes(6).toString("hex")}.memento-tmp`);
  let fd = null;
  try {
    fd = openSync(temp, "w");
    writeSync(fd, text, 0, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temp, path);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
      }
    }
    try {
      unlinkSync(temp);
    } catch {
    }
    throw error;
  }
  return path;
}
function basenameNoExt(path) {
  const base = path.split(/[\\/]/).pop() ?? "file";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// src/host/inbox.ts
var INBOX_FILE_NAME = "inbox.md";
var TRIGGERS = [
  /^\s*remember this:\s?([\s\S]*)$/i,
  /^\s*remember:\s?([\s\S]*)$/i,
  /^\s*note this:\s?([\s\S]*)$/i
];
function isoLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  ].join("T");
}
function detectTrigger(message) {
  if (typeof message !== "string") return null;
  for (const pattern of TRIGGERS) {
    const match = pattern.exec(message);
    if (match === null) continue;
    const payload = (match[1] ?? "").replace(/[\r\n]+/g, " ").trim();
    if (payload.length === 0) return null;
    return payload;
  }
  return null;
}
function formatEntry(text, key, now = /* @__PURE__ */ new Date()) {
  const collapsed = text.replace(/[\r\n]+/g, " ").trim();
  return `${isoLocal(now)} [${key}] ${collapsed}`;
}
var InboxStore = class {
  constructor(inboxFile) {
    this.inboxFile = inboxFile;
  }
  tracked = [];
  /** Absolute path of `inbox.md`. */
  get path() {
    return this.inboxFile;
  }
  /**
   * Append one entry for a project key. Creates the file (and its
   * directory) when absent. Returns the written line and its start offset.
   * Throws on I/O failure — callers (routes, tools, the trigger hook) are
   * responsible for fail-open handling.
   */
  append(key, text, now = /* @__PURE__ */ new Date()) {
    const line = formatEntry(text, key, now);
    mkdirSync3(dirname2(this.inboxFile), { recursive: true });
    const startOffset = statSync2(this.inboxFile, { throwIfNoEntry: false })?.size ?? 0;
    const bytes = Buffer.from(`${line}
`, "utf8");
    appendFileSync(this.inboxFile, bytes);
    this.tracked.push({ path: this.inboxFile, startOffset, bytes });
    return { line, startOffset };
  }
  /**
   * Remove the last entry this instance appended. After undo the file is
   * byte-identical to its pre-append state. Returns `undone: false` when
   * there is nothing tracked or the file no longer carries the tracked
   * bytes (deleted, shrunken, or edited over) — never an error.
   */
  undo() {
    const top = this.tracked.pop();
    if (top === void 0) return { undone: false };
    let current;
    try {
      current = readFileSync3(top.path);
    } catch {
      this.tracked.length = 0;
      return { undone: false };
    }
    const end = top.startOffset + top.bytes.length;
    if (current.length < end || !current.subarray(top.startOffset, end).equals(top.bytes)) {
      this.tracked.length = 0;
      return { undone: false };
    }
    writeFileSync2(top.path, current.subarray(0, top.startOffset));
    return { undone: true, line: top.bytes.toString("utf8").replace(/\n$/, "") };
  }
};
function inboxPath(dshHome) {
  return join3(dshHome, "memory", INBOX_FILE_NAME);
}
function splitInboxLines(raw) {
  if (raw.length === 0) return [];
  const parts = raw.split("\n");
  if (raw.endsWith("\n")) parts.pop();
  return parts;
}
function readInboxTail(path, count = 20) {
  let raw;
  try {
    raw = readFileSync3(path, "utf8");
  } catch {
    return { exists: false, total: 0, tail: [] };
  }
  const lines = splitInboxLines(raw);
  const total = lines.length;
  const start = Math.max(0, total - count);
  const tail = [];
  for (let i = total - 1; i >= start; i--) tail.push({ n: i + 1, text: lines[i] });
  return { exists: true, total, tail };
}
function removeInboxLine(path, n) {
  let raw;
  try {
    raw = readFileSync3(path, "utf8");
  } catch {
    return { removed: false };
  }
  const lines = splitInboxLines(raw);
  if (!Number.isInteger(n) || n < 1 || n > lines.length) return { removed: false };
  const [line] = lines.splice(n - 1, 1);
  let next = lines.join("\n");
  if (raw.endsWith("\n") && lines.length > 0) next += "\n";
  writeFileAtomic(path, next);
  return { removed: true, line };
}
function insertInboxLine(path, n, text) {
  let raw = "";
  try {
    raw = readFileSync3(path, "utf8");
  } catch {
    raw = "";
  }
  const lines = splitInboxLines(raw);
  const line = text.replace(/[\r\n]+/g, " ").trimEnd();
  const idx = !Number.isInteger(n) || n < 1 ? lines.length : Math.min(n - 1, lines.length);
  lines.splice(idx, 0, line);
  let next = lines.join("\n");
  if (next.length > 0) next += "\n";
  mkdirSync3(dirname2(path), { recursive: true });
  writeFileAtomic(path, next);
  return { inserted: true, n: idx + 1, line };
}

// src/host/compliance.ts
import { readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join4 } from "node:path";
var COMPLIANCE_LOG_CAP = 500;
function matchesVaultPath(text, vaultRoot) {
  if (text.length === 0) return false;
  if (text.includes(vaultRoot)) return true;
  return /\.dsh\/memory/.test(text);
}
var WRITE_TOOL_NAMES = ["write", "edit", "apply_patch", "patch"];
var SHELL_TOOL_NAMES = ["bash", "shell", "exec", "run", "execute"];
var MUTATION_COMMAND_PATTERNS = [
  // Shell redirect `>` / `>>` (excluding `=>` / `->` arrow noise).
  /(?<![=>-])>/,
  /\btee(\s|$)/,
  /\bsed\s+-[A-Za-z]*i[A-Za-z]*(\s|$)/,
  /\bsed\s+--in-?place/,
  /\bgit\s+commit(\s|$)/,
  /\bgit\s+push(\s|$)/,
  /\bnode\s+[\w./\\-]*build[\w./\\-]*\.(?:mjs|cjs|js)(\s|$)/,
  /\b(?:cp|mv|rm|mkdir|rmdir|touch|ln|dd|truncate)(\s|$)/
];
function isMutationCommand(command) {
  return MUTATION_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}
function collectStrings(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) collectStrings(child, out);
  }
  return out;
}
function parseToolArguments(arguments_) {
  if (arguments_ === null) return null;
  if (typeof arguments_ !== "string") return arguments_;
  try {
    const value = JSON.parse(arguments_);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function shellCommand(name2, args) {
  if (args === null) return null;
  for (const key of ["command", "cmd"]) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  if (SHELL_TOOL_NAMES.includes(name2)) {
    const positional = args.args;
    if (Array.isArray(positional)) {
      const joined = positional.filter((item) => typeof item === "string").join(" ");
      if (joined.length > 0) return joined;
    }
  }
  return null;
}
var SessionComplianceTracker = class {
  projectKey;
  ritualRequired;
  vaultRoot;
  now;
  memoryReadAt = null;
  firstMutationAt = null;
  /**
   * Fixed at the first mutation (when the read state is final): `true` when
   * a vault read had already happened, `false` when it had not (the
   * violation is recorded alongside). Stays `null` until then.
   */
  determined = null;
  violations = [];
  constructor(options) {
    this.projectKey = options.projectKey;
    this.ritualRequired = options.ritualRequired;
    this.vaultRoot = options.vaultRoot;
    this.now = options.now ?? (() => Date.now());
  }
  /**
   * Fold in one tool call. `arguments` may be the parsed object or the raw
   * JSON string the session log carries; `at` overrides the clock (tests).
   */
  observeToolCall(name2, arguments_, at) {
    const ts = at ?? this.now();
    const haystacks = [name2];
    if (typeof arguments_ === "string") haystacks.push(arguments_);
    const args = parseToolArguments(arguments_);
    if (args !== null) haystacks.push(...collectStrings(args));
    if (haystacks.some((value) => matchesVaultPath(value, this.vaultRoot))) {
      if (this.memoryReadAt === null) this.memoryReadAt = ts;
    }
    let isMutation = WRITE_TOOL_NAMES.includes(name2);
    const command = shellCommand(name2, args);
    if (command !== null && isMutationCommand(command)) isMutation = true;
    if (!isMutation) return;
    if (this.firstMutationAt === null) {
      this.firstMutationAt = ts;
      if (this.ritualRequired && this.determined === null) {
        if (this.memoryReadAt === null) {
          this.determined = false;
          this.violations.push({ kind: "mutation-before-memory-read", at: ts, tool: name2 });
        } else {
          this.determined = true;
        }
      }
    }
  }
  /** Point-in-time report (the route payload is built from this). */
  snapshot() {
    let compliant;
    if (!this.ritualRequired) {
      compliant = null;
    } else if (this.firstMutationAt === null) {
      compliant = true;
    } else {
      compliant = this.determined;
    }
    return {
      projectKey: this.projectKey,
      ritualRequired: this.ritualRequired,
      memoryReadAt: this.memoryReadAt,
      firstMutationAt: this.firstMutationAt,
      compliant,
      violations: [...this.violations]
    };
  }
};
function complianceLogPath(dshHome) {
  return join4(dshHome, "memory", ".compliance.log");
}
function readComplianceHistory(dshHome) {
  let raw;
  try {
    raw = readFileSync4(complianceLogPath(dshHome), "utf8");
  } catch {
    return null;
  }
  let total = 0;
  let compliant = 0;
  let nonCompliant = 0;
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.compliant === true) compliant++;
      else if (entry.compliant === false) nonCompliant++;
      else continue;
    } catch {
      continue;
    }
  }
  total = compliant + nonCompliant;
  if (total === 0) return null;
  return { total, compliant, nonCompliant };
}
function appendComplianceLog(path, entry, capLines = COMPLIANCE_LOG_CAP) {
  let lines = [];
  try {
    lines = readFileSync4(path, "utf8").split("\n").filter((line) => line.length > 0);
  } catch {
    lines = [];
  }
  lines.push(JSON.stringify(entry));
  if (lines.length > capLines) lines = lines.slice(lines.length - capLines);
  writeFileSync3(path, lines.join("\n") + "\n", "utf8");
}

// src/host/enabled.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync4, unlinkSync as unlinkSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join5 } from "node:path";
var OFF_FILE_NAME = ".off";
function offPath(dshHome) {
  return join5(dshHome, "memory", OFF_FILE_NAME);
}
function isEnabled(dshHome) {
  try {
    return !existsSync2(offPath(dshHome));
  } catch {
    return true;
  }
}
function setEnabled(dshHome, enabled) {
  const path = offPath(dshHome);
  if (enabled) {
    try {
      unlinkSync2(path);
    } catch (error) {
      const code = error.code;
      if (code !== "ENOENT") throw error;
    }
    return;
  }
  mkdirSync4(join5(dshHome, "memory"), { recursive: true });
  writeFileSync4(path, "", "utf8");
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

// src/host/tools.ts
import { join as join7 } from "node:path";
import { cwd as processCwd } from "node:process";

// src/host/history.ts
import { spawn } from "node:child_process";
import { readdirSync, statSync as statSync3 } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { join as join6 } from "node:path";
var HISTORY_MAX_LIMIT = 50;
var HISTORY_DEFAULT_LIMIT = 10;
var HISTORY_DEFAULT_BUDGET_MS = 2e3;
var HISTORY_DEFAULT_BYTE_BUDGET = 64 * 1024 * 1024;
var SNIPPET_PAD = 200;
var SNIPPET_MAX = 400;
var REGEX_MAX_QUERY_LEN = 200;
var REGEX_MAX_LINE_LEN = 1024 * 1024;
var MAX_LINE_CARRY = 2 * 1024 * 1024;
var LOG_FILE_RE = /^session\.v\d+\.jsonl\.zstd$/;
function clampLimit(limit) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return HISTORY_DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > HISTORY_MAX_LIMIT) return HISTORY_MAX_LIMIT;
  return n;
}
function compileRegexFallback(query) {
  if (query.length === 0 || query.length > REGEX_MAX_QUERY_LEN) return null;
  try {
    return new RegExp(query);
  } catch {
    return null;
  }
}
function makeSnippet(line, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - SNIPPET_PAD);
  const end = Math.min(line.length, matchIndex + matchLength + SNIPPET_PAD);
  if (end - start <= SNIPPET_MAX) return line.slice(start, end);
  if (matchIndex - start <= SNIPPET_PAD) {
    return line.slice(start, start + SNIPPET_MAX);
  }
  return line.slice(end - SNIPPET_MAX, end);
}
function lineTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return isoLocal(date);
  }
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}
function matchLine(line, query, re) {
  const index = line.indexOf(query);
  if (index >= 0) return { index, length: query.length };
  if (re !== null && line.length <= REGEX_MAX_LINE_LEN) {
    const m = re.exec(line);
    if (m !== null) return { index: m.index, length: m[0].length };
  }
  return null;
}
function collectLogFiles(root, projectKey2, degraded) {
  let st;
  try {
    st = statSync3(root);
  } catch {
    degraded.push(`${root}: missing or unreadable`);
    return null;
  }
  if (!st.isDirectory()) {
    degraded.push(`${root}: not a directory`);
    return null;
  }
  let keys;
  try {
    keys = readdirSync(root);
  } catch (error) {
    degraded.push(`${root}: unreadable (${errorMessage(error)})`);
    return null;
  }
  if (projectKey2 !== null) {
    keys = keys.filter((k) => k === projectKey2);
    if (keys.length === 0) {
      degraded.push(`${join6(root, projectKey2)}: project directory missing`);
      return [];
    }
  }
  const entries = [];
  for (const key of keys) {
    const keyDir = join6(root, key);
    let sessionDirs;
    try {
      sessionDirs = readdirSync(keyDir);
    } catch {
      degraded.push(`${keyDir}: unreadable`);
      continue;
    }
    for (const sessionDir of sessionDirs) {
      const sessionPath = join6(keyDir, sessionDir);
      let files;
      try {
        files = readdirSync(sessionPath);
      } catch {
        continue;
      }
      for (const name2 of files) {
        if (LOG_FILE_RE.test(name2)) {
          entries.push({ file: join6(sessionPath, name2), projectKey: key, sessionDir });
        }
      }
    }
  }
  const withTime = [];
  for (const entry of entries) {
    try {
      const fst = statSync3(entry.file);
      if (!fst.isFile()) {
        degraded.push(`${entry.file}: not a regular file`);
        continue;
      }
      withTime.push({ ...entry, mtimeMs: fst.mtimeMs });
    } catch (error) {
      degraded.push(`${entry.file}: unreadable (${errorMessage(error)})`);
    }
  }
  withTime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withTime;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function scanLogFile(entry, state, zstdBin) {
  return new Promise((resolve3) => {
    let child;
    try {
      child = spawn(zstdBin, ["-dc", entry.file], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      state.degraded.push(`${entry.file}: spawn failed (${errorMessage(error)})`);
      resolve3();
      return;
    }
    const decoder = new StringDecoder("utf8");
    let carry = "";
    let sessionId = entry.sessionDir.startsWith("session-") ? entry.sessionDir : null;
    let sawId = false;
    let settled = false;
    let exitCode = null;
    let stderrBytes = 0;
    const stderrTail = [];
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (spawnError !== void 0) {
        const code2 = spawnError.code;
        if (code2 === "ENOENT" || code2 === "EACCES" || code2 === "EPERM") {
          state.binaryMissing = true;
          state.degraded.push(`${entry.file}: zstd binary unavailable`);
        } else {
          state.degraded.push(`${entry.file}: spawn failed (${errorMessage(spawnError)})`);
        }
        resolve3();
        return;
      }
      if (state.stopped) {
        state.truncated = true;
      } else if (code !== 0) {
        state.degraded.push(
          `${entry.file}: zstd failed (exit ${code}${stderrTail.length ? `: ${stderrTail.join("")}` : ""})`
        );
      }
      resolve3();
    };
    const killForStop = () => {
      if (settled) return;
      state.stopped = true;
      try {
        child.kill("SIGKILL");
      } catch {
      }
    };
    const onLine = (line) => {
      if (line.length === 0) return;
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        parsed = null;
      }
      if (!sawId && parsed !== null && typeof parsed.id === "string" && parsed.id.length > 0) {
        sessionId = parsed.id;
        sawId = true;
      }
      const m = matchLine(line, state.query, state.re);
      if (m === null) return;
      state.hits.push({
        projectKey: entry.projectKey,
        sessionId,
        time: parsed === null ? null : lineTime(parsed.time),
        eventType: parsed !== null && typeof parsed.type === "string" && parsed.type.length > 0 ? parsed.type : null,
        snippet: makeSnippet(line, m.index, m.length)
      });
      if (state.hits.length >= state.limit) {
        state.truncated = true;
        killForStop();
      }
    };
    const onData = (chunk) => {
      if (state.stopped) return;
      state.bytes += chunk.length;
      if (state.bytes > state.byteBudget) {
        state.truncated = true;
        killForStop();
        return;
      }
      if (Date.now() >= state.deadline) {
        state.truncated = true;
        killForStop();
        return;
      }
      carry += decoder.write(chunk);
      let nl;
      while ((nl = carry.indexOf("\n")) >= 0) {
        const line = carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        onLine(line);
        if (state.stopped) return;
      }
      if (carry.length > MAX_LINE_CARRY) {
        onLine(carry);
        carry = "";
        if (state.stopped) return;
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk) => {
      if (stderrBytes >= 512) return;
      stderrBytes += chunk.length;
      stderrTail.push(chunk.toString("utf8"));
      if (stderrBytes > 512) {
        const joined = stderrTail.join("");
        stderrTail.length = 0;
        stderrTail.push(joined.slice(-512));
      }
    });
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
    const remaining = state.deadline - Date.now() + 250;
    const watchdog = setTimeout(() => killForStop(), Math.max(remaining, 0));
    watchdog.unref?.();
  });
}
async function scanHistory(opts) {
  const query = typeof opts?.query === "string" ? opts.query : "";
  if (query.length === 0) {
    return { ok: false, error: "query must be a non-empty string" };
  }
  const root = typeof opts.root === "string" && opts.root.length > 0 ? opts.root : "";
  if (root.length === 0) {
    return { ok: false, error: "root must be a non-empty path" };
  }
  const state = {
    deadline: Date.now() + (typeof opts.budgetMs === "number" && opts.budgetMs > 0 ? opts.budgetMs : HISTORY_DEFAULT_BUDGET_MS),
    byteBudget: typeof opts.byteBudget === "number" && opts.byteBudget > 0 ? opts.byteBudget : HISTORY_DEFAULT_BYTE_BUDGET,
    limit: clampLimit(opts.limit),
    query,
    re: compileRegexFallback(query),
    bytes: 0,
    hits: [],
    degraded: [],
    scanned: 0,
    truncated: false,
    binaryMissing: false,
    stopped: false
  };
  const entries = collectLogFiles(root, opts.projectKey ?? null, state.degraded);
  if (entries === null) {
    return { ok: true, scanned: 0, hits: [], truncated: false, degraded: state.degraded };
  }
  const zstdBin = typeof opts.zstdBin === "string" && opts.zstdBin.length > 0 ? opts.zstdBin : "zstd";
  for (const entry of entries) {
    if (state.stopped) {
      state.truncated = true;
      break;
    }
    if (Date.now() >= state.deadline) {
      state.truncated = true;
      break;
    }
    if (state.bytes > state.byteBudget) {
      state.truncated = true;
      break;
    }
    if (state.binaryMissing) {
      state.degraded.push(`${entry.file}: zstd binary unavailable`);
      continue;
    }
    state.scanned += 1;
    try {
      await scanLogFile(entry, state, zstdBin);
    } catch (error) {
      state.degraded.push(`${entry.file}: scan error (${errorMessage(error)})`);
    }
  }
  state.hits.sort(
    (a, b) => {
      const ta = a.time === null ? -Infinity : Date.parse(a.time);
      const tb = b.time === null ? -Infinity : Date.parse(b.time);
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    }
  );
  return {
    ok: true,
    scanned: state.scanned,
    hits: state.hits,
    truncated: state.truncated,
    degraded: state.degraded
  };
}

// src/host/tools.ts
function registerTools(ctx, inbox, enabled = () => true) {
  const tools = ctx.tools;
  if (typeof tools?.register !== "function") {
    ctx.logger?.("dsh-memento")?.warn("tools service unavailable; tools not registered");
    return () => {
    };
  }
  const disposers = [];
  disposers.push(registerRememberTool(tools, ctx, inbox, enabled));
  disposers.push(registerHistorySearchTool(tools, ctx));
  return () => {
    for (const dispose of disposers) dispose();
  };
}
function registerRememberTool(tools, ctx, inbox, enabled) {
  const dispose = tools.register({
    name: "memory_remember",
    description: "Capture a note into the dsh-memento inbox (one plain line in ~/.dsh/memory/inbox.md). Use it when the user asks you to remember something, or when a durable fact worth keeping surfaces. Writes the inbox only \u2014 never ME.md or project MEMORY.md. Undoes only via POST /api/dsh-memento/undo.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        text: {
          type: "string",
          description: "The note to remember. Newlines collapse to single spaces."
        }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "captured"],
        properties: {
          ok: { type: "boolean" },
          captured: { type: "boolean" },
          line: { type: "string" }
        }
      },
      render: (_args, value) => [
        { type: "text", text: JSON.stringify(value) }
      ]
    },
    async execute(args, exec) {
      const text = typeof args?.text === "string" ? args.text.trim() : "";
      if (text.length === 0) {
        throw new Error('memory_remember requires a non-empty "text" argument');
      }
      if (!enabled()) {
        return { ok: true, captured: false, reason: "disabled" };
      }
      const cwd = exec?.agent?.session?.header?.cwd;
      const key = typeof cwd === "string" && cwd.length > 0 ? projectKey(cwd) : projectKey(processCwd());
      const result = inbox.append(key, text);
      return { ok: true, captured: true, line: result.line };
    }
  });
  return () => {
    dispose();
  };
}
function sessionsRoot() {
  return join7(resolveDshHome(), "sessions");
}
function registerHistorySearchTool(tools, ctx) {
  const dispose = tools.register({
    name: "memory_history_search",
    description: 'Read-only archaeology over past DSH session logs (~/.dsh/sessions). Use it for cold cases: "did we already try this, and what happened?" Greps compressed session transcripts for a literal substring (or simple regex) and returns up to 50 snippets, newest first. It never writes anything and never copies results into the vault. Prefer it over re-deriving a past decision from scratch.',
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "A literal substring to find, or a simple regex. Matched against each log line."
        },
        project: {
          type: "string",
          description: "Restrict to one project key (the `--slug--` directory name under ~/.dsh/sessions). Defaults to the current session's project when allProjects is false."
        },
        allProjects: {
          type: "boolean",
          description: "Search every project, not just the current one. Default false."
        },
        limit: {
          type: "number",
          description: "Maximum hits to return. Default 10, max 50."
        }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "scanned", "hits", "truncated", "degraded"],
        properties: {
          ok: { type: "boolean" },
          scanned: { type: "number" },
          hits: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["projectKey", "sessionId", "time", "eventType", "snippet"],
              properties: {
                projectKey: { type: "string" },
                sessionId: { type: ["string", "null"] },
                time: { type: ["string", "null"] },
                eventType: { type: ["string", "null"] },
                snippet: { type: "string" }
              }
            }
          },
          truncated: { type: "boolean" },
          degraded: { type: "array", items: { type: "string" } }
        }
      },
      render: (_args, value) => [
        { type: "text", text: JSON.stringify(value) }
      ]
    },
    async execute(args, exec) {
      const query = typeof args?.query === "string" ? args.query : "";
      if (query.trim().length === 0) {
        throw new Error('memory_history_search requires a non-empty "query" argument');
      }
      const cwd = exec?.agent?.session?.header?.cwd;
      const currentKey = typeof cwd === "string" && cwd.length > 0 ? projectKey(cwd) : projectKey(processCwd());
      const allProjects = args?.allProjects === true;
      const explicitProject = typeof args?.project === "string" ? args.project.trim() : "";
      const projectKeyArg = allProjects ? null : explicitProject.length > 0 ? explicitProject : currentKey;
      const limit = typeof args?.limit === "number" ? args.limit : void 0;
      try {
        const result = await scanHistory({
          root: sessionsRoot(),
          query,
          projectKey: projectKeyArg,
          limit
        });
        return result;
      } catch (error) {
        ctx.logger?.("dsh-memento")?.warn("history search failed: %s", error instanceof Error ? error.message : String(error));
        return {
          ok: true,
          scanned: 0,
          hits: [],
          truncated: false,
          degraded: [`scan failed: ${error instanceof Error ? error.message : String(error)}`]
        };
      }
    }
  });
  return () => {
    dispose();
  };
}

// assets/ME.template.md
var ME_template_default = "# ME \u2014 operator profile (cap: 30 lines, hand-edited only)\n<!-- Rules: 1) never record what `rg` can find  2) must still be true in 3 months\n     3) if you had to say it twice, it belongs here -->\n\n<!-- Seeded only when ~/.dsh/memory/ME.md is missing. Replace these examples\n     with your own facts, then delete any line that is not true for you. -->\n<!-- - Name / how you prefer to be addressed -->\n<!-- - Hard constraints the agent must never violate (ports, machines, secrets) -->\n<!-- - How you like answers: tone, length, what to skip -->\n<!-- - Durable tools and workflows that stay true for months -->\n";

// assets/MEMORY.template.md
var MEMORY_template_default = "# MEMORY \u2014 project lore (cap: 45 lines, hand-edited only)\n<!-- Rules: 1) never record what `rg` can find  2) must still be true in 3 months\n     3) if you had to say it twice, it belongs here -->\n";

// src/host/index.ts
var name = PLUGIN;
var inject = ["tools"];
var PROJECT_CREATE_SEED = MEMORY_template_default;
var DSH_HOME = resolveDshHome();
var INBOX_TAIL_LINES = 20;
var MAX_FILE_BODY_BYTES = 512 * 1024;
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
function errorMessage2(error) {
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
          send(res, 500, { ok: false, error: errorMessage2(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: health route");
}
function registerStateRoute(ctx, inbox) {
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
          const cwd = processCwd2();
          const key = projectKey(cwd);
          const enabled = isEnabled(DSH_HOME);
          const state = readVault(DSH_HOME, key);
          const block = buildInjectBlockWithRitual(state, DSH_HOME);
          const inboxTail = readInboxTail(inbox.path, INBOX_TAIL_LINES);
          const payload = {
            ok: true,
            enabled,
            me: {
              path: state.me.path,
              lines: state.me.lines,
              cap: state.me.cap,
              overCap: state.me.overCap,
              exists: state.me.exists,
              ...state.me.text !== void 0 ? { text: state.me.text } : {},
              ...state.me.mtimeMs !== void 0 ? { mtimeMs: state.me.mtimeMs } : {}
            },
            project: {
              key,
              cwd,
              path: state.project.path,
              lines: state.project.lines,
              cap: state.project.cap,
              overCap: state.project.overCap,
              exists: state.project.exists,
              ...state.project.text !== void 0 ? { text: state.project.text } : {},
              ...state.project.mtimeMs !== void 0 ? { mtimeMs: state.project.mtimeMs } : {}
            },
            // M4: the pane's read-only inbox listing (newest 20, 1-based
            // line numbers the line-delete route understands). Fail-open:
            // absent inbox → exists:false, no lines.
            inbox: {
              path: inbox.path,
              exists: inboxTail.exists,
              total: inboxTail.total,
              lines: inboxTail.tail
            },
            inject: {
              chars: block.chars,
              budget: INJECT_BUDGET,
              truncated: block.truncated,
              text: block.block
            }
          };
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage2(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: state route");
}
function readBody(req) {
  return new Promise((resolve3, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve3(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}
function parseCaptureBody(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { error: "text required" };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") return { text: parsed };
    if (parsed !== null && typeof parsed === "object" && "text" in parsed) {
      const { text, key } = parsed;
      if (typeof text !== "string" || text.trim().length === 0) return { error: "text required" };
      const request = { text };
      if (typeof key === "string" && key.length > 0) request.key = key;
      return request;
    }
    return { error: 'expected a text string or { "text": \u2026 }' };
  } catch {
    return { text: trimmed };
  }
}
function registerCaptureRoute(ctx, inbox) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: CAPTURE_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "POST") {
            send(res, 405, { ok: false, error: "method not allowed; use POST" });
            return;
          }
          const body = await readBody(req);
          const parsed = parseCaptureBody(body);
          if ("error" in parsed) {
            send(res, 400, { ok: false, error: parsed.error });
            return;
          }
          if (!isEnabled(DSH_HOME)) {
            const disabled = { ok: true, captured: false, reason: "disabled" };
            send(res, 200, disabled);
            return;
          }
          const key = parsed.key ?? projectKey(processCwd2());
          const result = inbox.append(key, parsed.text);
          const payload = { ok: true, captured: true, line: result.line };
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage2(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: capture route");
}
function registerUndoRoute(ctx, inbox) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: UNDO_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "POST") {
            send(res, 405, { ok: false, error: "method not allowed; use POST" });
            return;
          }
          await readBody(req);
          const result = inbox.undo();
          const payload = { ok: true, undone: result.undone, ...result.line !== void 0 ? { line: result.line } : {} };
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage2(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: undo route");
}
function parseFileBody(raw) {
  if (raw.length > MAX_FILE_BODY_BYTES) return { error: "content too large (max 512 KiB)" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'expected a JSON body { "target": \u2026, "content": \u2026 }' };
  }
  if (parsed === null || typeof parsed !== "object") return { error: "expected a JSON object" };
  const { target, content, key, mtimeMs } = parsed;
  if (target !== "me" && target !== "project") {
    return { error: 'target must be "me" or "project"' };
  }
  if (typeof content !== "string") {
    return { error: "content must be a string (exact bytes to write)" };
  }
  const request = { target, content };
  if (key !== void 0) {
    if (typeof key !== "string" || key.length === 0) return { error: "key must be a non-empty string" };
    request.key = key;
  }
  if (mtimeMs !== void 0) {
    if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) {
      return { error: "mtimeMs must be a finite number" };
    }
    request.mtimeMs = mtimeMs;
  }
  return request;
}
function registerFileRoute(ctx) {
  const vaultRoot = join8(DSH_HOME, "memory");
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: FILE_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "PUT") {
            send(res, 405, { ok: false, error: "method not allowed; use PUT" });
            return;
          }
          const parsed = parseFileBody(await readBody(req));
          if ("error" in parsed) {
            send(res, 400, { ok: false, error: parsed.error });
            return;
          }
          const key = parsed.target === "project" ? parsed.key ?? projectKey(processCwd2()) : "";
          const paths = vaultPaths(DSH_HOME, key);
          const targetPath = parsed.target === "me" ? paths.me : paths.project;
          const resolved = resolve2(targetPath);
          if (resolved !== resolve2(vaultRoot) && !resolved.startsWith(vaultRoot + "/")) {
            send(res, 400, { ok: false, error: "target resolves outside the memory vault" });
            return;
          }
          if (parsed.mtimeMs !== void 0 && existsSync3(resolved)) {
            let currentMtime;
            try {
              currentMtime = statSync4(resolved).mtimeMs;
            } catch (error) {
              send(res, 500, { ok: false, error: errorMessage2(error) });
              return;
            }
            if (currentMtime !== parsed.mtimeMs) {
              const conflict = {
                ok: false,
                error: "mtime mismatch",
                mtimeMs: currentMtime
              };
              send(res, 409, conflict);
              return;
            }
          }
          writeFileAtomic(resolved, parsed.content);
          const lines = countLines(parsed.content);
          const cap = parsed.target === "me" ? ME_CAP : PROJECT_CAP;
          const mtimeMs = statSync4(resolved).mtimeMs;
          const payload = {
            ok: true,
            target: parsed.target,
            path: resolved,
            lines,
            cap,
            overCap: lines > cap,
            mtimeMs
          };
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage2(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: file route");
}
function registerInboxDeleteRoute(ctx, inbox) {
  const unregister = ctx.webServer.register({
    kind: "prefix",
    path: INBOX_DELETE_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          const pathname = (req.url ?? "/").split("?")[0];
          const suffix = pathname.slice(INBOX_DELETE_ROUTE.length);
          if (req.method === "POST") {
            if (suffix !== "" && suffix !== "/") {
              send(res, 400, { ok: false, error: "expected POST /api/dsh-memento/inbox/line" });
              return;
            }
            const raw = await readBody(req);
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch {
              send(res, 400, { ok: false, error: "expected JSON { text, n? }" });
              return;
            }
            if (typeof parsed.text !== "string" || parsed.text.length === 0) {
              send(res, 400, { ok: false, error: "text required" });
              return;
            }
            const n = typeof parsed.n === "number" ? parsed.n : Number.POSITIVE_INFINITY;
            const result2 = insertInboxLine(inbox.path, n, parsed.text);
            const payload2 = {
              ok: true,
              inserted: true,
              n: result2.n,
              line: result2.line
            };
            send(res, 200, payload2);
            return;
          }
          if (req.method !== "DELETE") {
            send(res, 405, { ok: false, error: "method not allowed; use DELETE or POST" });
            return;
          }
          const match = /^\/(\d+)$/.exec(suffix);
          if (match === null) {
            send(res, 400, { ok: false, error: "expected DELETE /api/dsh-memento/inbox/line/<n>" });
            return;
          }
          const result = removeInboxLine(inbox.path, Number(match[1]));
          const payload = {
            ok: true,
            removed: result.removed,
            ...result.line !== void 0 ? { line: result.line } : {}
          };
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage2(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: inbox line-delete route");
}
function installTriggerCapture(ctx, inbox) {
  ctx.on("agent/pre-step", async (args, next) => {
    const decision = await next();
    try {
      if (!isEnabled(DSH_HOME)) return decision;
      for (const message of args.messages) {
        if (message.role !== "user") continue;
        if (message.source?.kind === "dsh-memento") continue;
        const text = message.content.map((block) => typeof block.text === "string" ? block.text : "").join("");
        const payload = detectTrigger(text);
        if (payload === null) continue;
        const cwd = args.agent.session.header.cwd;
        if (typeof cwd !== "string" || cwd.length === 0) continue;
        inbox.append(projectKey(cwd), payload);
      }
    } catch (error) {
      ctx.logger?.("dsh-memento")?.warn("trigger capture failed (step unaffected): %s", errorMessage2(error));
    }
    return decision;
  });
}
function bootstrap(ctx) {
  try {
    const result = bootstrapVault(DSH_HOME, ME_template_default);
    ctx.logger?.("dsh-memento").info("vault ready at %s (ME.md %s)", result.root, result.created ? "created from template" : "already present");
  } catch (error) {
    ctx.logger?.("dsh-memento").warn("vault bootstrap failed (continuing without vault): %s", errorMessage2(error));
  }
}
function prepareInject(key) {
  if (!isEnabled(DSH_HOME)) return void 0;
  const state = readVault(DSH_HOME, key);
  const block = buildInjectBlockWithRitual(state, DSH_HOME);
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
    ctx.logger?.("dsh-memento").warn("session-start inject install failed (continuing without inject): %s", errorMessage2(error));
  }
}
function compliancePayload(entry, snapshot) {
  const iso = (ms) => ms === null ? null : isoLocal(new Date(ms));
  const violations = snapshot.violations.map((v) => ({
    kind: v.kind,
    at: isoLocal(new Date(v.at)),
    tool: v.tool
  }));
  return {
    ok: true,
    sessionId: entry.sessionId,
    projectKey: snapshot.projectKey,
    ritualRequired: snapshot.ritualRequired,
    memoryReadAt: iso(snapshot.memoryReadAt),
    firstMutationAt: iso(snapshot.firstMutationAt),
    compliant: snapshot.compliant,
    violations
  };
}
function installCompliance(ctx, state) {
  const vaultRoot = join8(DSH_HOME, "memory");
  const logPath = complianceLogPath(DSH_HOME);
  const warn = (message, error) => {
    try {
      ctx.logger?.("dsh-memento")?.warn("%s: %s", message, errorMessage2(error));
    } catch {
    }
  };
  const flushed = /* @__PURE__ */ new Set();
  const entryFor = (session) => {
    const sessionId = String(session.header.id);
    let entry = state.trackers.get(sessionId);
    if (entry === void 0) {
      const cwd = session.header.cwd;
      const key = typeof cwd === "string" && cwd.length > 0 ? projectKey(cwd) : null;
      const ritualRequired = key !== null && existsSync3(vaultPaths(DSH_HOME, key).project);
      entry = {
        sessionId,
        tracker: new SessionComplianceTracker({ projectKey: key, ritualRequired, vaultRoot }),
        lastActivity: Date.now()
      };
      state.trackers.set(sessionId, entry);
    }
    return entry;
  };
  const flushEntry = (entry) => {
    if (flushed.has(entry.sessionId)) return;
    flushed.add(entry.sessionId);
    state.trackers.delete(entry.sessionId);
    if (!isEnabled(DSH_HOME)) return;
    const snapshot = entry.tracker.snapshot();
    const iso = (ms) => ms === null ? null : isoLocal(new Date(ms));
    appendComplianceLog(logPath, {
      endedAt: isoLocal(/* @__PURE__ */ new Date()),
      sessionId: entry.sessionId,
      projectKey: snapshot.projectKey,
      ritualRequired: snapshot.ritualRequired,
      memoryReadAt: iso(snapshot.memoryReadAt),
      firstMutationAt: iso(snapshot.firstMutationAt),
      compliant: snapshot.compliant,
      violations: snapshot.violations.map((v) => ({
        kind: v.kind,
        at: isoLocal(new Date(v.at)),
        tool: v.tool
      }))
    });
  };
  const sessionOpts = { global: true };
  ctx.on("session/created", (session) => {
    try {
      if (!isEnabled(DSH_HOME)) return;
      entryFor(session);
    } catch (error) {
      warn("compliance session/created failed (session unaffected)", error);
    }
  }, sessionOpts);
  ctx.on("session/event", (session, event) => {
    if (event === null || typeof event !== "object") return;
    if (event.type !== "tool/call") return;
    const sess = session;
    try {
      if (!isEnabled(DSH_HOME)) return;
      const entry = entryFor(sess);
      const data = event.data;
      const name2 = data?.name;
      if (typeof name2 !== "string") return;
      const raw = data?.arguments;
      const args = typeof raw === "string" ? raw : raw !== null && typeof raw === "object" ? raw : null;
      entry.tracker.observeToolCall(name2, args);
      entry.lastActivity = Date.now();
    } catch (error) {
      warn("compliance observation failed (session unaffected)", error);
    }
  }, sessionOpts);
  ctx.on("session/disposed", (session) => {
    try {
      const sessionId = String(session.header.id);
      const entry = state.trackers.get(sessionId);
      if (entry === void 0) return;
      flushEntry(entry);
    } catch (error) {
      warn("compliance log write failed", error);
    }
  }, sessionOpts);
  ctx.effect(() => () => {
    try {
      for (const entry of [...state.trackers.values()]) {
        try {
          flushEntry(entry);
        } catch (error) {
          warn("compliance fiber-flush failed", error);
        }
      }
    } catch (error) {
      warn("compliance fiber teardown failed", error);
    }
  }, "memento: compliance flush on unload");
}
function registerComplianceRoute(ctx, state) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: COMPLIANCE_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "GET") {
            send(res, 405, { ok: false, error: "method not allowed; use GET" });
            return;
          }
          const url = new URL(req.url ?? "/", "http://localhost");
          const wanted = url.searchParams.get("sessionId");
          let entry;
          if (wanted !== null) {
            entry = state.trackers.get(wanted);
          } else {
            let newest = 0;
            for (const candidate of state.trackers.values()) {
              if (candidate.lastActivity >= newest) {
                newest = candidate.lastActivity;
                entry = candidate;
              }
            }
          }
          const history = readComplianceHistory(DSH_HOME);
          if (entry === void 0) {
            const unknown = { ok: true, sessionId: wanted ?? null, known: false };
            if (history !== null) unknown.history = history;
            send(res, 200, unknown);
            return;
          }
          const payload = compliancePayload(entry, entry.tracker.snapshot());
          if (history !== null) payload.history = history;
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage2(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: compliance route");
}
function registerEnabledRoute(ctx) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: ENABLED_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "POST") {
            send(res, 405, { ok: false, error: "method not allowed; use POST" });
            return;
          }
          const raw = await readBody(req);
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            send(res, 400, { ok: false, error: 'expected JSON { "enabled": boolean }' });
            return;
          }
          if (parsed === null || typeof parsed !== "object" || typeof parsed.enabled !== "boolean") {
            send(res, 400, { ok: false, error: 'expected JSON { "enabled": boolean }' });
            return;
          }
          setEnabled(DSH_HOME, parsed.enabled);
          const payload = { ok: true, enabled: isEnabled(DSH_HOME) };
          send(res, 200, payload);
        } catch (error) {
          send(res, 500, { ok: false, error: errorMessage2(error) });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: enabled route");
}
function apply(ctx) {
  bootstrap(ctx);
  installInject(ctx);
  const inbox = new InboxStore(inboxPath(DSH_HOME));
  try {
    installTriggerCapture(ctx, inbox);
  } catch (error) {
    ctx.logger?.("dsh-memento").warn("trigger capture install failed (continuing without it): %s", errorMessage2(error));
  }
  try {
    const disposeTools = registerTools(ctx, inbox, () => isEnabled(DSH_HOME));
    ctx.effect(() => {
      disposeTools();
    }, "memento: tools");
  } catch (error) {
    ctx.logger?.("dsh-memento").warn("tool registration failed (continuing without it): %s", errorMessage2(error));
  }
  const compliance = { trackers: /* @__PURE__ */ new Map() };
  try {
    installCompliance(ctx, compliance);
  } catch (error) {
    ctx.logger?.("dsh-memento").warn("compliance install failed (continuing without it): %s", errorMessage2(error));
  }
  ctx.inject(["webServer"], (webCtx) => {
    try {
      registerHealthRoute(webCtx);
      registerStateRoute(webCtx, inbox);
      registerCaptureRoute(webCtx, inbox);
      registerUndoRoute(webCtx, inbox);
      registerComplianceRoute(webCtx, compliance);
      registerFileRoute(webCtx);
      registerInboxDeleteRoute(webCtx, inbox);
      registerEnabledRoute(webCtx);
    } catch (error) {
      webCtx.logger?.("dsh-memento").error("route registration failed: %s", errorMessage2(error));
    }
  });
}
export {
  CAPTURE_ROUTE,
  COMPLIANCE_ROUTE,
  ENABLED_ROUTE,
  FILE_ROUTE,
  HEALTH_ROUTE,
  INBOX_DELETE_ROUTE,
  MILESTONE,
  PROJECT_CREATE_SEED,
  STATE_ROUTE,
  UNDO_ROUTE,
  VERSION,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
