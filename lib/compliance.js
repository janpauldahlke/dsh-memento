// src/host/compliance.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
function shellCommand(name, args) {
  if (args === null) return null;
  for (const key of ["command", "cmd"]) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  if (SHELL_TOOL_NAMES.includes(name)) {
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
  observeToolCall(name, arguments_, at) {
    const ts = at ?? this.now();
    const haystacks = [name];
    if (typeof arguments_ === "string") haystacks.push(arguments_);
    const args = parseToolArguments(arguments_);
    if (args !== null) haystacks.push(...collectStrings(args));
    if (haystacks.some((value) => matchesVaultPath(value, this.vaultRoot))) {
      if (this.memoryReadAt === null) this.memoryReadAt = ts;
    }
    let isMutation = WRITE_TOOL_NAMES.includes(name);
    const command = shellCommand(name, args);
    if (command !== null && isMutationCommand(command)) isMutation = true;
    if (!isMutation) return;
    if (this.firstMutationAt === null) {
      this.firstMutationAt = ts;
      if (this.ritualRequired && this.determined === null) {
        if (this.memoryReadAt === null) {
          this.determined = false;
          this.violations.push({ kind: "mutation-before-memory-read", at: ts, tool: name });
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
  return join(dshHome, "memory", ".compliance.log");
}
function readComplianceHistory(dshHome) {
  let raw;
  try {
    raw = readFileSync(complianceLogPath(dshHome), "utf8");
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
    lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
  } catch {
    lines = [];
  }
  lines.push(JSON.stringify(entry));
  if (lines.length > capLines) lines = lines.slice(lines.length - capLines);
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}
export {
  COMPLIANCE_LOG_CAP,
  MUTATION_COMMAND_PATTERNS,
  SHELL_TOOL_NAMES,
  SessionComplianceTracker,
  WRITE_TOOL_NAMES,
  appendComplianceLog,
  collectStrings,
  complianceLogPath,
  isMutationCommand,
  matchesVaultPath,
  parseToolArguments,
  readComplianceHistory,
  shellCommand
};
//# sourceMappingURL=compliance.js.map
