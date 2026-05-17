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
import { STATUS } from "./src/utils/constants.js";
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
const cronRunning = { priority: false, archive: false, reminder: false, weekly: false };

/* ── weekly summary ── */
async function sendWeeklySummary() {
    if (cronRunning.weekly) return;
    cronRunning.weekly = true;
    const chatId = process.env.REMINDER_CHAT_ID;
    if (!chatId) { cronRunning.weekly = false; return; }

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [activePages, donePages] = await Promise.all([fetchActive(), fetchDone()]);

        const todo = activePages.filter(p => p.properties.Status?.select?.name === STATUS.TODO).length;
        const prog = activePages.filter(p => p.properties.Status?.select?.name === STATUS.IN_PROGRESS).length;
        const done = donePages.length;
        const total = todo + prog + done;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        const overdue = activePages.filter(p => {
            const d = p.properties.Due?.date?.start;
            if (!d) return false;
            return new Date(d + "T00:00:00") < today;
        }).length;

        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        const weekDone = donePages.filter(p => {
            const d = p.properties.Due?.date?.start;
            if (!d) return false;
            return new Date(d + "T00:00:00") >= weekStart;
        }).length;

        let msg = `📊 *สรุปประจำสัปดาห์*\n━━━━━━━━━━━━━━━━━━\n`;
        msg += `✅ ทำเสร็จสัปดาห์นี้: *${weekDone}* อัน\n`;
        msg += `📋 คงเหลือ: *${todo + prog}* อัน (${pct}% เสร็จแล้ว)\n`;
        if (overdue > 0) msg += `⚠️ Overdue: *${overdue}* อัน\n`;
        msg += `\n💪 สู้ๆ นะ!`;

        await bot.telegram.sendMessage(chatId, msg, { parse_mode: "Markdown" });
        logger.info(`Weekly summary sent to ${chatId}`);
    } catch (err) {
        logger.error("Weekly summary:", err);
    } finally {
        cronRunning.weekly = false;
    }
}

/* ── cron: 06:00, 08:00, 02:00 ทุกวัน ── */
cron.schedule("0 6 * * *", autoUpdatePriority, { timezone: "Asia/Bangkok" });
cron.schedule("0 8 * * *", sendReminders, { timezone: "Asia/Bangkok" });
cron.schedule("0 2 * * *", autoArchive, { timezone: "Asia/Bangkok" });
cron.schedule("0 7 * * 1", sendWeeklySummary, { timezone: "Asia/Bangkok" });

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
