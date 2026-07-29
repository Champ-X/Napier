export function normalizeTitle(value: string): string {
  return value.trim();
}

export const defaultTitle = normalizeTitle(" default ");
