import { AgentLifecyclePipelineHost } from "./lifecycle-extension-pipeline.js";

export class AgentLifecyclePipelineAttachmentHost {
  private readonly standalone = new AgentLifecyclePipelineHost();
  private attached: AgentLifecyclePipelineHost | undefined;

  readonly attach = (pipelines: AgentLifecyclePipelineHost): (() => void) => {
    if (this.attached) {
      throw new Error("Agent Runtime already has Kernel lifecycle pipelines");
    }
    this.attached = pipelines;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.attached === pipelines) this.attached = undefined;
    };
  };

  current(): AgentLifecyclePipelineHost {
    return this.attached ?? this.standalone;
  }
}
