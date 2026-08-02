import path from "node:path";

import type {
  ExtensionCapability,
  McpStdioTransportConfig,
} from "@napier/contracts";

import type {
  McpClient,
  McpClientCallResult,
  McpClientTool,
} from "./mcp-client.js";
import { isPathInsideWorkspace } from "./policy.js";
import type { OsSandboxAdapter, SandboxedProcess } from "./sandbox.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CONNECT_TIMEOUT_MS = 12_000;
const TOOL_TIMEOUT_MS = 60_000;
const MAX_PROTOCOL_LINE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 64_000;

interface PendingRequest {
  method: string;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface StdioMcpClientOptions {
  transport: McpStdioTransportConfig;
  sandbox: OsSandboxAdapter;
  workspaceRoot: string;
  approvedCapabilities: ExtensionCapability[];
  environment?: Readonly<Record<string, string | undefined>>;
}

export class StdioMcpClient implements McpClient {
  private requestId = 0;
  private process: SandboxedProcess | undefined;
  private stdoutBuffer = "";
  private stderrObserved = false;
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;

  constructor(private readonly options: StdioMcpClientOptions) {}

  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.process)
      throw new Error("stdio MCP client is already initialized");
    const transport = this.options.transport;
    const capabilities = new Set(this.options.approvedCapabilities);
    if (!path.isAbsolute(transport.command)) {
      throw new Error("stdio MCP command must be an absolute executable path");
    }
    if (!capabilities.has("process.spawn")) {
      throw new Error("stdio MCP requires approved process.spawn capability");
    }
    const env = resolveMappedEnvironment(
      transport.env ?? {},
      this.options.environment ?? process.env,
      capabilities,
    );
    const cwd = resolveStdioCwd(
      transport.cwd,
      this.options.workspaceRoot,
      capabilities,
    );
    const child = await this.options.sandbox.launch({
      command: transport.command,
      args: transport.args ?? [],
      cwd,
      env,
      workspaceRoot: path.resolve(this.options.workspaceRoot),
      approvedCapabilities: this.options.approvedCapabilities,
    });
    this.process = child;
    child.stdout.on("data", (chunk: Buffer | string) => {
      this.consumeStdout(chunk.toString());
    });
    child.stderr.on("data", () => {
      this.stderrObserved = true;
    });
    void child.exit.then(({ code, signal: exitSignal }) => {
      if (this.closed) return;
      const suffix = this.stderrObserved ? "; stderr suppressed" : "";
      this.failAll(
        new Error(
          `Sandboxed stdio MCP exited before close (code ${String(code)}, signal ${String(exitSignal)})${suffix}`,
        ),
      );
      this.process = undefined;
    });

