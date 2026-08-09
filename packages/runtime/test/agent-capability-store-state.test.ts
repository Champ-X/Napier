import { describe, expect, it } from "vitest";

import {
  createSeededCapabilityBinding,
  type CapabilityBindingLookup,
} from "../src/agent-capability-bindings.js";
import {
  rolledBackAgentCapabilityBinding,
  storedAgentCapabilityBinding,
  updatedAgentCapabilityBinding,
  type AgentCapabilityBindingStoreState,
} from "../src/agent-capability-store-state.js";
import { createAgentProfileRevision } from "../src/agents.js";
import { createWorkspaceSeed } from "../src/workspace-seed.js";

describe("Agent capability Store state integration", () => {
  it("looks up and propagates an explicit managed override", () => {
    const original = createWorkspaceSeed().agent;
    const state: AgentCapabilityBindingStoreState = {
      agentCapabilityBindings: [createSeededCapabilityBinding(original)],
      agentRevisions: [
        createAgentProfileRevision(original, { source: "created" }),
      ],
    };

    expectValid(storedAgentCapabilityBinding(state, original.id, 1));
    const updated = {
      ...original,
      enabledSkills: [...original.enabledSkills, "stage8-proof"],
      revision: 2,
      updatedAt: after(original.createdAt, 1),
    };
    expect(updatedAgentCapabilityBinding(state, original, updated)).toEqual(
      expect.objectContaining({
        agentId: original.id,
        agentRevision: 2,
        source: "updated",
        ownership: "explicit_overrides",
        explicitOverrideFields: ["enabledSkills"],
      }),
    );
  });

  it("copies target provenance to a rollback revision", () => {
    const target = createWorkspaceSeed().agent;
    const targetRevision = createAgentProfileRevision(target, {
      source: "created",
    });
    const state: AgentCapabilityBindingStoreState = {
      agentCapabilityBindings: [createSeededCapabilityBinding(target)],
      agentRevisions: [targetRevision],
    };
    const rolledBack = {
      ...target,
      revision: 3,
      updatedAt: after(target.createdAt, 1),
    };

    expect(
      rolledBackAgentCapabilityBinding(state, targetRevision, rolledBack),
    ).toEqual(
      expect.objectContaining({
        agentId: target.id,
        agentRevision: 3,
        source: "rollback",
        ownership: "recommended",
        explicitOverrideFields: [],
      }),
    );
  });

  it("does not invent update or rollback provenance when binding is missing", () => {
    const original = createWorkspaceSeed().agent;
    const targetRevision = createAgentProfileRevision(original, {
      source: "created",
    });
    const state: AgentCapabilityBindingStoreState = {
      agentCapabilityBindings: [],
      agentRevisions: [targetRevision],
    };
    const updated = {
      ...original,
      revision: 2,
      updatedAt: after(original.createdAt, 2),
    };

    expect(storedAgentCapabilityBinding(state, original.id, 1)).toEqual({
      status: "missing",
    });
    expect(updatedAgentCapabilityBinding(state, original, updated)).toBe(
      undefined,
    );
    expect(
      rolledBackAgentCapabilityBinding(state, targetRevision, updated),
    ).toBe(undefined);
  });

  it("evaluates rollback provenance after the new revision is retained", () => {
    const target = createWorkspaceSeed().agent;
    const targetRevision = createAgentProfileRevision(target, {
      source: "created",
    });
    const current = {
      ...target,
      name: "Current before rollback",
      revision: 2,
      updatedAt: after(target.createdAt, 3),
    };
    const rolledBack = {
      ...target,
      revision: 3,
      updatedAt: after(target.createdAt, 4),
    };
    const futureBinding = {
      ...createSeededCapabilityBinding(target),
      agentRevision: rolledBack.revision,
    };
    const retainedRevisions = [
      targetRevision,
      createAgentProfileRevision(current, {
        source: "updated",
        changedFields: ["name"],
      }),
    ];
    const state: AgentCapabilityBindingStoreState = {
      agentCapabilityBindings: [
        createSeededCapabilityBinding(target),
        futureBinding,
      ],
      agentRevisions: retainedRevisions,
    };

    expect(
      rolledBackAgentCapabilityBinding(state, targetRevision, rolledBack),
    ).toBe(undefined);
    retainedRevisions.push(
      createAgentProfileRevision(rolledBack, {
        source: "rollback",
        changedFields: ["name"],
        restoredFromRevision: targetRevision.revision,
      }),
    );
    expect(
      rolledBackAgentCapabilityBinding(state, targetRevision, rolledBack),
    ).toEqual(
      expect.objectContaining({
        agentRevision: rolledBack.revision,
        source: "rollback",
        ownership: "recommended",
      }),
    );
  });
});

function after(timestamp: string, minutes: number): string {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}

function expectValid(lookup: CapabilityBindingLookup): void {
  expect(lookup.status).toBe("valid");
}
