import { PRIORITY } from "./constants.js";

export function recalcPriority(dueStr) {
    if (!dueStr) return PRIORITY.LOW;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueStr + "T00:00:00");
    const diffDays = Math.ceil((due - today) / 86400000);
    if (diffDays < -30) return PRIORITY.LOW;  // overdue >30 days → too old
    if (diffDays <= 3) return PRIORITY.HIGH;   // ≤3 days → urgent
    if (diffDays <= 14) return PRIORITY.MEDIUM; // ≤14 days → normal
    return PRIORITY.LOW;                        // >14 days or future → low
}