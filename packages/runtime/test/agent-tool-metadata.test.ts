import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import { AgentLifecyclePipelineHost } from "../src/lifecycle-extension-pipeline.js";
import { wrapAgentToolsWithLifecycle } from "../src/agent-runtime-step-lifecycle.js";
import { LocalStore } from "../src/store.js";
import type { SubagentWorktreeSession } from "../src/subagent-worktree-files.js";
import { SubagentWorktreeOperationCoordinator } from "../src/subagent-worktree-verification.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { validateToolDefinitionV2 } from "../src/owned-tool-protocol.js";
import {
  defineToolFailureSemantics,
  toolFailureSemantics,
} from "../src/tool-failure-semantics.js";
import {
  defineInternalToolProtocolV2,
  defineToolProtocolV2,
  toolProtocolDeclarationV2,
  TOOL_PROTOCOL_DECLARATION_V2,
} from "../src/tool-protocol-declaration.js";
import { ToolProtocolRegistry } from "../src/tool-protocol-registry.js";
import {
  genericToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "../src/tool-protocol-schema.js";
import {
  defineToolProgress,
  progressSemantics,
  resultDetails,
  stableFields,
} from "../src/tool-progress-semantics.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent tool metadata decoration", () => {
  it("retains arbitrary protocol semantics through worktree wrappers and admission", async () => {
    const fixture = await createFixture();
    const source = novelTool();
    const sourceProtocol = new ToolProtocolRegistry([source]).require(
      source.name,
    );
    const wrapped = new SubagentWorktreeOperationCoordinator().wrapReadOnlyTool(
      source,
      fixture.session,
    );
    const wrappedRegistry = new ToolProtocolRegistry([wrapped]);
    const wrappedProtocol = wrappedRegistry.require(wrapped.name);

    expect(
      Object.getOwnPropertyDescriptor(wrapped, TOOL_PROTOCOL_DECLARATION_V2),
    ).toEqual(
      expect.objectContaining({
        enumerable: true,
        configurable: false,
        writable: false,
      }),
    );
    expect(wrappedProtocol.definitionSha256).toBe(
      sourceProtocol.definitionSha256,
    );
    expect(wrappedProtocol.implementationSha256).not.toBe(
      sourceProtocol.implementationSha256,
    );
    expect(wrappedProtocol.definition).toEqual(
      expect.objectContaining({
        sideEffect: "none",
        concurrency: "safe",
        retry: { strategy: "terminal_failure", maxAttempts: 2 },
        compatibility: expect.objectContaining({ mode: "native" }),
        progress: expect.objectContaining({
          coverage: "trusted_declared",
          operations: ["observe"],
          contributions: ["supporting"],
        }),
        failure: expect.objectContaining({
          coverage: "trusted_declared",
          modes: [
            expect.objectContaining({
              modeId: "timeout",
              class: "timeout",
              disposition: "retry_after",
            }),
          ],
        }),
      }),
    );
    expect(
      wrappedProtocol.failure(
        { target: "candidate.ts" },
        Object.assign(new Error("private diagnostic"), {
          name: "TimeoutError",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        coverage: "trusted_declared",
        modeId: "timeout",
        class: "timeout",
        disposition: "retry_after",
      }),
    );

    const [admitted] = wrapAgentToolsWithLifecycle({
      tools: [wrapped],
      registry: wrappedRegistry,
      lifecycles: new AgentLifecyclePipelineHost(),
      run: fixture.run,
      stepIndex: () => 1,
      store: fixture.store,
      concurrencyGate: new ToolConcurrencyGate(),
    });
    const admittedProtocol = new ToolProtocolRegistry([admitted!]).require(
      admitted!.name,
    );
    expect(admittedProtocol.definitionSha256).toBe(
      sourceProtocol.definitionSha256,
    );
    expect(admittedProtocol.implementationSha256).not.toBe(
      wrappedProtocol.implementationSha256,
    );
    await expect(
      admitted!.execute("novel-call", { target: "candidate.ts" }),
    ).resolves.toEqual(
      expect.objectContaining({ details: { revision: "candidate-v1" } }),
    );

    const events = await fixture.store.listRunEvents(fixture.run.id);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "tool.admitted",
        "tool.operation.admitted",
        "tool.started",
        "tool.operation.settled",
      ]),
    );
    expect(events[0]!.payload["toolProtocol"]).toEqual(
      expect.objectContaining({
        definitionSha256: sourceProtocol.definitionSha256,
        sideEffect: "none",
        concurrency: "safe",
        compatibilityMode: "native",
        progress: expect.objectContaining({
          coverage: "trusted_declared",
          operation: "observe",
          scope: "workspace",
          contribution: "supporting",
        }),
      }),
    );
    fixture.store.close();
  });

  it("binds decorator implementation identity to the wrapped implementation", async () => {
    const fixture = await createFixture();
    const first = novelTool(async function firstImplementation() {
      return result("first");
    });
    const second = novelTool(async function secondImplementation() {
      return result("second");
    });
    const operations = new SubagentWorktreeOperationCoordinator();
    const firstWrapped = operations.wrapReadOnlyTool(first, fixture.session);
    const secondWrapped = operations.wrapReadOnlyTool(second, fixture.session);

    expect(Function.prototype.toString.call(firstWrapped.execute)).toBe(
      Function.prototype.toString.call(secondWrapped.execute),
    );
    expect(
      new ToolProtocolRegistry([firstWrapped]).require(firstWrapped.name)
        .implementationSha256,
    ).not.toBe(
      new ToolProtocolRegistry([secondWrapped]).require(secondWrapped.name)
        .implementationSha256,
    );
    fixture.store.close();
  });

  it("rejects a spread wrapper that copied the signed declaration but lost private semantics", () => {
    const source = novelTool();
    const unsafeWrapper: AgentTool = {
      ...source,
      execute: (...args) => source.execute(...args),
    };

    expect(() => new ToolProtocolRegistry([unsafeWrapper])).toThrow(
      "does not match tool",
    );
  });

  it("keeps a self-described but unattested tool fail-closed", () => {
    const record = new ToolProtocolRegistry([
      opaqueProtocolTool("unattested_probe", false),
    ]).require("unattested_probe");

    expect(record.definition).toEqual(
      expect.objectContaining({
        sideEffect: "unknown",
        sideEffectMode: "static",
        concurrency: "exclusive",
        retry: { strategy: "not_started", maxAttempts: 2 },
        idempotency: { key: "none", resultReplay: "never" },
        approval: { mode: "policy", codeBridge: "external_checkpoint" },
        compatibility: expect.objectContaining({ mode: "compatibility" }),
      }),
    );
  });

  it("does not copy host trust through a naive object spread", () => {
    const source = opaqueProtocolTool("spread_probe", true);
    expect(
      new ToolProtocolRegistry([source]).require(source.name).definition
        .compatibility.mode,
    ).toBe("native");
    const unsafeWrapper: AgentTool = {
      ...source,
      execute: async () => result("replacement"),
    };
    const wrapped = new ToolProtocolRegistry([unsafeWrapper]).require(
      unsafeWrapper.name,
    );

    expect(wrapped.definition.compatibility.mode).toBe("compatibility");
    expect(wrapped.invocation({}).approval.codeBridge).toBe(
      "external_checkpoint",
    );
  });

  it("rejects implementation mutation after registry ownership", () => {
    const source = opaqueProtocolTool("mutation_probe", true);
    const owned = new ToolProtocolRegistry([source]).require(source.name);
    source.execute = async () => result("mutated");

    expect(() => owned.invocation({})).toThrow(
      "implementation changed after ownership",
    );
  });

  it("binds input-dependent closure configuration into protocol identity", () => {
    const leftConfiguration: {
      configuredEffect: "none" | "unknown";
    } = { configuredEffect: "none" };
    const rightConfiguration: {
      configuredEffect: "none" | "unknown";
    } = { configuredEffect: "unknown" };
    const left = configurableEffectTool(leftConfiguration);
    const right = configurableEffectTool(rightConfiguration);
    const leftDeclaration = toolProtocolDeclarationV2(left)!;
    const rightDeclaration = toolProtocolDeclarationV2(right)!;
    const leftRecord = new ToolProtocolRegistry([left]).require(left.name);

    expect(
      Function.prototype.toString.call(
        leftDeclaration.sideEffectResolution!.resolve,
      ),
    ).toBe(
      Function.prototype.toString.call(
        rightDeclaration.sideEffectResolution!.resolve,
      ),
    );
    expect(leftDeclaration.definition.sideEffectResolutionSha256).not.toBe(
      rightDeclaration.definition.sideEffectResolutionSha256,
    );
    expect(leftRecord.definitionSha256).not.toBe(
      new ToolProtocolRegistry([right]).require(right.name).definitionSha256,
    );

    leftConfiguration.configuredEffect = "unknown";
    expect(leftRecord.invocation({}).sideEffect).toBe("none");
    expect(
      Object.isFrozen(leftDeclaration.sideEffectResolution!.semanticIdentity),
    ).toBe(true);
  });

  it("rejects internally inconsistent or malformed semantic policy ABIs", () => {
    const definition = new ToolProtocolRegistry([
      opaqueProtocolTool("definition_validation_probe", true),
    ]).require("definition_validation_probe").definition;

    for (const malformed of [
      { ...definition, sideEffect: "unknown", concurrency: "safe" },
      {
        ...definition,
        retry: { strategy: "terminal_failure", maxAttempts: 1.5 },
      },
      { ...definition, capabilityUris: ["cap://"] },
      {
        ...definition,
        progress: { ...definition.progress, kind: "forged-progress-kind" },
      },
      {
        ...definition,
        progress: {
          ...definition.progress,
          operations: ["observe", "observe"],
        },
      },
    ]) {
      expect(() => validateToolDefinitionV2(malformed as never)).toThrow(
        "Tool Protocol definition is invalid",
      );
    }
  });

  it("publishes every declared capability URI and rejects cross-tool conflicts", () => {
    const multi = opaqueProtocolTool("multi_capability_probe", true, [
      "cap://tools/multi-capability-probe/read",
      "cap://tools/multi-capability-probe/inspect",
    ]);
    const registry = new ToolProtocolRegistry([multi]);

    expect(registry.descriptors().map((descriptor) => descriptor.uri)).toEqual([
      "cap://tools/multi-capability-probe/inspect",
      "cap://tools/multi-capability-probe/read",
    ]);
    expect(
      () =>
        new ToolProtocolRegistry([
          opaqueProtocolTool("capability_owner_a", true, [
            "cap://tools/shared-capability",
          ]),
          opaqueProtocolTool("capability_owner_b", true, [
            "cap://tools/shared-capability",
          ]),
        ]),
    ).toThrow("capability URI is duplicated");
  });
});

