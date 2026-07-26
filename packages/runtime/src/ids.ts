import { randomUUID } from "node:crypto";

const PREFIX_PATTERN = /^[a-z][a-z0-9_]{1,15}$/;

export function createId(prefix: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid ID prefix: ${prefix}`);
  }
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
