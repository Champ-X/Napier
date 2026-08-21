import type { RunEvent } from "@napier/contracts";

import { validateConversationSurfaceCapsuleReceipt } from "./conversation-surface-capsule.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const UNAVAILABLE_REASONS = new Set(["limit", "storage", "invalid"]);

export function groupedConversationSurfaceDeclarations(
  events: RunEvent[],
): RunEvent[][] {
  const groups = new Map<string, RunEvent[]>();
  for (const event of events) {
    if (!isSurfaceDeclaration(event)) continue;
    const key = declarationKey(event);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function isSurfaceDeclaration(event: RunEvent): boolean {
  return (
    event.type === "context.conversation_surface" ||
    event.type === "context.conversation_surface_unavailable"
  );
}

function declarationKey(event: RunEvent): string {
  try {
    return event.type === "context.conversation_surface"
      ? receiptKey(event)
      : unavailableKey(event);
  } catch {
    return `invalid:${event.id}`;
  }
}

function receiptKey(event: RunEvent): string {
  const receipt = validateConversationSurfaceCapsuleReceipt(event.payload);
  return `${event.runId}:${String(receipt.modelContextEnvelopeTurnIndex)}`;
}

function unavailableKey(event: RunEvent): string {
  const payload = jsonRecord(event.payload);
  validateUnavailableDeclaration(payload);
  const envelopeSha256 = payload["modelContextEnvelopeSha256"];
  const turnIndex = payload["modelContextEnvelopeTurnIndex"];
  if (envelopeSha256 === undefined && turnIndex === undefined) {
    return `unavailable:${event.id}`;
  }
  validateEnvelopeBinding(envelopeSha256, turnIndex);
  return `${event.runId}:${String(turnIndex)}`;
}

function validateUnavailableDeclaration(
  payload: Record<string, unknown>,
): void {
  if (
    payload["schemaVersion"] !== 1 ||
    !positiveInteger(payload["toolCallCount"]) ||
    !UNAVAILABLE_REASONS.has(String(payload["reason"])) ||
    !sha256(payload["diagnosticSha256"])
  ) {
    throw new Error("Conversation Surface unavailable declaration is invalid");
  }
}

function validateEnvelopeBinding(sha: unknown, turnIndex: unknown): void {
  if (!sha256(sha) || !nonNegativeInteger(turnIndex)) {
    throw new Error("Conversation Surface unavailable binding is invalid");
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Conversation Surface declaration payload is invalid");
  }
  return value as Record<string, unknown>;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