function opaqueProtocolTool(
  name: string,
  trusted: boolean,
  capabilityUris: string[] = [`cap://tools/${name}`],
): AgentTool {
  const tool: AgentTool = {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute: async () => result("opaque"),
  };
  const define = trusted ? defineInternalToolProtocolV2 : defineToolProtocolV2;
  return define(tool, {
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.0.0-test.1",
      capabilityUris,
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "terminal_failure", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "exact_result_only" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["test:opaque-protocol"],
    },
  });
}

function configurableEffectTool(configuration: {
  configuredEffect: "none" | "unknown";
}): AgentTool {
  const tool: AgentTool = {
    name: "configurable_effect_probe",
    label: "Configurable effect probe",
    description: "Captures reviewed effect configuration",
    parameters: Type.Object({}),
    execute: async () => result("configured"),
  };
  return defineInternalToolProtocolV2(tool, {
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.0.0-test.1",
      capabilityUris: ["cap://tools/configurable-effect-probe"],
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "serialized",
      sideEffect: "unknown",
      sideEffectMode: "input_dependent",
      retry: { strategy: "not_started", maxAttempts: 2 },
      idempotency: { key: "none", resultReplay: "never" },
      approval: { mode: "explicit", codeBridge: "external_checkpoint" },
      policyTags: ["test:input-dependent-effect"],
    },
    sideEffectResolution: {
      schemaVersion: 1,
      classificationVersion: "1.0.0",
      semanticIdentity: configuration,
      resolve: (_input, semanticIdentity) =>
        semanticIdentity &&
        typeof semanticIdentity === "object" &&
        !Array.isArray(semanticIdentity) &&
        semanticIdentity.configuredEffect === "none"
          ? "none"
          : "unknown",
    },
  });
}

