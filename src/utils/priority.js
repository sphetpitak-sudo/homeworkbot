import { PRIORITY } from "./constants.js";

export function recalcPriority(dueStr) {
    if (!dueStr) return PRIORITY.LOW;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueStr + "T00:00:00");
    const diffDays = Math.ceil((due - today) / 86400000);
    if (diffDays <= 3) return PRIORITY.HIGH;
    if (diffDays <= 14) return PRIORITY.MEDIUM;
    return PRIORITY.LOW;
}