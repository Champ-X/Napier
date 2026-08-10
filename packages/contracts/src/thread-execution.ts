import type { AgentCapabilityPresetId } from "./agent-capabilities.js";
import type { ModelRef } from "./execution-core.js";

export interface PromptRequest {
  text: string;
  model?: ModelRef;
  capabilityPreset?: AgentCapabilityPresetId;
  sourceContinuityRunId?: string;
}

export interface ResumeRunRequest {
  runId?: string;
  model?: ModelRef;
}
