import { expect, it } from "vitest";
import {
  presetHarnessPolicy,
  createHarnessPolicyProfile,
} from "../src/harness-policy-profile.js";
import { createAgentPromptCompilerLayers } from "../src/agent-prompt-layers.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import { ModelRegistry } from "../src/models.js";
import {
  compileRuntimeContextPrompt,
  runtimeContextDelivery,
} from "../src/runtime-context-delivery.js";
import { STABLE_PROMPT_COMPILER_ASSEMBLY } from "../src/prompt-compiler.js";
import {
  CONTRACT_VERIFICATION_PROTOCOL,
  CONTRACT_TRANSITION_VERIFICATION_PROTOCOL,
  CONTRACT_STAGED_VERIFICATION_PROTOCOL,
} from "../src/contract-verification-protocol.js";

it("binds the optional protocol without changing existing preset hashes or admitting unknown strategy keys", () => {
  const {
    schemaVersion: _schema,
    contentSha256: originalHash,
    ...base
  } = presetHarnessPolicy("coding-node.v1");
  for (const delivery of [undefined, "tail-v1"] as const)
    for (const finalization of [undefined, "request-aware-v1", "request-aware-v2"] as const) {
      const profile = createHarnessPolicyProfile({
        ...base,
        context: {
          ...base.context,
          ...(delivery ? { delivery } : {}),
          ...(finalization ? { finalization } : {}),
          validation: "contract-first-v1",
        },
      });
      expect(profile.contentSha256).not.toBe(originalHash);
      expect(profile.context.validation).toBe("contract-first-v1");
    }
  expect(presetHarnessPolicy("coding-node.v1").contentSha256).toBe(
    originalHash,
  );
  const ordered = createHarnessPolicyProfile({
    ...base,
    context: {
      ...base.context,
      validation: "contract-first-v1",
      verificationOrder: "before-first-patch-v1",
    },
  });
  expect(ordered.contentSha256).not.toBe(originalHash);
  expect(ordered.context.verificationOrder).toBe("before-first-patch-v1");
  expect(() =>
    createHarnessPolicyProfile({
      ...base,
      context: { ...base.context, verificationOrder: "before-first-patch-v1" },
    }),
  ).toThrow("Invalid Harness");
  expect(() =>
    createHarnessPolicyProfile({
      ...base,
      context: {
        ...base.context,
        validation: "contract-first-v1",
        verificationOrder: "unknown" as "before-first-patch-v1",
      },
    }),
  ).toThrow("Invalid Harness");
  expect(() =>
    createHarnessPolicyProfile({
      ...base,
      context: {
        ...base.context,
        validation: "unknown" as "contract-first-v1",
      },
    }),
  ).toThrow("Invalid Harness");
  expect(() =>
    createHarnessPolicyProfile({
      ...base,
      context: {
        ...base.context,
        validation: "contract-first-v1",
        extra: true,
      } as typeof base.context,
    }),
  ).toThrow("Invalid Harness");
});

it.each(["contract-first-v1", "contract-transitions-v2", "contract-staged-v3"] as const)(
  "keeps %s in stable instruction content across changing runtime tails",
  (validation) => {
    const protocol =
      validation === "contract-first-v1"
        ? CONTRACT_VERIFICATION_PROTOCOL
        : validation === "contract-staged-v3"
          ? CONTRACT_STAGED_VERIFICATION_PROTOCOL
          : CONTRACT_TRANSITION_VERIFICATION_PROTOCOL;
    const compile = (memory: string, enabled: boolean) =>
      compileRuntimeContextPrompt(
        {
          purpose: "agent_turn",
          assembly: STABLE_PROMPT_COMPILER_ASSEMBLY,
          adapter: modelAdapterReceipt(
            new ModelRegistry().resolve({
              provider: "deepseek",
              id: "deepseek-v4-flash",
            })!,
          ),
          layers: createAgentPromptCompilerLayers({
            resolvedSystemPrompt: "Complete the user's task.",
            skillCatalog: "",
            effectiveCapabilities: "Use admitted tools.",
            workspaceToolGuidance: "Read and edit inside the workspace.",
            planToolGuidance: "",
            sourceContinuityGuidance: "",
            importedLedgerBoundary: "",
            checkpoint: "",
            memory,
            delegation: "",
            milestones: "",
            toolLoopGuard: "",
            ...(enabled ? { validationProtocol: validation } : {}),
          }),
        },
        "tail-v1",
      );
    const first = compile("first fact", true),
      second = compile("changed fact", true),
      ordinary = compile("first fact", false);
    expect(first.systemPrompt).toContain(protocol);
    expect(first.systemPrompt).toBe(second.systemPrompt);
    expect(ordinary.systemPrompt).not.toContain(protocol);
    expect(
      runtimeContextDelivery(first)!.sources.every(
        (source) => !source.content.includes(protocol),
      ),
    ).toBe(true);
    expect(
      first.layers
        .flatMap((layer) => layer.sources)
        .find((source) => source.sourceId === "task.contract_verification"),
    ).toMatchObject({ included: true });
  },
);

it("validates the transition strategy with pre-edit ordering and preserves old bindings", () => {
  const {
    schemaVersion: _schema,
    contentSha256: oldHash,
    ...base
  } = presetHarnessPolicy("coding-python.v1");
  const selected = createHarnessPolicyProfile({
    ...base,
    context: {
      ...base.context,
      validation: "contract-transitions-v2",
      verificationOrder: "before-first-patch-v1",
    },
  });
  expect(selected.context.validation).toBe("contract-transitions-v2");
  expect(selected.contentSha256).not.toBe(oldHash);
  expect(presetHarnessPolicy("coding-python.v1").contentSha256).toBe(oldHash);
  expect(CONTRACT_VERIFICATION_PROTOCOL).not.toContain(
    "contract-transitions-v2",
  );
  expect(CONTRACT_TRANSITION_VERIFICATION_PROTOCOL).toContain(
    'version="contract-transitions-v2"',
  );
});
