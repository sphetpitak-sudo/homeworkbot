// ── Notion status values (must match Notion DB select options exactly) ──
export const STATUS = {
    TODO: "Todo",
    IN_PROGRESS: "In Progress",
    DONE: "Done",
};

// ── Priority ──
export const PRIORITY = {
    HIGH: "🔴 สูง",
    MEDIUM: "🟡 กลาง",
    LOW: "🟢 ต่ำ",
};
export const PRIORITY_ORDER = [PRIORITY.HIGH, PRIORITY.MEDIUM, PRIORITY.LOW];
export const PRIORITY_DEFAULT = PRIORITY.MEDIUM;

export function priorityWeight(p) {
    const idx = PRIORITY_ORDER.indexOf(p);
    return idx === -1 ? 1 : PRIORITY_ORDER.length - idx;
}

// ── Dashboard limits ──
export const URGENT_DAYS = 3;
export const URGENT_DISPLAY_MAX = 5;
export const SUBJECT_BAR_MAX = 6;
export const SUBJECT_DISPLAY_MAX = 6;
export const PROGRESS_BAR_SLOTS = 10;

// ── Notion pagination ──
export const NOTION_PAGE_SIZE = 100;
