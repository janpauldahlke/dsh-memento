// src/host/vault.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// assets/ritual.md
var ritual_default = "<!-- ritual -->\nBefore your first file edit in this session, read\n`<project-file>` (if it exists). If it contradicts this chat, the file wins.\n";

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
export {
  DSH_HOME_DIR_NAME,
  DSH_HOME_ENV,
  INJECT_BUDGET,
  MEMORY_DIR_NAME,
  MEMORY_FILE_NAME,
  ME_CAP,
  ME_FILE_NAME,
  PROJECTS_DIR_NAME,
  PROJECT_CAP,
  bootstrapVault,
  buildInjectBlock,
  buildInjectBlockWithRitual,
  countLines,
  projectKey,
  readVault,
  resolveDshHome,
  ritualDirective,
  vaultPaths
};
//# sourceMappingURL=vault.js.map
