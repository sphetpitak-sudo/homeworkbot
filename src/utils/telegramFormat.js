const MARKDOWN_SPECIALS = /([_*`\[~()|])/g;

export function escapeMarkdown(value) {
  return String(value ?? "").replace(MARKDOWN_SPECIALS, "\\$1");
}

export function safeBold(value) {
  return `*${escapeMarkdown(value)}*`;
}

export function safeItalic(value) {
  return `_${escapeMarkdown(value)}_`;
}

export function safeCode(value) {
  return `\`${String(value ?? "").replace(/`/g, "\\`")}\``;
}
