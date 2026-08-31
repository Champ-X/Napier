import type { AgentCapabilityPresetId } from "./agent-capabilities.js";
import type { ModelRef } from "./execution-core.js";
import type { ModelRouteRequest } from "./model-route.js";

export type PromptImageMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

/** A base64-encoded image supplied with the initial user turn. */
export interface PromptImageInput {
  data: string;
  mimeType: PromptImageMimeType;
}

export interface PromptRequest {
  text: string;
  images?: PromptImageInput[];
  model?: ModelRef;
  modelRoute?: ModelRouteRequest;
  capabilityPreset?: AgentCapabilityPresetId;
  sourceContinuityRunId?: string;
}

export interface ResumeRunRequest {
  runId?: string;
  model?: ModelRef;
}
