const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const LEVEL_NUMS = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level) {
  return (LEVEL_NUMS[level] ?? 0) >= (LEVEL_NUMS[LOG_LEVEL] ?? 0);
}

const LEVELS = { info: "ℹ️", warn: "⚠️", error: "❌", debug: "🔍" };

function log(level, ...args) {
  if (!shouldLog(level)) return;
  const ts  = new Date().toLocaleTimeString("th-TH");
  const pfx = LEVELS[level] || "·";
  console[level === "error" ? "error" : "log"](`[${ts}] ${pfx}`, ...args);
}

export const logger = {
  info:  (...a) => log("info",  ...a),
  warn:  (...a) => log("warn",  ...a),
  error: (...a) => log("error", ...a),
  debug: (...a) => log("debug", ...a),
};