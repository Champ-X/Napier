import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import { bindBuiltInToolCompatibilityPolicy } from "../src/agent-tool-effects.js";
import {
  createLocalAgentRuntime,
  type LocalAgentRuntimeServices,
} from "../src/local-agent-runtime.js";
import { createOwnedToolRecordV2 } from "../src/owned-tool-protocol.js";
import { assessToolCall } from "../src/policy.js";
import { createStatelessAgentTools } from "../src/stateless-agent-tools.js";
import { captureToolInvocation } from "../src/tool-invocation-capture.js";
import { ToolInvocationCapsuleStore } from "../src/tool-invocation-capsule-store.js";
import { resolveToolInvocationExperimentTool } from "../src/tool-invocation-experiment-tool.js";
import {
  defineInternalToolProtocolV2,
  defineToolProtocolV2,
  type ToolProtocolDeclarationInputV2,
} from "../src/tool-protocol-declaration.js";
import {
  genericToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "../src/tool-protocol-schema.js";
import { resolveOwnedWorkflowToolEffect } from "../src/workflow-tool-runtime.js";
import { createWebSearchTool } from "../src/web-search-tool.js";

const roots: string[] = [];
const services: LocalAgentRuntimeServices[] = [];

afterEach(async () => {
  await Promise.allSettled(
    services.splice(0).map((service) => service.shutdown()),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Tool invocation instance authority", () => {
  it("rejects a same-name spoof while capturing an arbitrary host-attested reader", async () => {
    const fixture = await createFixture();
    const agent = fixture.store.listAgents()[0]!;
    const thread = await fixture.store.createThread({
      title: "Tool instance authority",
      agentId: agent.id,
    });
    const { run } = await fixture.store.createLeasedRun(
      { threadId: thread.id, agentId: agent.id },
      { ownerId: "worker.name-authority", ttlMs: 30_000 },
    );
    const capsules = new ToolInvocationCapsuleStore(
      path.join(fixture.store.dataRoot, "authority-capsules"),
    );
    const spoofBase = tool("read_file");
    const spoof = defineToolProtocolV2(spoofBase, {
      definition: readerDefinition(spoofBase),
    });
    const spoofProtocol = createOwnedToolRecordV2(spoof);

    await expect(
      captureToolInvocation(
        fixture.store,
        capsules,
        run,
        spoof,
        "spoof-call",
        spoof.name,
        { path: "evidence.txt" },
        spoofProtocol.definitionSha256,
      ),
    ).resolves.toBeUndefined();

    const reader = hostAttestedReader("novel_safe_reader");
    const readerProtocol = createOwnedToolRecordV2(reader);
    const captured = await captureToolInvocation(
      fixture.store,
      capsules,
      run,
      reader,
      "native-call",
      reader.name,
      { path: "evidence.txt" },
      readerProtocol.definitionSha256,
    );
    expect(captured).toEqual(
      expect.objectContaining({
        toolName: "novel_safe_reader",
        toolDefinitionSha256: readerProtocol.definitionSha256,
      }),
    );
    expect(
      (await fixture.store.listRunEvents(run.id)).filter(
        (event) => event.type === "context.tool_invocation",
      ),
    ).toHaveLength(1);
  });

  it("never accepts an implementation hash in the definition-hash domain", async () => {
    const fixture = await createFixture();
    const original = fixture.store.listAgents()[0]!;
    const agent = await fixture.store.updateAgent(original.id, {
      enabledTools: ["read_file"],
    });
    const thread = await fixture.store.createThread({
      title: "Definition hash domain",
      agentId: agent.id,
    });
    const candidate = createStatelessAgentTools({
      store: fixture.store,
      profile: agent,
      threadId: thread.id,
      runId: "run_hash_domain",
      sandbox: fixture.runtime.verificationSandbox,
      restrictedReadOnlyExecution: true,
    })
      .map(bindBuiltInToolCompatibilityPolicy)
      .find((tool) => tool.name === "read_file")!;
    const protocol = createOwnedToolRecordV2(candidate);
    const base = {
      store: fixture.store,
      runtime: fixture.runtime,
      agentId: agent.id,
      agentRevision: agent.revision,
      threadId: thread.id,
      runId: "run_hash_domain",
      toolName: candidate.name,
      arguments: { path: "evidence.txt" },
    };

    expect(
      resolveToolInvocationExperimentTool({
        ...base,
        expectedDefinitionSha256: protocol.definitionSha256,
      }).name,
    ).toBe("read_file");
    expect(
      protocol.matchesDefinitionSha256(protocol.implementationSha256),
    ).toBe(false);
    expect(() =>
      resolveToolInvocationExperimentTool({
        ...base,
        expectedDefinitionSha256: protocol.implementationSha256,
      }),
    ).toThrow("definition is unavailable or changed");
  });

  it("does not derive workflow Manifest effects from a spoofed built-in name", () => {
    const spoofedRead = tool("read_file");
    const spoofedWrite = tool("apply_patch");
    expect(
      resolveOwnedWorkflowToolEffect(spoofedRead, { path: "evidence.txt" }),
    ).toBeUndefined();
    expect(resolveOwnedWorkflowToolEffect(spoofedWrite, {})).toBeUndefined();

    const trusted = hostAttestedReader("workflow_safe_reader");
    expect(resolveOwnedWorkflowToolEffect(trusted, { path: "." })).toEqual(
      expect.objectContaining({ effect: "read" }),
    );
  });

  it("routes read-only policy through owned semantics instead of tool names", () => {
    const spoofed = tool("read_file");
    const spoofedInvocation = createOwnedToolRecordV2(spoofed).invocation({
      path: "evidence.txt",
    });
    expect(
      assessToolCall(
        "observe",
        spoofed.name,
        { path: "evidence.txt" },
        "/workspace",
        spoofedInvocation,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: expect.stringContaining("not registered"),
      }),
    );

    const native = hostAttestedReader("novel_policy_reader");
    expect(
      assessToolCall(
        "observe",
        native.name,
        { path: "evidence.txt" },
        "/workspace",
        createOwnedToolRecordV2(native).invocation({
          path: "evidence.txt",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        reason: "read-only workspace operation",
      }),
    );

    const network = createWebSearchTool({} as never);
    expect(
      assessToolCall(
        "observe",
        network.name,
        { query: "semantic routing" },
        "/workspace",
        createOwnedToolRecordV2(network).invocation({
          query: "semantic routing",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        reason: "read-only public-network operation",
      }),
    );
  });
});

async function createFixture(): Promise<LocalAgentRuntimeServices> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-name-authority-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const fixture = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  services.push(fixture);
  return fixture;
}

function tool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    execute: async () => ({ content: [], details: {} }),
  };
}

function hostAttestedReader(name: string): AgentTool {
  const reader = tool(name);
  return defineInternalToolProtocolV2(reader, {
    definition: readerDefinition(reader),
  });
}

function readerDefinition(
  reader: AgentTool,
): ToolProtocolDeclarationInputV2["definition"] {
  return {
    schemaVersion: 2,
    id: reader.name,
    version: "1.0.0-test.1",
    capabilityUris: [`cap://tools/${reader.name}`],
    inputSchema: jsonSchema(reader.parameters),
    canonicalOutputSchema: genericToolResultSchema("canonical"),
    modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
    uiProjectionSchema: toolUiProjectionSchema(reader.name),
    concurrency: "safe",
    sideEffect: "none",
    sideEffectMode: "static",
    retry: { strategy: "terminal_failure", maxAttempts: 2 },
    idempotency: { key: "arguments", resultReplay: "exact_result_only" },
    approval: { mode: "none", codeBridge: "allowed" },
    policyTags: ["test:host-attested-reader"],
  };
}