    const result = await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "napier", version: "0.1.0" },
      },
      signal,
      CONNECT_TIMEOUT_MS,
    );
    if (
      result["protocolVersion"] !== undefined &&
      typeof result["protocolVersion"] !== "string"
    ) {
      throw new Error("stdio MCP returned an invalid protocol version");
    }
    await this.notify("notifications/initialized", {});
  }

  async listTools(
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ tools: McpClientTool[]; nextCursor?: string }> {
    const result = await this.request(
      "tools/list",
      cursor ? { cursor } : {},
      signal,
      CONNECT_TIMEOUT_MS,
    );
    const rawTools = result["tools"];
    if (!Array.isArray(rawTools)) {
      throw new Error("MCP tools/list did not return a tools array");
    }
    const tools = rawTools.map((raw): McpClientTool => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("MCP tools/list returned an invalid tool");
      }
      const name = raw["name"];
      if (typeof name !== "string") {
        throw new Error("MCP tool is missing a string name");
      }
      return {
        name,
        ...(typeof raw["description"] === "string"
          ? { description: raw["description"] }
          : {}),
        ...("inputSchema" in raw ? { inputSchema: raw["inputSchema"] } : {}),
      };
    });
    const nextCursor = result["nextCursor"];
    return {
      tools,
      ...(typeof nextCursor === "string" && nextCursor ? { nextCursor } : {}),
    };
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpClientCallResult> {
    const result = await this.request(
      "tools/call",
      { name: toolName, arguments: args },
      signal,
      TOOL_TIMEOUT_MS,
    );
    return {
      contentText: flattenMcpContent(result),
      isError: result["isError"] === true,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("stdio MCP client closed"));
    const child = this.process;
    this.process = undefined;
    if (child) await child.terminate();
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const id = ++this.requestId;
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      const pending: PendingRequest = {
        method,
        resolve,
        reject,
        timer: setTimeout(() => {
          const current = this.pending.get(id);
          if (!current) return;
          this.pending.delete(id);
          clearPending(current);
          current.reject(new Error(`stdio MCP ${method} timed out`));
        }, timeoutMs),
        ...(signal ? { signal } : {}),
      };
      if (signal) {
        const onAbort = () => {
          const current = this.pending.get(id);
          if (!current) return;
          this.pending.delete(id);
          clearPending(current);
          current.reject(new Error(`stdio MCP ${method} was aborted`));
        };
        pending.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pending.set(id, pending);
    });
    try {
      await this.writeMessage({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        clearPending(pending);
        pending.reject(toError(error));
      }
    }
    return result;
  }

  private async notify(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.writeMessage({ jsonrpc: "2.0", method, params });
  }

  private async writeMessage(message: Record<string, unknown>): Promise<void> {
    const child = this.process;
    if (!child || this.closed) {
      throw new Error("stdio MCP process is not available");
    }
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_PROTOCOL_LINE_BYTES) {
      throw new Error("stdio MCP request exceeds the protocol size limit");
    }
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(line, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer) > MAX_PROTOCOL_LINE_BYTES) {
      this.failAll(
        new Error("stdio MCP response exceeds the protocol size limit"),
      );
      void this.close();
      return;
    }
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.consumeLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      this.failAll(new Error("stdio MCP emitted malformed JSON"));
      void this.close();
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const message = parsed as Record<string, unknown>;
    const id = message["id"];
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearPending(pending);
    if (message["error"] !== undefined) {
      pending.reject(
        new Error(`stdio MCP ${pending.method} returned a protocol error`),
      );
      return;
    }
    const result = message["result"];
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      pending.reject(
        new Error(`stdio MCP ${pending.method} returned no result`),
      );
      return;
    }
    pending.resolve(result as Record<string, unknown>);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearPending(pending);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function resolveMappedEnvironment(
  mapping: Record<string, string>,
  source: Readonly<Record<string, string | undefined>>,
  capabilities: Set<ExtensionCapability>,
): Record<string, string> {
  if (Object.keys(mapping).length > 0 && !capabilities.has("secrets.env")) {
    throw new Error("stdio MCP environment requires approved secrets.env");
  }
  const resolved: Record<string, string> = {};
  for (const [targetName, sourceName] of Object.entries(mapping)) {
    const value = source[sourceName];
    if (!value) {
      throw new Error(
        `MCP credential environment variable is missing: ${sourceName}`,
      );
    }
    resolved[targetName] = value;
  }
  return resolved;
}

function resolveStdioCwd(
  configured: string | undefined,
  workspaceRoot: string,
  capabilities: Set<ExtensionCapability>,
): string {
  const root = path.resolve(workspaceRoot);
  if (!configured) return root;
  const resolved = path.resolve(root, configured);
  if (!isPathInsideWorkspace(resolved, root)) {
    throw new Error("stdio MCP cwd escapes the configured workspace");
  }
  if (!capabilities.has("workspace.read")) {
    throw new Error("stdio MCP cwd requires approved workspace.read");
  }
  return resolved;
}

function clearPending(pending: PendingRequest): void {
  clearTimeout(pending.timer);
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener("abort", pending.onAbort);
  }
}

function flattenMcpContent(result: Record<string, unknown>): string {
  const lines: string[] = [];
  const content = result["content"];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      if (item["type"] === "text" && typeof item["text"] === "string") {
        lines.push(item["text"]);
      } else if (
        item["type"] === "resource_link" &&
        typeof item["uri"] === "string"
      ) {
        lines.push(`[resource: ${item["uri"]}]`);
      } else if (
        item["type"] === "image" &&
        typeof item["mimeType"] === "string"
      ) {
        lines.push(`[image omitted: ${item["mimeType"]}]`);
      }
    }
  }
  if ("structuredContent" in result) {
    lines.push(JSON.stringify(result["structuredContent"]));
  }
  return lines.join("\n").slice(0, MAX_TOOL_OUTPUT_CHARS);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
