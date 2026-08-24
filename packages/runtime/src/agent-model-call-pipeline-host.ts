import {
  ComposableAgentModelCallPipeline,
  type AgentTurnModelCallPipeline,
} from "./kernel-model-call-pipeline.js";
import { installBuiltinModelCallExtensions } from "./builtin-model-call-extensions.js";
import type { LocalStore } from "./store.js";
import type { TokenMeterRegistry } from "./token-meter-provider.js";

interface ModelCallPipelineHostRuntime {
  store: LocalStore;
  tokenMeters: TokenMeterRegistry;
}

export class AgentModelCallPipelineHost {
  private standalone: ComposableAgentModelCallPipeline | undefined;
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

  current(runtime: ModelCallPipelineHostRuntime): AgentTurnModelCallPipeline {
    if (this.attached) return this.attached;
    if (!this.standalone) {
      this.standalone = new ComposableAgentModelCallPipeline();
      installBuiltinModelCallExtensions(this.standalone, runtime);
    }
    return this.standalone;
  }
}
