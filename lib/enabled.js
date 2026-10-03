// src/host/enabled.ts
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var OFF_FILE_NAME = ".off";
function offPath(dshHome) {
  return join(dshHome, "memory", OFF_FILE_NAME);
}
function isEnabled(dshHome) {
  try {
    return !existsSync(offPath(dshHome));
  } catch {
    return true;
  }
}
function setEnabled(dshHome, enabled) {
  const path = offPath(dshHome);
  if (enabled) {
    try {
      unlinkSync(path);
    } catch (error) {
      const code = error.code;
      if (code !== "ENOENT") throw error;
    }
    return;
  }
  mkdirSync(join(dshHome, "memory"), { recursive: true });
  writeFileSync(path, "", "utf8");
}
export {
  OFF_FILE_NAME,
  isEnabled,
  offPath,
  setEnabled
};
//# sourceMappingURL=enabled.js.map
