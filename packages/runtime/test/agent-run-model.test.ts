import { describe, expect, it, vi } from "vitest";

import { resolveAgentRunModel } from "../src/agent-run-model.js";

const AGENT = {
  id: "agent_napier",
  model: { provider: "napier", id: "demo" },
} as never;

describe("Agent Run model resolution", () => {
  it("keeps explicit caller choice ahead of the live-ready recommendation", async () => {
    const recommendDefaultRunModel = vi.fn(async () => ({
      provider: "deepseek",
      id: "deepseek-v4-flash",
    }));

    await expect(
      Promise.resolve(
        resolveAgentRunModel(
          {
            listCredentialReferences: vi.fn(),
            listAgentRevisions: vi.fn(),
          } as never,
          { recommendDefaultRunModel },
          AGENT,
          "user",
          { provider: "openrouter", id: "auto" },
        ),
      ),
    ).resolves.toEqual({ provider: "openrouter", id: "auto" });
    expect(recommendDefaultRunModel).not.toHaveBeenCalled();
  });

  it("does not auto-select a model for workflow or recovery Runs", async () => {
    const recommendDefaultRunModel = vi.fn(async () => ({
      provider: "deepseek",
      id: "deepseek-v4-flash",
    }));

    await expect(
      Promise.resolve(
        resolveAgentRunModel(
          {
            listCredentialReferences: vi.fn(),
            listAgentRevisions: vi.fn(),
          } as never,
          { recommendDefaultRunModel },
          AGENT,
          "workflow",
        ),
      ),
    ).resolves.toEqual({ provider: "napier", id: "demo" });
    expect(recommendDefaultRunModel).not.toHaveBeenCalled();
  });
});
