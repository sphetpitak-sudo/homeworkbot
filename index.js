import "dotenv/config";
import { Telegraf }    from "telegraf";
import cron            from "node-cron";
import { validateEnv } from "./src/utils/validateEnv.js";
import { logger }      from "./src/utils/logger.js";
import { initAI }              from "./src/services/aiService.js";
import { fetchActive, fetchUpcoming, fetchDone, archivePage, updatePriority } from "./src/services/notionService.js";
import { cacheCleanup } from "./src/services/cache.js";
import { formatDate, formatDueDisplay } from "./src/utils/dateParser.js";
import { recalcPriority } from "./src/utils/priority.js";
import { escapeMarkdown }      from "./src/utils/telegramFormat.js";
import { registerCommandHandlers } from "./src/handlers/commandHandlers.js";
import { registerActionHandlers }  from "./src/handlers/actionHandlers.js";
import { startWebServer }      from "./src/web/server.js";

/* ── validate env ── */
validateEnv();

/* ── web server (dashboard + health check) ── */
const PORT = process.env.PORT || 8080;
startWebServer(PORT);

/* ── init ── */
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const userState = new Map();

initAI();

/* ── register handlers ── */
registerCommandHandlers(bot, userState);
registerActionHandlers(bot, userState);

/* ── global error handler (prevents crash on polling conflicts) ── */
bot.catch((err) => {
    const desc = err?.response?.description || err?.message || err?.code || err;
    logger.error(`Bot error: ${desc}`);
});

/* ── cron overlap guards ── */
const cronRunning = { priority: false, archive: false, reminder: false };

/* ── reminder ── */
async function sendReminders() {
    if (cronRunning.reminder) return;
    cronRunning.reminder = true;
    const chatId = process.env.REMINDER_CHAT_ID;
    if (!chatId) { cronRunning.reminder = false; return; }

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);

        const pages = await fetchUpcoming(
            formatDate(today),
            formatDate(nextWeek),
        );
        if (!pages.length) return;

        let msg = "⏰ *แจ้งเตือนการบ้านใกล้ครบกำหนด\\!*\n━━━━━━━━━━━━━━━━━━\n";

        for (const p of pages) {
            const title =
                p.properties.Name?.title?.[0]?.plain_text || "ไม่มีชื่อ";
            const due = p.properties.Due?.date?.start || null;
            const status = p.properties.Status?.select?.name || "";
            const sub = p.properties.Subject?.rich_text?.[0]?.plain_text || "-";

            const sEmoji =
                status === "Done"
                    ? "✅"
                    : status === "In Progress"
                      ? "🔄"
                      : "📌";

            msg += `${sEmoji} *${escapeMarkdown(title)}* _${escapeMarkdown(sub)}_ — ${escapeMarkdown(formatDueDisplay(due))}\n`;
        }

        msg += "\n💪 สู้ๆ นะ\\!";

        await bot.telegram.sendMessage(chatId, msg, { parse_mode: "Markdown" });
        logger.info(`Reminder sent to ${chatId} (${pages.length} items)`);
    } catch (err) {
        logger.error("Reminder:", err);
    } finally {
        cronRunning.reminder = false;
    }
}

/* ── auto-priority (adjust priority based on proximity) ── */
async function autoUpdatePriority() {
    if (cronRunning.priority) return;
    cronRunning.priority = true;
    try {
        const pages = await fetchActive();
        let updated = 0;

        for (const p of pages) {
            const current = p.properties.Priority?.select?.name || "🟡 กลาง";
            const dueStr = p.properties.Due?.date?.start;
            const target = recalcPriority(dueStr);

            if (current !== target) {
                await updatePriority(p.id, target);
                updated++;
            }
        }

        if (updated) logger.info(`Auto-priority updated ${updated} items`);
    } catch (err) {
        logger.error("autoUpdatePriority:", err);
    } finally {
        cronRunning.priority = false;
    }
}

/* ── auto-archive ── */
async function autoArchive() {
    if (cronRunning.archive) return;
    cronRunning.archive = true;
    try {
        const pages = await fetchDone();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        cutoff.setHours(0, 0, 0, 0);
        let archived = 0;

        for (const p of pages) {
            const due = p.properties.Due?.date?.start;
            if (!due) continue;
            const dt = new Date(due + "T00:00:00");
            if (dt >= cutoff) continue;

            await archivePage(p.id);
            archived++;
        }

        if (archived) logger.info(`Auto-archived ${archived} items`);
    } catch (err) {
        logger.error("autoArchive:", err);
    } finally {
        cronRunning.archive = false;
    }
}

/* ── cron: 06:00, 08:00, 02:00 ทุกวัน ── */
cron.schedule("0 6 * * *", autoUpdatePriority, { timezone: "Asia/Bangkok" });
cron.schedule("0 8 * * *", sendReminders, { timezone: "Asia/Bangkok" });
cron.schedule("0 2 * * *", autoArchive, { timezone: "Asia/Bangkok" });

/* ── clean stale user states + expired cache every 30 min ── */
setInterval(() => {
    const TTL = 3_600_000;
    const now = Date.now();
    let cleaned = 0;
    for (const [uid, state] of userState) {
        if (now - (state._timestamp || 0) > TTL) {
            userState.delete(uid);
            cleaned++;
        }
    }
    cacheCleanup();
    if (cleaned) logger.debug(`Cleaned ${cleaned} stale user states`);
}, 30 * 60 * 1000);

/* ── launch with retry on 409 conflict ── */
async function launchBot(retries = 5, delay = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            await bot.launch();
            logger.info("🤖 Homework Bot running...");
            return;
        } catch (err) {
            const is409 = err?.response?.error_code === 409;
            if (is409 && i < retries - 1) {
                logger.warn(`409 Conflict (attempt ${i + 1}/${retries}), retrying in ${delay}ms...`);
                await new Promise((r) => setTimeout(r, delay));
                delay *= 2;
            } else {
                throw err;
            }
        }
    }
}
launchBot();

/* ── graceful shutdown ── */
const shutdown = (sig) => { logger.info(`Received ${sig}, stopping...`); bot.stop(sig); };
process.once("SIGINT",  () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
