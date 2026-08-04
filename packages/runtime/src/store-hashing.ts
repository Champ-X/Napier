import { createHash } from "node:crypto";

export function storeSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function storeCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(storeCanonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${storeCanonicalJson(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
