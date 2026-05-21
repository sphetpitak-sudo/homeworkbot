import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchActive, fetchDone } from "../src/services/notionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "..", "backups");
const CORRECTIONS_FILE = path.join(__dirname, "..", ".corrections.json");

function timestamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

async function main() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const ts = timestamp();

    /* ── 1. Backup Notion data ── */
    try {
        const [active, done] = await Promise.all([fetchActive(), fetchDone()]);
        const data = { exportedAt: new Date().toISOString(), active, done };
        const notionFile = path.join(BACKUP_DIR, `notion_${ts}.json`);
        fs.writeFileSync(notionFile, JSON.stringify(data, null, 2));
        console.log(`[BACKUP] Notion data saved: ${notionFile} (${active.length} active, ${done.length} done)`);
    } catch (err) {
        console.error(`[BACKUP] Notion export failed:`, err.message);
        process.exit(1);
    }

    /* ── 2. Backup .corrections.json ── */
    try {
        if (fs.existsSync(CORRECTIONS_FILE)) {
            const correctionsFile = path.join(BACKUP_DIR, `corrections_${ts}.json`);
            fs.copyFileSync(CORRECTIONS_FILE, correctionsFile);
            console.log(`[BACKUP] Corrections saved: ${correctionsFile}`);
        } else {
            console.log(`[BACKUP] No .corrections.json found, skipping`);
        }
    } catch (err) {
        console.error(`[BACKUP] Corrections backup failed:`, err.message);
        process.exit(1);
    }

    console.log(`[BACKUP] Done. Backups stored in: ${BACKUP_DIR}`);
}

main();
