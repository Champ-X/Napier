export const COMPATIBILITY_METRIC_IDS = [
  "compat.conversation_surface.legacy_read",
  "compat.store.legacy_json_read",
  "compat.store.projection_write",
  "compat.agent_capability.legacy_binding_read",
  "compat.skill.project_legacy_read",
  "compat.workflow.legacy_terminal_read",
  "compat.receipt.legacy_read",
  "compat.inbound_auth.legacy_bearer_read",
] as const;

export type CompatibilityMetricId = (typeof COMPATIBILITY_METRIC_IDS)[number];

export interface CompatibilityMetricSnapshot {
  id: CompatibilityMetricId;
  count: number;
}

export interface CompatibilityTelemetrySnapshot {
  schemaVersion: 1;
  privacy: "fixed_id_count_only";
  metrics: CompatibilityMetricSnapshot[];
}

const counts = new Map<CompatibilityMetricId, number>();

export function recordCompatibilityHit(id: CompatibilityMetricId): void {
  counts.set(id, Math.min(Number.MAX_SAFE_INTEGER, (counts.get(id) ?? 0) + 1));
}

export function compatibilityTelemetrySnapshot(): CompatibilityTelemetrySnapshot {
  return {
    schemaVersion: 1,
    privacy: "fixed_id_count_only",
    metrics: COMPATIBILITY_METRIC_IDS.map((id) => ({
      id,
      count: counts.get(id) ?? 0,
    })),
  };
}

export function resetCompatibilityTelemetryForTest(): void {
  counts.clear();
}
