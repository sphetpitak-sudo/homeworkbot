const LEVELS = { info: "ℹ️", warn: "⚠️", error: "❌", debug: "🔍" };

function log(level, ...args) {
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