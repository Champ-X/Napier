import {
  clampThinkingLevel,
  type Api,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelCallPolicy } from "@napier/contracts/harness-experiments";

export const HARNESS_REASONING_OUTPUT_CAP = 8_192;

/** Bound the FIRST reasoning request, before provider dispatch. This is an
 * opt-in per-request output limit, not a relaxation of the Run or watchdog
 * budgets. It cannot guarantee latency or successful model behavior. */
export function prepareHarnessModelCallBudget(
  model: Model<Api>,
  options: SimpleStreamOptions,
  policy: ModelCallPolicy | undefined,
): SimpleStreamOptions {
  if (policy === undefined) return options;
  if (policy !== "bounded-thinking-v1")
    throw new Error("Unsupported Harness model-call budget policy");
  if (!model.reasoning || options.reasoning === undefined) return options;
  const reasoning = clampThinkingLevel(model, options.reasoning);
  if (reasoning === "off") {
    const { reasoning: _requested, ...rest } = options;
    return rest;
  }
  const requested = options.maxTokens ?? model.maxTokens;
  if (!positiveInteger(requested) || !positiveInteger(model.maxTokens))
    throw new Error("Invalid reasoning output token limit");
  return {
    ...options,
    reasoning,
    maxTokens: Math.min(requested, model.maxTokens, HARNESS_REASONING_OUTPUT_CAP),
  };
}

/** Finalizers run after prompt compilation. Reject a widened or removed cap
 * rather than silently changing the captured/compiled request afterward. */
export function assertHarnessModelCallBudget(
  model: Model<Api>,
  prepared: SimpleStreamOptions,
  finalized: SimpleStreamOptions,
  policy: ModelCallPolicy | undefined,
): void {
  if (policy === undefined) return;
  const bounded = prepareHarnessModelCallBudget(model, finalized, policy);
  if (
    finalized.maxTokens !== bounded.maxTokens ||
    finalized.reasoning !== bounded.reasoning ||
    finalized.reasoning !== prepared.reasoning ||
    (prepared.maxTokens !== undefined &&
      (!positiveInteger(finalized.maxTokens) || finalized.maxTokens > prepared.maxTokens))
  )
    throw new Error("Model-call finalization changed the bound Harness request budget");
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
