import type {
  ToolProgressContribution,
  ToolProgressOperation,
  ToolProgressReceiptV1,
} from "@napier/contracts/tool-protocol";
import { describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  projectRunEffectReadiness,
  reduceRunEffectReadiness,
  type RunEffectReadinessObservation,
  type RunMarginalProgressEvidenceV1,
  type RunVerificationBindingV1,
} from "../src/run-effect-readiness-projection.js";

describe("run effect and delivery readiness projection", () => {
  it("does not mistake A -> B -> C effects for monotonic progress", () => {
    const resource = hash("artifact");
    const states = [hash("A"), hash("B"), hash("C")];
    const projection = projectRunEffectReadiness(
      states.map((state, index) =>
        product(`product-${index}`, resource, state),
      ),
    );

    expect(projection.effectCount).toBe(3);
    expect(projection.products[resource]).toMatchObject({
      currentStateSha256: states[2],
      revision: 3,
      latestEffect: "changed",
      latestMarginalProgress: "indeterminate",
    });
    expect(projection.marginalAdvancedCount).toBe(0);
    expect(projection.indeterminateEffectCount).toBe(3);
    expect(projection.deliveryReadiness.status).toBe("unverified");
  });

  it("counts marginal progress only from objective-bound transition evidence", () => {
    const resource = hash("artifact");
    const before = hash("before");
    const after = hash("after");
    const evidence: RunMarginalProgressEvidenceV1 = {
      kind: "napier.run-marginal-progress-evidence",
      schemaVersion: 1,
      objectiveSha256: hash("objective"),
      direction: "advanced",
      fromStateSha256: before,
      toStateSha256: after,
      evidenceSha256: hash("proof"),
    };
    const projection = projectRunEffectReadiness([
      product("initial", resource, before),
      product("advanced", resource, after, evidence),
    ]);

    expect(projection.marginalAdvancedCount).toBe(1);
    expect(projection.products[resource]?.latestMarginalProgress).toBe(
      "advanced",
    );

    const invalid = projectRunEffectReadiness([
      product("initial", resource, before),
      product("spoofed", resource, after, {
        ...evidence,
        fromStateSha256: hash("not-the-observed-before-state"),
      }),
    ]);
    expect(invalid.marginalAdvancedCount).toBe(0);
    expect(invalid.invalidMarginalEvidenceCount).toBe(1);
    expect(invalid.products[resource]?.latestMarginalProgress).toBe("invalid");

    const wrongObjective = projectRunEffectReadiness([
      product("initial", resource, before),
      product("wrong-objective", resource, after, {
        ...evidence,
        objectiveSha256: hash("different objective"),
      }),
    ]);
    expect(wrongObjective.marginalAdvancedCount).toBe(0);
    expect(wrongObjective.invalidMarginalEvidenceCount).toBe(1);
  });

  it("makes verification stale after a later product mutation", () => {
    const resource = hash("artifact");
    const stateA = hash("A");
    const stateB = hash("B");
    const observations: RunEffectReadinessObservation[] = [
      product("product-a", resource, stateA),
      verification("verify-a", resource, stateA, "passed"),
    ];
    const verified = projectRunEffectReadiness(observations);
    expect(verified.deliveryReadiness.status).toBe("ready");

    const changed = reduceRunEffectReadiness(
      verified,
      product("product-b", resource, stateB),
    );
    expect(changed.deliveryReadiness).toMatchObject({
      status: "stale",
      blockers: [{ resourceKeySha256: resource, reason: "stale_verification" }],
    });

    // Returning to the old bytes does not resurrect old evidence: verification
    // is bound to the product revision at which it actually ran.
    const reverted = reduceRunEffectReadiness(
      changed,
      product("product-a-again", resource, stateA),
    );
    expect(reverted.products[resource]?.revision).toBe(3);
    expect(reverted.deliveryReadiness.status).toBe("stale");

    const reverified = reduceRunEffectReadiness(
      reverted,
      verification("verify-a-again", resource, stateA, "passed"),
    );
    expect(reverified.deliveryReadiness.status).toBe("ready");
  });

  it("does not let unbound verification make a product deliverable", () => {
    const resource = hash("artifact");
    const state = hash("A");
    const projection = projectRunEffectReadiness([
      product("product", resource, state),
      {
        kind: "tool_progress_receipt",
        observationId: "unbound-verification",
        objectiveSha256: hash("objective"),
        receipt: receipt(
          "verify",
          "verification",
          hash("verification-resource"),
          hash("verification-evidence"),
        ),
      },
    ]);

    expect(projection.unboundVerificationCount).toBe(1);
    expect(projection.deliveryReadiness.status).toBe("unverified");
  });

  it("treats an assistant message as a delivery attempt, not acceptance", () => {
    const resource = hash("artifact");
    const state = hash("A");
    const ready = projectRunEffectReadiness([
      product("product", resource, state),
      verification("verification", resource, state, "passed"),
    ]);
    const attempted = reduceRunEffectReadiness(ready, {
      kind: "assistant_delivery",
      observationId: "assistant-message",
      contentSha256: hash("final answer"),
    });

    expect(attempted.deliveryReadiness.status).toBe("ready");
    expect(attempted.deliveryAttempts).toEqual([
      expect.objectContaining({
        observationId: "assistant-message",
        readinessAtAttempt: "ready",
        accepted: false,
      }),
    ]);
    expect(attempted.explicitAcceptanceCount).toBe(0);

    const accepted = reduceRunEffectReadiness(attempted, {
      kind: "delivery_acceptance",
      observationId: "operator-acceptance",
      deliveryObservationId: "assistant-message",
      evidenceSha256: hash("operator accepted this delivery"),
    });
    expect(accepted.explicitAcceptanceCount).toBe(1);
    expect(accepted.deliveryAttempts[0]).toMatchObject({
      accepted: true,
      acceptanceEvidenceSha256: hash("operator accepted this delivery"),
    });
  });

  it("is idempotent by observation identity", () => {
    const resource = hash("artifact");
    const observation = product("same-observation", resource, hash("A"));
    const once = projectRunEffectReadiness([observation]);
    const twice = reduceRunEffectReadiness(once, observation);

    expect(twice).toBe(once);
    expect(twice.effectCount).toBe(1);
  });
});

