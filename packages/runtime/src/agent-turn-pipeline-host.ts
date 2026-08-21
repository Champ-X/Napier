import {
  AgentTurnPipeline,
  createDefaultAgentTurnPipeline,
} from "./agent-turn-pipeline.js";

export class AgentTurnPipelineHost {
  private readonly standalone = createDefaultAgentTurnPipeline();
  private attached: AgentTurnPipeline | undefined;

  readonly attach = (pipeline: AgentTurnPipeline): (() => void) => {
    if (this.attached) {
      throw new Error("Agent Runtime already has a Kernel Turn Pipeline");
    }
    this.attached = pipeline;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.attached === pipeline) this.attached = undefined;
    };
  };

  current(): AgentTurnPipeline {
    return this.attached ?? this.standalone;
  }
}
