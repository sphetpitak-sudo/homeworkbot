import "dotenv/config";
import { Telegraf }    from "telegraf";
import cron            from "node-cron";
import { validateEnv } from "./src/utils/validateEnv.js";
import { logger }      from "./src/utils/logger.js";
import { initCalendar }        from "./src/services/googleCalendarService.js";
import { initAI }              from "./src/services/aiService.js";
import { fetchUpcoming }       from "./src/services/notionService.js";
import { formatDate, formatDueDisplay } from "./src/utils/dateParser.js";
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

initCalendar();
initAI();

/* ── register handlers ── */
registerCommandHandlers(bot, userState);
registerActionHandlers(bot, userState);

/* ── global error handler (prevents crash on polling conflicts) ── */
bot.catch((err) => {
    const desc = err?.response?.description || err?.message || err?.code || err;
    logger.error(`Bot error: ${desc}`);
});

/* ── reminder ── */
async function sendReminders() {
    const chatId = process.env.REMINDER_CHAT_ID;
    if (!chatId) return;

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
    }
}

/* ── cron: 08:00 ทุกวัน ── */
cron.schedule("0 8 * * *", sendReminders, { timezone: "Asia/Bangkok" });

/* ── clean stale user states every 30 min ── */
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
    if (cleaned) logger.debug(`Cleaned ${cleaned} stale user states`);
}, 30 * 60 * 1000);

/* ── launch ── */
bot.launch();
logger.info("🤖 Homework Bot running...");

/* ── graceful shutdown ── */
const shutdown = (sig) => { logger.info(`Received ${sig}, stopping...`); bot.stop(sig); };
process.once("SIGINT",  () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