function novelTool(
  execute: AgentTool["execute"] = async () => result("candidate-v1"),
): AgentTool {
  const tool: AgentTool = {
    name: "novel_semantic_probe",
    label: "Novel semantic probe",
    description: "An arbitrary tool unknown to the compatibility name table",
    parameters: Type.Object({ target: Type.String() }),
    execute,
  };
  const progressed = defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      {
        modeId: "observe_candidate",
        operation: "observe",
        scope: "workspace",
        contribution: "supporting",
      },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("observe", "workspace", "supporting"),
      resourceKey: stableFields(input, ["target"]),
    }),
    state: (_input, output) =>
      stableFields(resultDetails(output), ["revision"]),
  });
  const classified = defineToolFailureSemantics(progressed, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      {
        modeId: "timeout",
        class: "timeout",
        scope: "invocation",
        disposition: "retry_after",
        fatalToSession: false,
      },
    ],
    resolve: () => ({
      semantics: toolFailureSemantics({
        class: "timeout",
        scope: "invocation",
        disposition: "retry_after",
        fatalToSession: false,
      }),
    }),
  });
  return defineInternalToolProtocolV2(classified, {
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.0.0",
      capabilityUris: ["cap://tools/novel-semantic-probe"],
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "terminal_failure", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "exact_result_only" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["test:novel", "workspace:read"],
    },
  });
}

function result(revision: string) {
  return {
    content: [{ type: "text" as const, text: revision }],
    details: { revision },
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-tool-metadata-"));
  temporaryRoots.push(root);
  const candidateRoot = path.join(root, "candidate");
  await mkdir(candidateRoot, { recursive: true });
  await writeFile(path.join(candidateRoot, "candidate.ts"), "export {};\n");
  const store = new LocalStore({
    workspaceRoot: root,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "agent tool metadata",
    agentId: agent.id,
  });
  const { run } = await store.createLeasedRun(
    { threadId: thread.id, agentId: agent.id },
    { ownerId: "worker.agent-tool-metadata", ttlMs: 30_000 },
  );
  return {
    root,
    store,
    run,
    session: {
      root: await realpath(candidateRoot),
    } as SubagentWorktreeSession,
  };
}
