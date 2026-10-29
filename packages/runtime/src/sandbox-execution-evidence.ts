import { createHash, randomBytes } from "node:crypto";

import {
  ExecutionResourceLaunchError,
  type ExecutionResourceCleanup,
  type ExecutionResourceIdentity,
} from "./execution-resource-admission.js";

export function sandboxCleanup(
  status: ExecutionResourceCleanup["status"],
  reason: string,
): ExecutionResourceCleanup {
  return { status, scope: "sandbox_execution", reason };
}

export function sandboxExecutionIdentity(
  backend: string,
  pid?: number,
): ExecutionResourceIdentity {
  const nonce = randomBytes(24).toString("hex");
  return {
    resourceId: `${backend}:${nonce}`,
    identitySha256: createHash("sha256")
      .update(JSON.stringify({ backend, nonce, pid }))
      .digest("hex"),
  };
}

export function sandboxLaunchFailure(
  error: unknown,
  cleanup: ExecutionResourceCleanup,
  resourceIdentity?: ExecutionResourceIdentity,
): ExecutionResourceLaunchError {
  resourceIdentity ??=
    error instanceof ExecutionResourceLaunchError
      ? error.resourceIdentity
      : undefined;
  return new ExecutionResourceLaunchError(
    error instanceof Error ? error.message : "Sandbox launch failed",
    cleanup,
    { cause: error, ...(resourceIdentity ? { resourceIdentity } : {}) },
  );
}

/** Call only around work that cannot dispatch a target execution. */
export async function beforeSandboxDispatch<Value>(
  operation: () => Value | Promise<Value>,
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    throw sandboxLaunchFailure(
      error,
      sandboxCleanup("not_started", "pre_dispatch_failed"),
    );
  }
}

export function failedLaunchCleanup(error: unknown): ExecutionResourceCleanup {
  return error instanceof ExecutionResourceLaunchError
    ? error.cleanup
    : sandboxCleanup("unknown", "launch_cleanup_unconfirmed");
}
