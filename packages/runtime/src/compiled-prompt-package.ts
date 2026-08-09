import type {
  ModelContextEnvelopeReceipt,
  ModelInvocationPurpose,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelAdapterReceipt } from "./model-adapters.js";
import { validateModelAdapterReceipt } from "./model-adapters.js";
import {
  COMPILED_PROMPT_PACKAGE_VERSION,
  createPromptInvariantCoreBinding,
  PROMPT_LAYER_IDS,
  validateCompiledPromptPackageReceipt,
  type CompiledPromptLayerReceipt,
  type CompiledPromptPackageReceipt,
  type PromptLayerId,
} from "./compiled-prompt-package-receipt.js";

export const COMPILED_PROMPT_PACKAGE_EVENT = "context.prompt_package";
export {
  COMPILED_PROMPT_PACKAGE_VERSION,
  validateCompiledPromptPackageReceipt,
};
export type {
  CompiledPromptLayerReceipt,
  CompiledPromptPackageReceipt,
  PromptInvariantCoreBinding,
  PromptLayerId,
} from "./compiled-prompt-package-receipt.js";

interface PromptSegment {
  id: Exclude<PromptLayerId, "model_adapter">;
  text: string;
  start: number;
}

interface TaggedRegion {
  id: Exclude<PromptLayerId, "invariant_core" | "model_adapter">;
  start: number;
  end: number;
}

const TAGGED_BLOCKS: ReadonlyArray<{
  id: TaggedRegion["id"];
  pattern: RegExp;
}> = [
  {
    id: "effective_capabilities",
    pattern: /<workspace_tool_protocol>[\s\S]*?<\/workspace_tool_protocol>/gu,
  },
  {
    id: "effective_capabilities",
    pattern: /<plan_tool_protocol>[\s\S]*?<\/plan_tool_protocol>/gu,
  },
  {
    id: "task_skill_overlay",
    pattern:
      /The following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/gu,
  },
  {
    id: "workspace_context",
    pattern:
      /<(?:imported-ledger-boundary|context_checkpoint|memory_context|delegation_ledger_projection|agent_milestone_projection|tool-loop-guard)>[\s\S]*?<\/(?:imported-ledger-boundary|context_checkpoint|memory_context|delegation_ledger_projection|agent_milestone_projection|tool-loop-guard)>/gu,
  },
];

export function createCompiledPromptPackageReceipt(input: {
  systemPrompt: string;
  envelope: ModelContextEnvelopeReceipt;
  adapter: ModelAdapterReceipt;
  purpose: ModelInvocationPurpose;
}): CompiledPromptPackageReceipt {
  const adapter = validateModelAdapterReceipt(input.adapter);
  if (
    input.envelope.systemPromptSha256 !== sha256(input.systemPrompt) ||
    input.envelope.systemPromptBytes !==
      Buffer.byteLength(input.systemPrompt, "utf8")
  ) {
    throw new Error("Compiled Prompt package envelope binding is invalid");
  }
  const segments = partitionPrompt(input.systemPrompt);
  const reconstructed = segments.map((segment) => segment.text).join("");
  if (reconstructed !== input.systemPrompt) {
    throw new Error("Compiled Prompt package partition is not lossless");
  }
  const segmentProjection = segments.map((segment, index) => ({
    index,
    id: segment.id,
    start: segment.start,
    bytes: bytes(segment.text),
    contentSha256: sha256(segment.text),
  }));
  const layers = PROMPT_LAYER_IDS.map((id): CompiledPromptLayerReceipt => {
    if (id === "model_adapter") {
      return {
        id,
        source: "request_options",
        segmentCount: 0,
        bytes: 0,
        estimatedTokens: 0,
        contentSha256: adapter.contentSha256,
      };
    }
    const selected = segments.filter((segment) => segment.id === id);
    const layerBytes = selected.reduce(
      (total, segment) => total + bytes(segment.text),
      0,
    );
    return {
      id,
      source: "system_prompt",
      segmentCount: selected.length,
      bytes: layerBytes,
      estimatedTokens: estimateTokens(layerBytes),
      contentSha256: sha256(
        canonicalJson(selected.map((segment) => segment.text)),
      ),
    };
  });
  const content = {
    kind: "napier.compiled-prompt-package" as const,
    schemaVersion: 2 as const,
    packageVersion: COMPILED_PROMPT_PACKAGE_VERSION,
    purpose: input.purpose,
    invariantCore: createPromptInvariantCoreBinding(
      input.systemPrompt,
      input.purpose,
    ),
    turnIndex: input.envelope.turnIndex,
    classification: "conservative_tagged_v1" as const,
    tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4" as const,
    systemPromptSha256: input.envelope.systemPromptSha256,
    systemPromptBytes: input.envelope.systemPromptBytes,
    estimatedTokens: layers.reduce(
      (total, layer) => total + layer.estimatedTokens,
      0,
    ),
    segmentCount: segments.length,
    partitionSha256: sha256(canonicalJson(segmentProjection)),
    lossless: true as const,
    layers,
    effectiveCapabilities: {
      toolCount: input.envelope.toolCount,
      toolNameSetSha256: input.envelope.toolNameSetSha256,
      toolDefinitionSetSha256: input.envelope.toolDefinitionSetSha256,
    },
    modelAdapter: {
      adapterId: adapter.adapterId,
      adapterContentSha256: adapter.contentSha256,
    },
  };
  return validateCompiledPromptPackageReceipt({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

function partitionPrompt(systemPrompt: string): PromptSegment[] {
  const regions = TAGGED_BLOCKS.flatMap(({ id, pattern }) =>
    [...systemPrompt.matchAll(pattern)].map(
      (match): TaggedRegion => ({
        id,
        start: match.index,
        end: match.index + match[0].length,
      }),
    ),
  ).sort((left, right) => left.start - right.start || right.end - left.end);
  const selected: TaggedRegion[] = [];
  for (const region of regions) {
    const previous = selected.at(-1);
    if (previous && region.start < previous.end) continue;
    selected.push(region);
  }
  const segments: PromptSegment[] = [];
  let cursor = 0;
  for (const region of selected) {
    if (region.start > cursor) {
      segments.push({
        id: "invariant_core",
        text: systemPrompt.slice(cursor, region.start),
        start: cursor,
      });
    }
    segments.push({
      id: region.id,
      text: systemPrompt.slice(region.start, region.end),
      start: region.start,
    });
    cursor = region.end;
  }
  if (cursor < systemPrompt.length || segments.length === 0) {
    segments.push({
      id: "invariant_core",
      text: systemPrompt.slice(cursor),
      start: cursor,
    });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

function estimateTokens(byteCount: number): number {
  return Math.ceil(byteCount / 4);
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
