// src/host/inbox.ts
import { appendFileSync, mkdirSync as mkdirSync2, readFileSync as readFileSync2, statSync, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";

// src/host/fsutil.ts
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
function writeFileAtomic(path, text) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basenameNoExt(path)}.${process.pid}.${randomBytes(6).toString("hex")}.memento-tmp`);
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
var ENTRY_LINE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \[--[A-Za-z0-9._-]+--\] \S[\s\S]*$/;
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
    mkdirSync2(dirname2(this.inboxFile), { recursive: true });
    const startOffset = statSync(this.inboxFile, { throwIfNoEntry: false })?.size ?? 0;
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
      current = readFileSync2(top.path);
    } catch {
      this.tracked.length = 0;
      return { undone: false };
    }
    const end = top.startOffset + top.bytes.length;
    if (current.length < end || !current.subarray(top.startOffset, end).equals(top.bytes)) {
      this.tracked.length = 0;
      return { undone: false };
    }
    writeFileSync(top.path, current.subarray(0, top.startOffset));
    return { undone: true, line: top.bytes.toString("utf8").replace(/\n$/, "") };
  }
};
function inboxPath(dshHome) {
  return join2(dshHome, "memory", INBOX_FILE_NAME);
}
function countInboxLines(raw) {
  if (raw.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) n++;
  if (raw.charCodeAt(raw.length - 1) !== 10) n++;
  return n;
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
    raw = readFileSync2(path, "utf8");
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
    raw = readFileSync2(path, "utf8");
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
export {
  ENTRY_LINE_PATTERN,
  INBOX_FILE_NAME,
  InboxStore,
  countInboxLines,
  detectTrigger,
  formatEntry,
  inboxPath,
  isoLocal,
  readInboxTail,
  removeInboxLine
};
//# sourceMappingURL=inbox.js.map
