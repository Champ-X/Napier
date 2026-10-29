import type { Agent } from "@earendil-works/pi-agent-core";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";
import { canonicalJson, sha256 } from "./ed25519.js";
import { resolveSubagentChildRestore } from "./subagent-continuation-source.js";
import type { SubagentChildRestoreSource } from "./subagent-continuation-types.js";

type DeliverySink = (message: SubagentMessage) => Promise<void>;

/** Process-local controls backed by a durable provider mailbox. */
export class SubagentExecutionControl {
  private agent: Pick<Agent, "abort" | "steer"> | undefined;
  private readonly pending: SubagentMessage[] = [];
  private cancelled = false;
  private restored = false;
  private readonly messageBindings = new WeakMap<object, { id: string; contentSha256: string; messageSha256: string }>();

  constructor(private readonly onDelivered: DeliverySink) {}

  /** Rebind only verified consumed object identities; unconsumed input is queued once. */
  restore(source: SubagentChildRestoreSource, messages: readonly unknown[]): void {
    if (this.restored || this.agent) throw new Error("Subagent control was already activated or restored");
    const data = resolveSubagentChildRestore(source);
    if (canonicalJson(messages) !== canonicalJson(data.messages))
      throw new Error("Subagent restore mailbox source messages changed");
    for (const entry of data.mailbox.consumed) {
      const message = messages[entry.messageIndex];
      if (!message || typeof message !== "object" || sha256(canonicalJson(message)) !== entry.messageSha256)
        throw new Error("Subagent restored consumed mailbox binding changed");
      this.messageBindings.set(message, { id: entry.id, contentSha256: entry.contentSha256, messageSha256: entry.messageSha256 });
    }
    const inherited = data.mailbox.pending.map((entry) => entry.message);
    const inheritedIds = new Set(inherited.map((message) => message.id));
    if (this.pending.some((message) => inheritedIds.has(message.id)))
      throw new Error("Subagent restore mailbox contains duplicate pending input");
    this.pending.unshift(...inherited);
    this.restored = true;
  }

  async activate(agent: Pick<Agent, "abort" | "steer">): Promise<void> {
    if (this.cancelled) {
      agent.abort();
      return;
    }
    this.agent = agent;
    for (const message of this.pending.splice(0)) {
      agent.steer(this.userMessage(message));
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
    this.agent.steer(this.userMessage(message));
    await this.onDelivered(message);
  }

  cancel(): void {
    this.cancelled = true;
    this.pending.length = 0;
    this.agent?.abort();
  }

  /** Only actual enqueued object identities may become consumed checkpoint entries. */
  consumedBindings(messages: readonly unknown[]) {
    return messages.flatMap((message, messageIndex) => {
      if (!message || typeof message !== "object") return [];
      const binding = this.messageBindings.get(message);
      if (!binding) return [];
      if (sha256(canonicalJson(message)) !== binding.messageSha256)
        throw new Error("Subagent mailbox message changed after enqueue");
      return [{ ...binding, messageIndex }];
    });
  }

  private userMessage(message: SubagentMessage) {
    const value = userMessage(message.text, message.createdAt);
    this.messageBindings.set(value, { id: message.id, contentSha256: message.contentSha256,
      messageSha256: sha256(canonicalJson(value)) });
    return value;
  }
}

function userMessage(text: string, createdAt: string) {
  return { role: "user" as const, content: text, timestamp: Date.parse(createdAt) };
}
