import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  createUndispatchedModelObservation,
  freezeModelAccountingBasis,
  normalizeModelPhysicalObservation,
  projectModelObservationUsage,
  validateModelCallAttribution,
  validateModelPhysicalObservation,
} from "../src/model-usage-observation.js";
import {
  modelUsageFixture,
  modelUsageUndispatchedProof,
} from "./model-usage-fixture.js";

describe("physical model usage normalization", () => {
  it("retains validated usage without persisting provider output or caller mutation", () => {
    const { attribution, message } = modelUsageFixture();
    const observation = normalizeModelPhysicalObservation({
      attribution,
      message,
      terminal: "response",
    });
    expect(observation.usageStatus).toBe("known");
    expect(
      projectModelObservationUsage(attribution, observation),
    ).toMatchObject({
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        costUsd: 0.033,
      },
      tokenCompleteness: "complete",
      reportedCostCompleteness: "complete",
      budgetCostCompleteness: "complete",
      budgetTokens: 135,
    });
    expect(JSON.stringify(observation)).not.toContain(
      "Private fixture response",
    );
    message.usage.input = 900;
    expect(observation.usage.input).toBe(100);
    expect(validateModelPhysicalObservation(observation, attribution)).toEqual(
      observation,
    );
  });

  it("keeps positive subsets and reported totals as partial evidence without double counting", () => {
    const { attribution, message } = modelUsageFixture();
    message.usage.reasoning = 10;
    message.usage.cacheWrite1h = 2;
    expect(
      projectModelObservationUsage(
        attribution,
        normalizeModelPhysicalObservation({
          attribution,
          message,
          terminal: "response",
        }),
      ).budgetTokens,
    ).toBe(135);
    message.usage.reasoning = 50;
    message.usage.totalTokens = 200;
    const observation = normalizeModelPhysicalObservation({
      attribution,
      message,
      terminal: "response",
    });
    expect(observation.usageStatus).toBe("partial");
    expect(observation.diagnosticCodes).toEqual(
      expect.arrayContaining(["subset_invalid", "tokens_inconsistent"]),
    );
    expect(
      projectModelObservationUsage(attribution, observation),
    ).toMatchObject({
      usage: { outputTokens: 50 },
      tokenCompleteness: "incomplete",
      budgetTokens: 200,
    });
  });

  it("preserves valid positive components when other fields or getters are malformed", () => {
    const { attribution, message } = modelUsageFixture();
    const usage = {
      ...message.usage,
      input: Number.NaN,
      output: -1,
      cost: { ...message.usage.cost, total: Number.POSITIVE_INFINITY },
    };
    Object.defineProperty(usage, "output", {
      get() {
        throw new Error("provider getter");
      },
      enumerable: true,
    });
    const observation = normalizeModelPhysicalObservation({
      attribution,
      message: { ...message, usage },
      terminal: "response",
    });
    expect(observation.usageStatus).toBe("partial");
    expect(observation.usage).toMatchObject({
      input: null,
      output: null,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 135,
    });
    expect(observation.diagnosticCodes).toEqual(
      expect.arrayContaining([
        "tokens_invalid",
        "cost_invalid",
        "response_unhashable",
      ]),
    );
    expect(
      projectModelObservationUsage(attribution, observation).budgetTokens,
    ).toBe(135);
  });

  it("does not turn a post-entry rejection or zero provider response into undispatched zero", () => {
    const { attribution, message } = modelUsageFixture();
    expect(
      normalizeModelPhysicalObservation({ attribution, terminal: "rejected" })
        .usageStatus,
    ).toBe("unknown");
    message.usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const observation = normalizeModelPhysicalObservation({
      attribution,
      message,
      terminal: "response",
    });
    expect(observation.usageStatus).toBe("unknown");
    expect(
      projectModelObservationUsage(attribution, observation).tokenCompleteness,
    ).toBe("incomplete");
    expect(() =>
      createUndispatchedModelObservation(attribution, {} as never),
    ).toThrow("proof");
    const proof = modelUsageUndispatchedProof(attribution);
    const zero = createUndispatchedModelObservation(attribution, proof);
    expect(zero.usageStatus).toBe("known_zero_undispatched");
    expect(projectModelObservationUsage(attribution, zero)).toMatchObject({
      budgetCostUsd: 0,
      tokenCompleteness: "complete",
    });
    expect(() =>
      createUndispatchedModelObservation(attribution, structuredClone(proof)),
    ).toThrow("proof");
  });

  it("never trusts provider model fields to change the owner or frozen pricing", () => {
    const { attribution, message } = modelUsageFixture();
    message.provider = "different-provider";
    const observation = normalizeModelPhysicalObservation({
      attribution,
      message,
      terminal: "response",
    });
    expect(observation.usageStatus).toBe("partial");
    expect(observation.diagnosticCodes).toContain("model_mismatch");
    expect(observation.attributionSha256).toBe(attribution.contentSha256);
  });

  it("freezes provider and Run tariffs separately, preserving unknown prices", () => {
    const original = modelUsageFixture();
    const model = {
      ...original.model,
      provider: "deepseek",
      cost: { input: 9, output: 8, cacheRead: 7, cacheWrite: 6 },
    };
    const basis = freezeModelAccountingBasis(model);
    expect(basis.providerPriceTable?.input).toBe(9);
    expect(basis.runPriceTable?.inputUsdPerMillion).toBe(0.14);
    model.cost.input = 90;
    expect(basis.providerPriceTable?.input).toBe(9);
    const { attribution, message } = modelUsageFixture({
      model: {
        ...original.model,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    });
    message.usage.cost = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    };
    const result = projectModelObservationUsage(
      attribution,
      normalizeModelPhysicalObservation({
        attribution,
        message,
        terminal: "response",
      }),
    );
    expect(result).toMatchObject({
      tokenCompleteness: "complete",
      budgetCostCompleteness: "incomplete",
      budgetCostUsd: null,
    });
  });

  it("rejects rehashed unsupported metadata and forged completeness", () => {
    const { attribution, message } = modelUsageFixture();
    const { contentSha256: _hash, ...content } = attribution;
    const changed = { ...content, secret: "must not enter spool" };
    expect(() =>
      validateModelCallAttribution({
        ...changed,
        contentSha256: sha256(canonicalJson(changed)),
      }),
    ).toThrow("Unsupported");
    const observation = normalizeModelPhysicalObservation({
      attribution,
      terminal: "rejected",
    });
    const { contentSha256: _old, ...unknown } = observation;
    const forged = { ...unknown, usageStatus: "known" };
    expect(() =>
      validateModelPhysicalObservation(
        { ...forged, contentSha256: sha256(canonicalJson(forged)) },
        attribution,
      ),
    ).toThrow("incomplete");
    const valid = normalizeModelPhysicalObservation({
      attribution,
      message,
      terminal: "response",
    });
    expect(() =>
      validateModelPhysicalObservation(
        { ...valid, physicalId: "another" },
        attribution,
      ),
    ).toThrow();
  });
});