function product(
  observationId: string,
  resourceKeySha256: string,
  stateSha256: string,
  marginalProgress?: RunMarginalProgressEvidenceV1,
): RunEffectReadinessObservation {
  return {
    kind: "tool_progress_receipt",
    observationId,
    objectiveSha256: hash("objective"),
    receipt: receipt("mutate", "product", resourceKeySha256, stateSha256),
    ...(marginalProgress ? { marginalProgress } : {}),
  };
}

function verification(
  observationId: string,
  productResourceKeySha256: string,
  productStateSha256: string,
  verdict: RunVerificationBindingV1["verdict"],
): RunEffectReadinessObservation {
  return {
    kind: "tool_progress_receipt",
    observationId,
    objectiveSha256: hash("objective"),
    receipt: receipt(
      "verify",
      "verification",
      hash(`verification:${productResourceKeySha256}`),
      hash(`evidence:${observationId}`),
    ),
    verification: {
      kind: "napier.run-verification-binding",
      schemaVersion: 1,
      productResourceKeySha256,
      productStateSha256,
      verdict,
    },
  };
}

function receipt(
  operation: ToolProgressOperation,
  contribution: ToolProgressContribution,
  resourceKeySha256: string,
  stateSha256: string,
): ToolProgressReceiptV1 {
  return {
    kind: "napier.tool-progress-semantics",
    schemaVersion: 1,
    availability: "declared",
    coverage: "trusted_declared",
    operation,
    scope: "workspace",
    contribution,
    resourceKeySha256,
    stateSha256,
  };
}

function hash(value: string): string {
  return sha256(value);
}
