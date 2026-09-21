import type { RunEvent } from "@napier/contracts";
import { expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import {
  inheritedHarnessPolicyOptions,
  recordRunHarnessPolicy,
} from "../src/harness-run-policy.js";
import {
  createModelHarnessExperimentProfile,
  modelHarnessExperimentProfileApplied,
} from "../src/model-harness-experiment-profile.js";

function profile(
  ordered: boolean | "contract-transitions-v2" | "proportional-v1" = false,
) {
  return createModelHarnessExperimentProfile({
    id: "state.references.v1",
    maxActiveTools: 20,
    policies: createHarnessPolicyProfile({
      id: "coding-node",
      revision: 1,
      context: {
        prompt: "legacy",
        memory: "task-aware-v1",
        workingState: "evidence-v1",
        ...(ordered === "proportional-v1"
          ? { planning: "proportional-v1" as const }
          : {}),
        ...(ordered
          ? {
              validation:
                ordered === "contract-transitions-v2"
                  ? ("contract-transitions-v2" as const)
                  : ("contract-first-v1" as const),
              verificationOrder: "before-first-patch-v1" as const,
            }
          : {}),
      },
      toolSurface: { editReferences: true },
      verification: "node-v1",
    }),
  });
}
function event(type: string, payload: RunEvent["payload"], seq = 1): RunEvent {
  return {
    id: `event_${seq}`,
    seq,
    runId: "run_source",
    threadId: "thread_test",
    type,
    payload,
    category: "model",
    visibility: "debug",
    createdAt: "2026-09-13T00:00:00.000Z",
  };
}

it.each([false, true, "contract-transitions-v2", "proportional-v1"] as const)(
  "recovers a run-bound policy before the first model call and rejects later caller mutation; ordered=%s",
  async (ordered) => {
    const selected = profile(ordered);
    const original = structuredClone(selected);
    const events: RunEvent[] = [];
    await recordRunHarnessPolicy(
      { id: "run_source", threadId: "thread_test" },
      selected,
      async (input) => {
        events.push(event(input.type, input.payload));
      },
    );
    selected.policies!.toolSurface.editReferences = false;
    const inherited = inheritedHarnessPolicyOptions(events, "run_source");
    expect(inherited.harnessExperimentProfile).toEqual(original);
    inherited.harnessExperimentProfile!.policies!.toolSurface.editReferences = false;
    expect(
      inheritedHarnessPolicyOptions(events, "run_source")
        .harnessExperimentProfile,
    ).toEqual(original);
    expect(inheritedHarnessPolicyOptions(events, "run_other")).toEqual({});
  },
);

it("restores historical applied-policy evidence and rejects conflicting or corrupt bindings", () => {
  const first = profile();
  const applied = modelHarnessExperimentProfileApplied({
    profile: first,
    receiptSha256: sha256("receipt"),
  });
  const events = [event("harness.experiment.profile.applied", applied)];
  expect(
    inheritedHarnessPolicyOptions(events, "run_source")
      .harnessExperimentProfile,
  ).toEqual(first);
  const second = createModelHarnessExperimentProfile({
    id: "different.v1",
    maxActiveTools: 20,
  });
  expect(() =>
    inheritedHarnessPolicyOptions(
      [
        ...events,
        event(
          "harness.experiment.profile.applied",
          modelHarnessExperimentProfileApplied({
            profile: second,
            receiptSha256: sha256("next"),
          }),
          2,
        ),
      ],
      "run_source",
    ),
  ).toThrow("changed within");
  const corrupt = { ...applied, maxActiveTools: 19 };
  expect(() =>
    inheritedHarnessPolicyOptions(
      [event("harness.experiment.profile.applied", corrupt)],
      "run_source",
    ),
  ).toThrow("invalid");
  const { contentSha256: _hash, ...content } = corrupt;
  const rehashed = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  expect(() =>
    inheritedHarnessPolicyOptions(
      [event("harness.experiment.profile.applied", rehashed)],
      "run_source",
    ),
  ).toThrow("hash mismatch");
});
