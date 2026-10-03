// src/host/history.ts
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";

// src/host/inbox.ts
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

// src/host/history.ts
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
function collectLogFiles(root, projectKey, degraded) {
  let st;
  try {
    st = statSync(root);
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
  if (projectKey !== null) {
    keys = keys.filter((k) => k === projectKey);
    if (keys.length === 0) {
      degraded.push(`${join(root, projectKey)}: project directory missing`);
      return [];
    }
  }
  const entries = [];
  for (const key of keys) {
    const keyDir = join(root, key);
    let sessionDirs;
    try {
      sessionDirs = readdirSync(keyDir);
    } catch {
      degraded.push(`${keyDir}: unreadable`);
      continue;
    }
    for (const sessionDir of sessionDirs) {
      const sessionPath = join(keyDir, sessionDir);
      let files;
      try {
        files = readdirSync(sessionPath);
      } catch {
        continue;
      }
      for (const name of files) {
        if (LOG_FILE_RE.test(name)) {
          entries.push({ file: join(sessionPath, name), projectKey: key, sessionDir });
        }
      }
    }
  }
  const withTime = [];
  for (const entry of entries) {
    try {
      const fst = statSync(entry.file);
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
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(zstdBin, ["-dc", entry.file], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      state.degraded.push(`${entry.file}: spawn failed (${errorMessage(error)})`);
      resolve();
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
        resolve();
        return;
      }
      if (state.stopped) {
        state.truncated = true;
      } else if (code !== 0) {
        state.degraded.push(
          `${entry.file}: zstd failed (exit ${code}${stderrTail.length ? `: ${stderrTail.join("")}` : ""})`
        );
      }
      resolve();
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
export {
  HISTORY_DEFAULT_BUDGET_MS,
  HISTORY_DEFAULT_BYTE_BUDGET,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  clampLimit,
  compileRegexFallback,
  makeSnippet,
  scanHistory
};
//# sourceMappingURL=history.js.map
