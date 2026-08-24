import type { Agent } from "@earendil-works/pi-agent-core";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";

type DeliverySink = (message: SubagentMessage) => Promise<void>;

/** Process-local controls backed by a durable provider mailbox. */
export class SubagentExecutionControl {
  private agent: Pick<Agent, "abort" | "steer"> | undefined;
  private readonly pending: SubagentMessage[] = [];
  private cancelled = false;

  constructor(private readonly onDelivered: DeliverySink) {}

  async activate(agent: Pick<Agent, "abort" | "steer">): Promise<void> {
    if (this.cancelled) {
      agent.abort();
      return;
    }
    this.agent = agent;
    for (const message of this.pending.splice(0)) {
      agent.steer(userMessage(message.text));
      await this.onDelivered(message);
    }
  }

  deactivate(agent: Pick<Agent, "abort" | "steer">): void {
    if (this.agent === agent) this.agent = undefined;
  }

  async send(message: SubagentMessage): Promise<void> {
    if (this.cancelled) throw new Error("Subagent execution is cancelled");
    if (!this.agent) {
      this.pending.push(message);
      return;
    }
    this.agent.steer(userMessage(message.text));
    await this.onDelivered(message);
  }

  cancel(): void {
    this.cancelled = true;
    this.pending.length = 0;
    this.agent?.abort();
  }
}

function userMessage(text: string) {
  return { role: "user" as const, content: text, timestamp: Date.now() };
}
