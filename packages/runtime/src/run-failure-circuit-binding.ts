import { canonicalJson, sha256 } from "./ed25519.js";
import {
  progressFailureBinding,
  type RunConvergenceToolProgress,
} from "./run-convergence-tool-progress.js";
import type {
  ParsedRunFailure,
  RunFailureCircuitScope,
} from "./run-failure-circuit-model.js";

export function bindRunFailure(
  failure: ParsedRunFailure,
  progress: RunConvergenceToolProgress,
  callId: string | undefined,
): { failure: ParsedRunFailure; bindingSha256: string } | undefined {
  if (declaredBindingMismatch(failure, progress)) {
    if (!callId) return undefined;
    const { bindingSha256: _bindingSha256, ...unboundFailure } = failure;
    return {
      failure: {
        ...unboundFailure,
        class: "unknown",
        scope: "invocation",
        disposition: "terminal",
        fatalToSession: false,
        coverage: "invalid_declared",
      },
      bindingSha256: sha256(canonicalJson({ callId })),
    };
  }
  const bindingSha256 = scopedFailureBinding(
    failure.scope,
    progress,
    callId,
    failure.bindingSha256,
  );
  return bindingSha256 ? { failure, bindingSha256 } : undefined;
}

export function scopedFailureBinding(
  scope: RunFailureCircuitScope,
  progress: RunConvergenceToolProgress,
  callId: string | undefined,
  receiptBindingSha256?: string,
): string | undefined {
  if (scope === "invocation") {
    return callId ? sha256(canonicalJson({ callId })) : undefined;
  }
  const progressBinding = progressFailureBinding(progress, scope);
  if (receiptBindingSha256) {
    return progressBinding && progressBinding !== receiptBindingSha256
      ? undefined
      : receiptBindingSha256;
  }
  return progressBinding;
}

function declaredBindingMismatch(
  failure: ParsedRunFailure,
  progress: RunConvergenceToolProgress,
): boolean {
  if (
    failure.coverage !== "trusted_declared" ||
    failure.scope === "invocation" ||
    !failure.bindingSha256
  ) {
    return false;
  }
  const progressBinding = progressFailureBinding(progress, failure.scope);
  return Boolean(progressBinding && progressBinding !== failure.bindingSha256);
}
