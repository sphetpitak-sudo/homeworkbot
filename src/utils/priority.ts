import { PRIORITY } from "./constants.js";

export function recalcPriority(dueStr) {
    if (!dueStr) return PRIORITY.LOW;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueStr + "T00:00:00");
    if (!due || isNaN(due.getTime())) return PRIORITY.MEDIUM;
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    if (diffDays < -30) return PRIORITY.LOW;   // overdue >30 days → too old
    if (diffDays <= 3) return PRIORITY.HIGH;   // ≤3 days → urgent (covers overdue + today + 3 days out)
    if (diffDays <= 14) return PRIORITY.MEDIUM; // ≤14 days → normal
    return PRIORITY.LOW;                        // >14 days → low
}