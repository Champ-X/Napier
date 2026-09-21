import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { formatPlanToolGuidance } from "../src/agent-runtime-utils.js";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import { validateModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";

it("requires explicit hash-bound planning selection, preserves v3 and rejects unknown policies", async () => {
  const original = validateModelHarnessExperimentProfile(
    JSON.parse(
      await readFile(
        new URL(
          "../../../benchmarks/harness-profiles/current-integrated.v3.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  expect(original.contentSha256).toBe(
    "dcc5de0cd1b3ba6ca09e9d741d1670ba649c28ba97eac35d68435d2eb075c038",
  );
  const { schemaVersion: _v, contentSha256: _h, ...base } = original.policies!;
  const selected = createHarnessPolicyProfile({
    ...base,
    context: { ...base.context, planning: "proportional-v1" },
  });
  expect(selected.contentSha256).not.toBe(original.policies!.contentSha256);
  expect(original.policies!.context.planning).toBeUndefined();
  expect(() =>
    createHarnessPolicyProfile({
      ...base,
      context: { ...base.context, planning: "unknown" as "proportional-v1" },
    }),
  ).toThrow("Invalid Harness");
  const tools = [{ name: "create_plan" }, { name: "update_plan_step" }];
  const legacy = formatPlanToolGuidance(tools);
  const guidance = formatPlanToolGuidance(tools, selected.context.planning);
  expect(legacy).toContain("Start a step before acting on it");
  expect(guidance).not.toContain("Start a step before acting on it");
  expect(guidance).toContain("This does not start dependent steps");
  expect(guidance).toContain("Wait for each update_plan_step result");
  expect(guidance).toContain("Continue any existing required plan");
  expect(guidance).toContain(
    "preserve required verification and edit ordering",
  );
  expect(formatPlanToolGuidance([], "proportional-v1")).toBe("");
});
