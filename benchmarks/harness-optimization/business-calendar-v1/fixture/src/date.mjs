export function parseDate(text) {
  return Date.parse(text);
}
export function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
