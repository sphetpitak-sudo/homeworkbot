import { logger } from "./logger.js";

const REQUIRED = ["TELEGRAM_TOKEN", "NOTION_TOKEN", "DATABASE_ID"];

export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    logger.error("Missing required env vars:", missing.join(", "));
    process.exit(1);
  }

  const optional = ["REMINDER_CHAT_ID"];
  const absent   = optional.filter((k) => !process.env[k]);
  if (absent.length) logger.warn("Optional env vars not set:", absent.join(", "));

  logger.info("Env validated ✅");
}
