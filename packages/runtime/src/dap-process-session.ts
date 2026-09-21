import {
  DapMessageDecoder,
  encodeDapRequest,
  type DapMessage,
  type DapResponse,
  type DapEvent,
} from "./dap-protocol.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { PrivateDapProcessManager } from "./node-debugger-process.js";
export type DapProcesses = PrivateDapProcessManager;
export interface DapOwner {
  threadId: string;
  runId: string;
}

/** A bounded protocol stream, using private Process I/O and its durable input
 * receipts. It neither spawns a process nor grants access to a public session. */
export class DapProcessSession {
  private readonly decoder = new DapMessageDecoder();
  private readonly inbox: DapMessage[] = [];
  private readonly requests = new Map<number, string>();
  private sequence = 0;
  private readonly receivedSequences = new Set<number>();
  private cursor = 0;
  private readonly hashes = {
    requests: [] as string[],
    responses: [] as string[],
    events: [] as string[],
  };
  state: "starting" | "running" | "paused" | "terminated" = "starting";
  threadId?: number;
  exitCode?: number;
  readonly output: Array<{ category: string; text: string }> = [];
  outputTruncated = false;
  constructor(
    private readonly processes: DapProcesses,
    readonly owner: DapOwner,
    readonly processId: string,
  ) {}

  async send(
    command: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<number> {
    if (signal?.aborted) throw new Error("DAP operation was cancelled");
    if (++this.sequence > 60)
      throw new Error("DAP request count exceeded its limit");
    const request = {
      seq: this.sequence,
      type: "request" as const,
      command,
      arguments: args,
    };
    this.requests.set(request.seq, command);
    await this.processes.writePrivateProtocolInput({
      ...this.owner,
      processId: this.processId,
      text: encodeDapRequest(request),
      initiatedBy: "agent",
      ...(signal ? { signal } : {}),
    });
    this.hashes.requests.push(sha256(canonicalJson(request)));
    return request.seq;
  }

  async response(
    seq: number,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = (await this.wait(
      (m) => m.type === "response" && m.request_seq === seq,
      deadline,
      signal,
    )) as DapResponse;
    if (!response.success) throw new Error(`DAP ${response.command} failed`);
    return response.body ?? {};
  }

  async request(
    command: string,
    args: Record<string, unknown>,
    deadline: number,
    signal?: AbortSignal,
  ) {
    return this.response(
      await this.send(command, args, signal),
      deadline,
      signal,
    );
  }

  async event(
    name: string,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<DapEvent> {
    return (await this.wait(
      (m) => m.type === "event" && m.event === name,
      deadline,
      signal,
    )) as DapEvent;
  }

  async settled(deadline: number, signal?: AbortSignal): Promise<void> {
    await this.wait(
      (m) =>
        m.type === "event" &&
        (m.event === "stopped" || m.event === "terminated"),
      deadline,
      signal,
    );
  }

  async closeInput(): Promise<void> {
    await this.processes.writePrivateProtocolInput({
      ...this.owner,
      processId: this.processId,
      text: "",
      close: true,
      initiatedBy: "agent",
    });
  }

  evidence() {
    return Object.fromEntries(
      Object.entries(this.hashes).map(([key, values]) => [
        `${key}Sha256`,
        sha256(canonicalJson(values)),
      ]),
    );
  }

  discardEvents(name: string) {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const item = this.inbox[i]!;
      if (item.type === "event" && item.event === name) this.inbox.splice(i, 1);
    }
  }

  private async wait(
    predicate: (message: DapMessage) => boolean,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<DapMessage> {
    while (true) {
      if (signal?.aborted) throw new Error("DAP operation was cancelled");
      const index = this.inbox.findIndex(predicate);
      if (index >= 0) return this.inbox.splice(index, 1)[0]!;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("DAP operation timed out");
      const output = await this.processes.outputPrivateProtocol(
        this.owner.threadId,
        this.processId,
        {
          afterCursor: this.cursor,
          waitMs: Math.min(1000, remaining),
          ...(signal ? { signal } : {}),
        },
      );
      for (const chunk of output.chunks) {
        if (chunk.cursor <= this.cursor)
          throw new Error("DAP output cursor did not advance");
        this.cursor = chunk.cursor;
        if (chunk.stream !== "stdout") continue;
        for (const message of this.decoder.push(chunk.text))
          this.accept(message);
      }
      if (!output.chunks.length) {
        const session = (await this.processes.list(this.owner.threadId)).find(
          (s) => s.id === this.processId,
        );
        if (!session || session.status !== "running")
          throw new Error("DAP process terminated before the response");
      }
    }
  }

  private accept(message: DapMessage) {
    // debugpy allocates seq under one lock, then sends under another. Concurrent
    // adapter threads can deliver distinct IDs out of numeric order. Preserve
    // wire order and reject replay by identity, not by a high-water mark.
    if (this.receivedSequences.has(message.seq))
      throw new Error("DAP message sequence is duplicated");
    if (this.receivedSequences.size >= 316)
      throw new Error("DAP message identity count exceeded its limit");
    this.receivedSequences.add(message.seq);
    if (message.type === "response") {
      if (this.requests.get(message.request_seq) !== message.command)
        throw new Error("DAP response does not match a request");
      this.requests.delete(message.request_seq);
      this.hashes.responses.push(sha256(canonicalJson(message)));
    } else {
      if (this.hashes.events.length >= 256)
        throw new Error("DAP event queue exceeded its limit");
      this.hashes.events.push(sha256(canonicalJson(message)));
      if (message.event === "stopped") {
        if (
          !Number.isSafeInteger(message.body?.threadId) ||
          Number(message.body?.threadId) < 1
        )
          throw new Error("DAP stopped thread is invalid");
        this.state = "paused";
        this.threadId = Number(message.body!.threadId);
      } else if (message.event === "continued") this.state = "running";
      else if (message.event === "terminated") this.state = "terminated";
      else if (message.event === "exited") {
        if (!Number.isSafeInteger(message.body?.exitCode))
          throw new Error("DAP exit code is invalid");
        this.exitCode = Number(message.body!.exitCode);
      }
      if (message.event === "output") {
        const text = String(message.body?.output ?? "");
        if (this.output.length < 16)
          this.output.push({
            category: String(message.body?.category ?? "console"),
            text: text.slice(0, 256),
          });
        if (this.output.length >= 16 || text.length > 256)
          this.outputTruncated = true;
        return;
      }
    }
    if (this.inbox.length >= 128 || this.hashes.events.length > 256)
      throw new Error("DAP event queue exceeded its limit");
    this.inbox.push(message);
  }
}
