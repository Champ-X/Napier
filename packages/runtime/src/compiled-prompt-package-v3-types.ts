import type { ModelInvocationPurpose } from "@napier/contracts";

import type { ModelAdapterReceiptV2 } from "./model-adapters.js";
import type {
  CompiledPromptLayerId,
  PROMPT_COMPILER_ASSEMBLY,
  PROMPT_COMPILER_VERSION,
} from "./prompt-compiler.js";
import type { PROMPT_INVARIANT_CORE_VERSION } from "./prompt-invariant-core.js";

export const COMPILED_PROMPT_PACKAGE_VERSION_V3 =
  "napier.prompt-context.v3" as const;

export interface CompiledPromptSourceReceipt {
  sourceId: string;
  priority: number;
  required: boolean;
  inputBytes: number;
  inputContentSha256: string;
  included: boolean;
  trimmingReason: "within_budget" | "lower_priority_source_omitted";
}

export interface CompiledPromptLayerReceiptV3 {
  id: CompiledPromptLayerId;
  source: "compiler_input";
  priority: number;
  budgetBytes: number;
  inputBytes: number;
  segmentCount: number;
  bytes: number;
  estimatedTokens: number;
  inputContentSha256: string;
  contentSha256: string;
  trimmingReason: "within_budget" | "budget_exceeded";
  sources: CompiledPromptSourceReceipt[];
}

export interface CompiledPromptPackageReceiptV3 {
  kind: "napier.compiled-prompt-package";
  schemaVersion: 3;
  packageVersion: typeof COMPILED_PROMPT_PACKAGE_VERSION_V3;
  compilerVersion: typeof PROMPT_COMPILER_VERSION;
  purpose: ModelInvocationPurpose;
  invariantCore:
    | {
        status: "bound";
        version: typeof PROMPT_INVARIANT_CORE_VERSION;
        contentSha256: string;
        bytes: number;
      }
    | { status: "not_applicable" };
  turnIndex: number;
  classification: "independent_layers_v1";
  assembly: typeof PROMPT_COMPILER_ASSEMBLY;
  tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4";
  systemPromptSha256: string;
  systemPromptBytes: number;
  estimatedTokens: number;
  segmentCount: number;
  partitionSha256: string;
  lossless: true;
  layers: CompiledPromptLayerReceiptV3[];
  effectiveCapabilities: {
    toolCount: number;
    toolNameSetSha256: string;
    toolDefinitionSetSha256: string;
  };
  modelAdapter: {
    adapterId: ModelAdapterReceiptV2["adapterId"];
    adapterContentSha256: string;
  };
  contentSha256: string;
}
