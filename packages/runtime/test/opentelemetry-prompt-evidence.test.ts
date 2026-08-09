import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  OpenTelemetryTraceArtifact,
  OtlpKeyValue,
  OtlpSpanEvent,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createCompiledPromptPackageReceipt } from "../src/compiled-prompt-package.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import {
  createOpenTelemetryTraceArtifact,
  hashOpenTelemetryTraceArtifact,
  validateOpenTelemetryTraceArtifact,
  verifyOpenTelemetryTraceArtifact,
} from "../src/opentelemetry.js";
import {
  compilePromptInvariantCore,
  PROMPT_INVARIANT_CORE_CONTENT_SHA256,
  PROMPT_INVARIANT_CORE_VERSION,
} from "../src/prompt-invariant-core.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OpenTelemetry Prompt evidence", () => {
  it("exports complete metadata-only Adapter and five-layer Prompt attributes", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Prompt evidence OTLP",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "anthropic", id: "claude-test" },
    });
    const systemPrompt = compilePromptInvariantCore(
      [
        "OTLP_SECRET_INVARIANT",
        "<workspace_tool_protocol>OTLP_SECRET_TOOL_RULE</workspace_tool_protocol>",
        [
          "The following skills provide specialized instructions for specific tasks.",
          "<available_skills>",
          "<skill><name>OTLP_SECRET_SKILL</name></skill>",
          "</available_skills>",
        ].join("\n"),
        "<memory_context>OTLP_SECRET_WORKSPACE</memory_context>",
      ].join("\n"),
    );
    const envelope = createModelContextEnvelopeReceipt({
      turnIndex: 7,
      systemPrompt,
      messages: [{ role: "user", content: "OTLP_SECRET_USER_MESSAGE" }],
      tools: [
        {
          name: "OTLP_SECRET_TOOL_NAME",
          description: "OTLP_SECRET_TOOL_DESCRIPTION",
          parameters: { type: "object" },
        },
      ],
    });
    const adapter = modelAdapterReceipt(model("anthropic-messages"));
    const promptPackage = createCompiledPromptPackageReceipt({
      systemPrompt,
      envelope,
      adapter,
      purpose: "agent_turn",
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "context.model_envelope",
      category: "model",
      visibility: "debug",
      payload: structuredClone(envelope),
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "context.model_adapter",
      category: "model",
      visibility: "debug",
      payload: structuredClone(adapter),
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "context.prompt_package",
      category: "model",
      visibility: "debug",
      payload: structuredClone(promptPackage),
    });

    const artifact = await createOpenTelemetryTraceArtifact(
      store,
      thread.id,
      run.id,
      new Date("2026-08-09T08:00:00.000Z"),
    );

    expect(validateOpenTelemetryTraceArtifact(artifact)).toEqual(artifact);
    expect(verifyOpenTelemetryTraceArtifact(artifact).status).toBe("valid");
    const envelopeEvent = findEvent(artifact, "context.model_envelope");
    expect(projectAttributes(envelopeEvent.attributes)).toMatchObject({
      "napier.event.payload.schema_version": 2,
      "napier.event.payload.tool_count": 1,
      "napier.event.payload.tool_definition_bytes":
        envelope.schemaVersion === 2 ? envelope.toolDefinitionBytes : undefined,
      "napier.event.payload.tool_definition_estimated_tokens":
        envelope.schemaVersion === 2
          ? envelope.toolDefinitionEstimatedTokens
          : undefined,
      "napier.event.payload.tool_definition_token_estimate_method":
        "ceil_utf8_bytes_div_4",
    });
    const adapterEvent = findEvent(artifact, "context.model_adapter");
    expect(projectAttributes(adapterEvent.attributes)).toMatchObject({
      "napier.event.payload.adapter_id": adapter.adapterId,
      "napier.event.payload.adapter_version": adapter.adapterVersion,
      "napier.event.payload.cache_retention": adapter.cacheRetention,
      "napier.event.payload.cache_retention_source":
        adapter.cacheRetentionSource,
      "napier.event.payload.content_sha256": adapter.contentSha256,
      "napier.event.payload.family": adapter.family,
      "napier.event.payload.kind": adapter.kind,
      "napier.event.payload.model_max_tokens": adapter.modelMaxTokens,
      "napier.event.payload.model_api": adapter.modelApi,
      "napier.event.payload.schema_version": adapter.schemaVersion,
      "napier.event.payload.stream_option_max_tokens":
        adapter.streamOptionMaxTokens,
      "napier.event.payload.stream_option_max_tokens_source":
        adapter.streamOptionMaxTokensSource,
    });
    expect(adapterEvent.droppedAttributesCount).toBe(0);
    const promptEvent = findEvent(artifact, "context.prompt_package");
    const promptAttributes = projectAttributes(promptEvent.attributes);
    expect(promptAttributes).toMatchObject({
      "napier.event.payload.adapter_id": promptPackage.modelAdapter.adapterId,
      "napier.event.payload.adapter_content_sha256":
        promptPackage.modelAdapter.adapterContentSha256,
      "napier.event.payload.classification": promptPackage.classification,
      "napier.event.payload.content_sha256": promptPackage.contentSha256,
      "napier.event.payload.estimated_tokens": promptPackage.estimatedTokens,
      "napier.event.payload.kind": promptPackage.kind,
      "napier.event.payload.lossless": true,
      "napier.event.payload.package_version": promptPackage.packageVersion,
      "napier.event.payload.partition_sha256": promptPackage.partitionSha256,
      "napier.event.payload.prompt_invariant_core_bytes":
        promptPackage.invariantCore?.status === "bound"
          ? promptPackage.invariantCore.bytes
          : undefined,
      "napier.event.payload.prompt_invariant_core_content_sha256":
        PROMPT_INVARIANT_CORE_CONTENT_SHA256,
      "napier.event.payload.prompt_invariant_core_status": "bound",
      "napier.event.payload.prompt_invariant_core_version":
        PROMPT_INVARIANT_CORE_VERSION,
      "napier.event.payload.purpose": "agent_turn",
      "napier.event.payload.schema_version": promptPackage.schemaVersion,
      "napier.event.payload.segment_count": promptPackage.segmentCount,
      "napier.event.payload.system_prompt_bytes":
        promptPackage.systemPromptBytes,
      "napier.event.payload.system_prompt_sha256":
        promptPackage.systemPromptSha256,
      "napier.event.payload.token_estimate_method":
        promptPackage.tokenEstimateMethod,
      "napier.event.payload.tool_count":
        promptPackage.effectiveCapabilities.toolCount,
      "napier.event.payload.tool_definition_set_sha256":
        promptPackage.effectiveCapabilities.toolDefinitionSetSha256,
      "napier.event.payload.tool_name_set_sha256":
        promptPackage.effectiveCapabilities.toolNameSetSha256,
      "napier.event.payload.turn_index": promptPackage.turnIndex,
    });
    for (const layer of promptPackage.layers) {
      const prefix = `napier.event.payload.layer.${layer.id}`;
      expect(promptAttributes).toMatchObject({
        [`${prefix}.bytes`]: layer.bytes,
        [`${prefix}.content_sha256`]: layer.contentSha256,
        [`${prefix}.estimated_tokens`]: layer.estimatedTokens,
        [`${prefix}.segment_count`]: layer.segmentCount,
        [`${prefix}.source`]: layer.source,
      });
    }
    expect(promptEvent.droppedAttributesCount).toBe(0);
    const serialized = JSON.stringify(artifact);
    for (const secret of [
      "OTLP_SECRET_INVARIANT",
      "OTLP_SECRET_TOOL_RULE",
      "OTLP_SECRET_SKILL",
      "OTLP_SECRET_WORKSPACE",
      "OTLP_SECRET_USER_MESSAGE",
      "OTLP_SECRET_TOOL_NAME",
      "OTLP_SECRET_TOOL_DESCRIPTION",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("fails closed on a tampered source receipt and rejects exported drift", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Prompt evidence tamper rejection",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "openai", id: "gpt-test" },
    });
    const systemPrompt = "Prompt evidence binding";
    const envelope = createModelContextEnvelopeReceipt({
      turnIndex: 0,
      systemPrompt,
      messages: [],
      tools: [],
    });
    const adapter = modelAdapterReceipt(model("openai-responses"));
    const promptPackage = createCompiledPromptPackageReceipt({
      systemPrompt,
      envelope,
      adapter,
      purpose: "context_compaction",
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "context.model_adapter",
      category: "model",
      visibility: "debug",
      payload: structuredClone(adapter),
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "context.prompt_package",
      category: "model",
      visibility: "debug",
      payload: structuredClone(promptPackage),
    });
    const artifact = await createOpenTelemetryTraceArtifact(
      store,
      thread.id,
      run.id,
    );
    const exportedDrift = structuredClone(artifact);
    const promptEvent = findEvent(exportedDrift, "context.prompt_package");
    setAttributeValue(
      promptEvent.attributes,
      "napier.event.payload.adapter_id",
      "napier.generic.v1",
    );
    rehashArtifact(exportedDrift);
    expect(() => validateOpenTelemetryTraceArtifact(exportedDrift)).toThrow(
      "event anchor set binding",
    );
    expect(verifyOpenTelemetryTraceArtifact(exportedDrift)).toEqual({
      status: "invalid",
      diagnostics: ["event_anchor_mismatch"],
      spanCount: 0,
      eventCount: 0,
    });
    const adapterDrift = structuredClone(artifact);
    const adapterEvent = findEvent(adapterDrift, "context.model_adapter");
    setAttributeValue(
      adapterEvent.attributes,
      "napier.event.payload.stream_option_max_tokens",
      1,
    );
    rehashArtifact(adapterDrift);
    expect(() => validateOpenTelemetryTraceArtifact(adapterDrift)).toThrow(
      "event anchor set binding",
    );
    expect(verifyOpenTelemetryTraceArtifact(adapterDrift)).toEqual({
      status: "invalid",
      diagnostics: ["event_anchor_mismatch"],
      spanCount: 0,
      eventCount: 0,
    });

    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "context.prompt_package",
      category: "model",
      visibility: "debug",
      payload: {
        ...structuredClone(promptPackage),
        contentSha256: "0".repeat(64),
      },
    });
    await expect(
      createOpenTelemetryTraceArtifact(store, thread.id, run.id),
    ).rejects.toThrow("Compiled Prompt package receipt hash mismatch");
  });
});

