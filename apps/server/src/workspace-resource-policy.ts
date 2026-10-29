import type { LocalAgentRuntimeOptions } from "@napier/runtime/agent";

export type ResourceAdmission = NonNullable<LocalAgentRuntimeOptions["resourceAdmission"]>;
export type ResourceRequest = Parameters<ResourceAdmission["reserve"]>[0];
export type ResourceKind = ResourceRequest["kind"];
export type ResourceLease = ReturnType<ResourceAdmission["reserve"]>;
export type ResourceIdentity = Parameters<ResourceLease["bind"]>[0];
export type ResourceCleanup = Parameters<ResourceLease["settle"]>[0];
export type WorkspaceResourceLimits = Record<ResourceKind, number>;
export const RESOURCE_KINDS = ["sandbox_execution", "browser_session", "browser_task"] as const;
const DEFAULTS: WorkspaceResourceLimits = { sandbox_execution: 32, browser_session: 4, browser_task: 4 };

export function workspaceResourceLimits(options: Partial<WorkspaceResourceLimits> = {}): WorkspaceResourceLimits {
  const limits = { ...DEFAULTS, ...options };
  for (const kind of RESOURCE_KINDS) {
    if (!Number.isSafeInteger(limits[kind]) || limits[kind] < 1 || limits[kind] > 256) {
      throw new Error(`Invalid workspace resource capacity: ${kind}`);
    }
  }
  return Object.freeze(limits);
}

export function workspaceResourceLimitsFromEnvironment(env: Readonly<Record<string, string | undefined>>): Partial<WorkspaceResourceLimits> {
  const names = {
    sandbox_execution: "NAPIER_SANDBOX_MAX_CONCURRENT",
    browser_session: "NAPIER_BROWSER_SESSION_MAX_CONCURRENT",
    browser_task: "NAPIER_BROWSER_TASK_MAX_CONCURRENT",
  } as const;
  const result: Partial<WorkspaceResourceLimits> = {};
  for (const kind of RESOURCE_KINDS) {
    const value = env[names[kind]];
    if (value !== undefined) {
      if (!/^[1-9]\d*$/u.test(value)) throw new Error(`Invalid ${names[kind]}`);
      result[kind] = Number(value);
    }
  }
  workspaceResourceLimits(result);
  return result;
}

export function validateResourceRequest(request: ResourceRequest): void {
  if (!RESOURCE_KINDS.includes(request.kind) || typeof request.backend !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,100}$/u.test(request.backend)) {
    throw new Error("Invalid execution resource request");
  }
}

export function encodeResourceIdentity(identity: ResourceIdentity): string {
  if (typeof identity.resourceId !== "string" || identity.resourceId.length < 1 || identity.resourceId.length > 512 ||
      /[\u0000-\u001f]/u.test(identity.resourceId) ||
      (identity.identitySha256 !== undefined && (typeof identity.identitySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(identity.identitySha256)))) {
    throw new Error("Invalid execution resource identity");
  }
  return JSON.stringify({ resourceId: identity.resourceId, ...(identity.identitySha256 ? { identitySha256: identity.identitySha256 } : {}) });
}

export function encodeResourceCleanup(evidence: ResourceCleanup, kind: ResourceKind): string {
  if (evidence.scope !== kind || !["not_started", "released", "unknown"].includes(evidence.status) || typeof evidence.reason !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,100}$/u.test(evidence.reason)) {
    throw new Error("Invalid execution resource cleanup evidence");
  }
  return JSON.stringify({ status: evidence.status, scope: kind, reason: evidence.reason });
}
