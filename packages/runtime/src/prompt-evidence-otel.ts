import type { JsonValue } from "@napier/contracts";

import {
  validateCompiledPromptPackageReceipt,
  type CompiledPromptPackageReceipt,
} from "./compiled-prompt-package.js";
import { validateModelAdapterReceipt } from "./model-adapters.js";

export const PROMPT_EVIDENCE_OTEL_KEYS = new Set([
  "napier.event.payload.adapter_content_sha256",
  "napier.event.payload.adapter_id",
  "napier.event.payload.adapter_version",
  "napier.event.payload.cache_retention",
  "napier.event.payload.cache_retention_source",
  "napier.event.payload.classification",
  "napier.event.payload.content_sha256",
  "napier.event.payload.estimated_tokens",
  "napier.event.payload.family",
  "napier.event.payload.kind",
  "napier.event.payload.lossless",
  "napier.event.payload.model_api",
  "napier.event.payload.model_max_tokens",
  "napier.event.payload.package_version",
  "napier.event.payload.partition_sha256",
  "napier.event.payload.prompt_invariant_core_bytes",
  "napier.event.payload.prompt_invariant_core_content_sha256",
  "napier.event.payload.prompt_invariant_core_status",
  "napier.event.payload.prompt_invariant_core_version",
  "napier.event.payload.purpose",
  "napier.event.payload.schema_version",
  "napier.event.payload.segment_count",
  "napier.event.payload.system_prompt_bytes",
  "napier.event.payload.system_prompt_sha256",
  "napier.event.payload.stream_option_max_tokens",
  "napier.event.payload.stream_option_max_tokens_source",
  "napier.event.payload.token_estimate_method",
  "napier.event.payload.tool_count",
  "napier.event.payload.tool_definition_set_sha256",
  "napier.event.payload.tool_name_set_sha256",
  "napier.event.payload.turn_index",
  ...layerAttributeKeys(),
]);

export function promptEvidenceOtelAttributes(
  payload: Record<string, JsonValue>,
): Record<string, string | number | boolean> | undefined {
  if (payload["kind"] === "napier.model-adapter-selection") {
    const receipt = validateModelAdapterReceipt(payload);
    return {
      "napier.event.payload.adapter_id": receipt.adapterId,
      "napier.event.payload.adapter_version": receipt.adapterVersion,
      "napier.event.payload.cache_retention": receipt.cacheRetention,
      "napier.event.payload.cache_retention_source":
        receipt.cacheRetentionSource,
      "napier.event.payload.content_sha256": receipt.contentSha256,
      "napier.event.payload.family": receipt.family,
      "napier.event.payload.kind": receipt.kind,
      "napier.event.payload.model_api": receipt.modelApi,
      ...(receipt.schemaVersion === 2
        ? {
            "napier.event.payload.model_max_tokens": receipt.modelMaxTokens,
            "napier.event.payload.stream_option_max_tokens":
              receipt.streamOptionMaxTokens,
            "napier.event.payload.stream_option_max_tokens_source":
              receipt.streamOptionMaxTokensSource,
          }
        : {}),
      "napier.event.payload.schema_version": receipt.schemaVersion,
    };
  }
  if (payload["kind"] === "napier.compiled-prompt-package") {
    return compiledPromptOtelAttributes(
      validateCompiledPromptPackageReceipt(payload),
    );
  }
  return undefined;
}

function compiledPromptOtelAttributes(
  receipt: CompiledPromptPackageReceipt,
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {
    "napier.event.payload.adapter_id": receipt.modelAdapter.adapterId,
    "napier.event.payload.adapter_content_sha256":
      receipt.modelAdapter.adapterContentSha256,
    "napier.event.payload.classification": receipt.classification,
    "napier.event.payload.content_sha256": receipt.contentSha256,
    "napier.event.payload.estimated_tokens": receipt.estimatedTokens,
    "napier.event.payload.kind": receipt.kind,
    "napier.event.payload.lossless": receipt.lossless,
    "napier.event.payload.package_version": receipt.packageVersion,
    "napier.event.payload.partition_sha256": receipt.partitionSha256,
    "napier.event.payload.prompt_invariant_core_status":
      receipt.invariantCore?.status ?? "legacy_unavailable",
    ...(receipt.invariantCore?.status === "bound"
      ? {
          "napier.event.payload.prompt_invariant_core_bytes":
            receipt.invariantCore.bytes,
          "napier.event.payload.prompt_invariant_core_content_sha256":
            receipt.invariantCore.contentSha256,
          "napier.event.payload.prompt_invariant_core_version":
            receipt.invariantCore.version,
        }
      : {}),
    ...(receipt.purpose
      ? { "napier.event.payload.purpose": receipt.purpose }
      : {}),
    "napier.event.payload.schema_version": receipt.schemaVersion,
    "napier.event.payload.segment_count": receipt.segmentCount,
    "napier.event.payload.system_prompt_bytes": receipt.systemPromptBytes,
    "napier.event.payload.system_prompt_sha256": receipt.systemPromptSha256,
    "napier.event.payload.token_estimate_method": receipt.tokenEstimateMethod,
    "napier.event.payload.tool_count": receipt.effectiveCapabilities.toolCount,
    "napier.event.payload.tool_definition_set_sha256":
      receipt.effectiveCapabilities.toolDefinitionSetSha256,
    "napier.event.payload.tool_name_set_sha256":
      receipt.effectiveCapabilities.toolNameSetSha256,
    "napier.event.payload.turn_index": receipt.turnIndex,
  };
  for (const layer of receipt.layers) {
    const prefix = `napier.event.payload.layer.${layer.id}`;
    values[`${prefix}.bytes`] = layer.bytes;
    values[`${prefix}.content_sha256`] = layer.contentSha256;
    values[`${prefix}.estimated_tokens`] = layer.estimatedTokens;
    values[`${prefix}.segment_count`] = layer.segmentCount;
    values[`${prefix}.source`] = layer.source;
  }
  return values;
}

function layerAttributeKeys(): string[] {
  return [
    "invariant_core",
    "effective_capabilities",
    "task_skill_overlay",
    "workspace_context",
    "model_adapter",
  ].flatMap((id) => {
    const prefix = `napier.event.payload.layer.${id}`;
    return [
      `${prefix}.bytes`,
      `${prefix}.content_sha256`,
      `${prefix}.estimated_tokens`,
      `${prefix}.segment_count`,
      `${prefix}.source`,
    ];
  });
}