async function createStore(): Promise<LocalStore> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-otel-prompt-"));
  temporaryRoots.push(root);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  openStores.push(store);
  await store.initialize();
  return store;
}

function findEvent(
  artifact: OpenTelemetryTraceArtifact,
  name: string,
): OtlpSpanEvent {
  const event = artifact.otlp.resourceSpans[0]!.scopeSpans[0]!.spans.flatMap(
    (span) => span.events,
  ).find((candidate) => candidate.name === name);
  if (!event) throw new Error(`Missing OTLP event: ${name}`);
  return event;
}

function projectAttributes(
  attributes: OtlpKeyValue[],
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    attributes.map((attribute) => [attribute.key, attributeValue(attribute)]),
  );
}

function attributeValue(attribute: OtlpKeyValue): string | number | boolean {
  if ("stringValue" in attribute.value) return attribute.value.stringValue;
  if ("boolValue" in attribute.value) return attribute.value.boolValue;
  if ("intValue" in attribute.value) return Number(attribute.value.intValue);
  return attribute.value.doubleValue;
}

function setAttributeValue(
  attributes: OtlpKeyValue[],
  key: string,
  value: string | number,
): void {
  const attribute = attributes.find((item) => item.key === key);
  if (!attribute) throw new Error(`Missing OTLP attribute: ${key}`);
  attribute.value =
    typeof value === "string"
      ? { stringValue: value }
      : { intValue: String(value) };
}

function rehashArtifact(artifact: OpenTelemetryTraceArtifact): void {
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = artifact;
  artifact.contentSha256 = hashOpenTelemetryTraceArtifact(content);
}

function model(api: string) {
  return {
    id: "model-1",
    name: "Model",
    api,
    provider: "test",
    baseUrl: "https://example.com",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 2_048,
  };
}
