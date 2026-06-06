/* Telegram MarkdownV1 special characters that must be escaped when
   embedded inside bold/italic/code spans. The test suite
   (__tests__/telegramFormat.test.js) pins the exact set; adding
   additional characters here will require updating the tests. */
const MARKDOWN_SPECIALS = /([_*`\[])/g;

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
  return `\`${String(value ?? "").replace(/`/g, "'")}\``;
}
