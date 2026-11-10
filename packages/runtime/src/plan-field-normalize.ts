import path from "node:path";

import type {
  ArtifactManifestEntry,
  PlanStep,
  ReplanExecutionPlanRequest,
} from "@napier/contracts";

export function normalizeEntityIdList(
  values: string[] | undefined,
  label: string,
  maxItems: number,
): string[] {
  if (!values) return [];
  if (values.length > maxItems) {
    throw new Error(`Too many ${label} IDs`);
  }
  return [...new Set(values.map((value) => normalizeEntityId(value, label)))];
}

export function normalizeDependencyUpdates(
  updates: ReplanExecutionPlanRequest["dependencyUpdates"] | undefined,
  maxSteps: number,
): Array<{ stepId: string; dependsOn: string[] }> {
  if (!updates) return [];
  if (updates.length > maxSteps) {
    throw new Error(`Plans allow at most ${maxSteps} dependency updates`);
  }
  const seen = new Set<string>();
  return updates.map((update) => {
    const stepId = normalizeEntityId(update.stepId, "step");
    if (seen.has(stepId)) {
      throw new Error(`Duplicate dependency update for plan step: ${stepId}`);
    }
    seen.add(stepId);
    return {
      stepId,
      dependsOn: [
        ...new Set(
          update.dependsOn.map((dependency) =>
            normalizeEntityId(dependency, "step"),
          ),
        ),
      ],
    };
  });
}

export function replanStepDigestInput(step: PlanStep): {
  id: string;
  title: string;
  description: string;
  verification: string;
  dependsOn: string[];
} {
  return {
    id: step.id,
    title: step.title,
    description: step.description,
    verification: step.verification,
    dependsOn: step.dependsOn,
  };
}

export function replanArtifactDigestInput(artifact: ArtifactManifestEntry): {
  id: string;
  path: string;
  kind: ArtifactManifestEntry["kind"];
  description: string;
} {
  return {
    id: artifact.id,
    path: artifact.path,
    kind: artifact.kind,
    description: artifact.description,
  };
}

export function normalizeEntityId(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(`Invalid ${label} ID: ${value}`);
  }
  return normalized;
}

export function normalizeArtifactPath(
  value: string,
  kind: ArtifactManifestEntry["kind"],
): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Artifact path is required");
  if (kind === "url") {
    const url = new URL(normalized);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      throw new Error("Artifact URLs must be credential-free HTTP(S) URLs");
    }
    return url.toString();
  }
  if (kind === "file" || kind === "directory") {
    if (path.isAbsolute(normalized)) {
      throw new Error("Artifact paths must be workspace-relative");
    }
    const relative = path.normalize(normalized);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      relative === "."
    ) {
      throw new Error("Artifact path escapes the workspace");
    }
    return relative;
  }
  return normalizeText(normalized, 500);
}

export function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}
