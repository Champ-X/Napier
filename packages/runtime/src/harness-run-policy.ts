import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import type { AppendEventInput } from "./run-event-registry.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  createModelHarnessExperimentProfile,
  validateModelHarnessExperimentProfile,
  type ModelHarnessExperimentProfile,
} from "./model-harness-experiment-profile.js";

export async function recordRunHarnessPolicy(
  run: Pick<RunRecord, "id" | "threadId">,
  profile: ModelHarnessExperimentProfile | undefined,
  record: (event: AppendEventInput) => Promise<unknown>,
) {
  if (!profile) return;
  const bound = validateModelHarnessExperimentProfile(profile);
  const content = {
    kind: "napier.harness-policy-binding",
    schemaVersion: 1,
    runId: run.id,
    profileSha256: bound.contentSha256,
    profileJson: canonicalJson(bound),
  };
  await record({
    threadId: run.threadId,
    runId: run.id,
    type: "harness.policy.bound",
    category: "model",
    visibility: "debug",
    payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
  });
}

/** Restore the exact composition from the source Run. Permission and execution
 * mode are independently renegotiated by recovery; snapshot edit refs expire. */
export function inheritedHarnessPolicyOptions(
  events: readonly RunEvent[],
  runId: string,
): {
  harnessExperimentProfile?: ModelHarnessExperimentProfile;
} {
  const candidates: ModelHarnessExperimentProfile[] = [];
  for (const event of events) {
    if (
      event.runId !== runId ||
      !["harness.policy.bound", "harness.experiment.profile.applied"].includes(
        event.type,
      )
    )
      continue;
    const payload = checkedPolicyPayload(event.payload);
    let profile: ModelHarnessExperimentProfile;
    if (event.type === "harness.policy.bound") {
      profile = boundProfile(payload, runId);
    } else {
      if (
        typeof payload.profileId !== "string" ||
        typeof payload.maxActiveTools !== "number"
      )
        throw new Error("Historical Harness policy evidence is invalid");
      profile = createModelHarnessExperimentProfile({
        id: payload.profileId,
        maxActiveTools: payload.maxActiveTools,
        ...(payload.maxActiveToolsMode !== undefined
          ? {
              maxActiveToolsMode: payload.maxActiveToolsMode as "model_default",
            }
          : {}),
        ...(typeof payload.policyProfileJson === "string"
          ? { policies: JSON.parse(payload.policyProfileJson) }
          : {}),
      });
    }
    if (profile.contentSha256 !== payload.profileSha256)
      throw new Error("Harness policy recovery profile hash mismatch");
    candidates.push(profile);
  }
  if (new Set(candidates.map((profile) => profile.contentSha256)).size > 1)
    throw new Error("Harness policy changed within the source run");
  return candidates[0] ? { harnessExperimentProfile: candidates[0] } : {};
}

/** Rebind only Run identity after checking the original receipt. A portable
 * import must not repair corrupt evidence or rewrite the selected strategy. */
export function rebindImportedHarnessPolicy(
  input: JsonValue,
  ids: ReadonlyMap<string, string>,
): JsonValue {
  const payload = checkedPolicyPayload(input);
  if (typeof payload.runId !== "string")
    throw new Error("Harness policy binding is invalid");
  const profile = boundProfile(payload, payload.runId);
  if (profile.contentSha256 !== payload.profileSha256)
    throw new Error("Harness policy recovery profile hash mismatch");
  const { contentSha256: _previous, ...content } = payload;
  const rebound = {
    ...content,
    runId: ids.get(payload.runId) ?? payload.runId,
  };
  return JSON.parse(
    canonicalJson({
      ...rebound,
      contentSha256: sha256(canonicalJson(rebound)),
    }),
  ) as JsonValue;
}

function checkedPolicyPayload(value: unknown): Record<string, unknown> {
  const payload = recordValue(value);
  const { contentSha256, ...content } = payload;
  if (contentSha256 !== sha256(canonicalJson(content)))
    throw new Error("Harness policy recovery evidence is invalid");
  return payload;
}

function boundProfile(payload: Record<string, unknown>, runId: string) {
  if (
    payload.runId !== runId ||
    payload.kind !== "napier.harness-policy-binding" ||
    payload.schemaVersion !== 1 ||
    typeof payload.profileJson !== "string"
  )
    throw new Error("Harness policy binding is invalid");
  return validateModelHarnessExperimentProfile(JSON.parse(payload.profileJson));
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  throw new Error("Harness policy evidence must be an object");
}
