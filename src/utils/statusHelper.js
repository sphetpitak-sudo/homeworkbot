import { STATUS } from "./constants.js";

export function statusLabel(status) {
    if (status === STATUS.TODO) return "📌 To Do";
    if (status === STATUS.IN_PROGRESS) return "🔄 In Progress";
    if (status === STATUS.DONE) return "✅ Done";
    return "📌 To Do";
}

export function summarizeCounts(pages) {
    let todo = 0, prog = 0, done = 0;
    for (const p of pages) {
        const s = p.properties?.Status?.select?.name;
        if (s === STATUS.TODO) todo++;
        else if (s === STATUS.IN_PROGRESS) prog++;
        else if (s === STATUS.DONE) done++;
    }
    const total = todo + prog + done;
    return { todo, prog, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}