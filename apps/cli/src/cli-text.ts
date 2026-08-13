export function signedNumber(value: number, fractionDigits?: number): string {
  const text =
    fractionDigits === undefined
      ? String(value)
      : value.toFixed(fractionDigits);
  return value > 0 ? `+${text}` : text;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}
