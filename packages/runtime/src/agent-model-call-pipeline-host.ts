import {
  createStandaloneAgentModelCallPipeline,
  type AgentTurnModelCallPipeline,
} from "./kernel-model-call-pipeline.js";

export class AgentModelCallPipelineHost {
  private readonly standalone = createStandaloneAgentModelCallPipeline();
  private attached: AgentTurnModelCallPipeline | undefined;

  readonly attach = (pipeline: AgentTurnModelCallPipeline): (() => void) => {
    if (this.attached) {
      throw new Error("Agent Runtime already has a Kernel model-call pipeline");
    }
    this.attached = pipeline;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.attached === pipeline) this.attached = undefined;
    };
  };

  current(): AgentTurnModelCallPipeline {
    return this.attached ?? this.standalone;
  }
}
