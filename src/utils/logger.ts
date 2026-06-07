const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const LOG_FORMAT = (process.env.LOG_FORMAT || "text").toLowerCase();
const LEVEL_NUMS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: string): boolean {
  return (LEVEL_NUMS[level] ?? 0) >= (LEVEL_NUMS[LOG_LEVEL] ?? 0);
}

const LEVELS: Record<string, string> = { info: "ℹ️", warn: "⚠️", error: "❌", debug: "🔍" };

function log(level: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const pfx = LEVELS[level] || "·";

  if (LOG_FORMAT === "json") {
    const logEntry: Record<string, unknown> = {
      timestamp: ts,
      level: level.toUpperCase(),
      message: args[0],
    };
    if (args.length > 1 && typeof args[1] === "object") {
      Object.assign(logEntry, args[1]);
    } else if (args.length > 1) {
      logEntry.extra = args.slice(1);
    }
    console[level === "error" ? "error" : "log"](JSON.stringify(logEntry));
  } else {
    const thaiTs = new Date().toLocaleTimeString("th-TH");
    console[level === "error" ? "error" : "log"](`[${thaiTs}] ${pfx}`, ...args);
  }
}

export const logger = {
  info: (...a: unknown[]) => log("info", ...a),
  warn: (...a: unknown[]) => log("warn", ...a),
  error: (...a: unknown[]) => log("error", ...a),
  debug: (...a: unknown[]) => log("debug", ...a),
};