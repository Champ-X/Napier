import type { AgentCapabilityPresetId } from "./agent-capabilities.js";
import type { ModelRef } from "./execution-core.js";
import type { ModelRouteRequest } from "./model-route.js";

export interface PromptRequest {
  text: string;
  model?: ModelRef;
  modelRoute?: ModelRouteRequest;
  capabilityPreset?: AgentCapabilityPresetId;
  sourceContinuityRunId?: string;
}

export interface ResumeRunRequest {
  runId?: string;
  model?: ModelRef;
}
