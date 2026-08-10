import { PassThrough } from "node:stream";

import type { OsSandboxAdapter, SandboxedProcess } from "../src/sandbox.js";
import { describe, expect, it, vi } from "vitest";

import { StdioMcpClient } from "../src/mcp-stdio.js";

function createFakeSandbox() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveExit:
    | ((result: { code: number | null; signal: NodeJS.Signals | null }) => void)
    | undefined;
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    resolveExit = resolve;
  });
  const terminate = vi.fn(async () => {
    resolveExit?.({ code: 0, signal: null });
  });
  const process: SandboxedProcess = {
    stdin,
    stdout,
    stderr,
    exit,
    terminate,
  };
  const launch = vi.fn(async () => process);
  const sandbox: OsSandboxAdapter = {
    id: "fake-sandbox",
    launch,
  };

  let input = "";
  const methods: string[] = [];
  stdin.on("data", (chunk: Buffer) => {
    input += chunk.toString();
    let newline = input.indexOf("\n");
    while (newline >= 0) {
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      const message = JSON.parse(line) as {
        id?: number;
        method: string;
        params?: Record<string, unknown>;
      };
      methods.push(message.method);
      if (message.id !== undefined) {
        stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: responseFor(message.method, message.params),
          })}\n`,
        );
      }
      newline = input.indexOf("\n");
    }
  });
  return { sandbox, launch, terminate, methods };
}

function responseFor(
  method: string,
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture", version: "1.0.0" },
    };
  }
  if (method === "tools/list") {
    return {
      tools: [
        {
          name: "search",
          description: "Search fixture records",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    };
  }
  if (method === "tools/call") {
    expect(params).toEqual({
      name: "search",
      arguments: { query: "ledger" },
    });
    return {
      content: [{ type: "text", text: "Sandboxed result" }],
      structuredContent: { count: 1 },
      isError: false,
    };
  }
  throw new Error(`Unexpected fixture method: ${method}`);
}

describe("StdioMcpClient", () => {
  it("runs JSON-RPC through a sandbox with explicit environment mapping", async () => {
    const fake = createFakeSandbox();
    const client = new StdioMcpClient({
      transport: {
        type: "stdio",
        command: "/opt/napier/bin/fixture-mcp",
        args: ["--stdio"],
        cwd: "services/fixture",
        env: { MCP_TOKEN: "SOURCE_TOKEN" },
      },
      sandbox: fake.sandbox,
      workspaceRoot: "/workspace",
      approvedCapabilities: [
        "process.spawn",
        "workspace.read",
        "secrets.env",
        "external.read",
      ],
      environment: {
        SOURCE_TOKEN: "transient-secret",
        UNRELATED_SECRET: "must-not-pass",
      },
    });

    await client.initialize();
    const catalog = await client.listTools();
    const result = await client.callTool("search", { query: "ledger" });
    await client.close();

    expect(fake.launch).toHaveBeenCalledWith({
      command: "/opt/napier/bin/fixture-mcp",
      args: ["--stdio"],
      cwd: "/workspace/services/fixture",
      env: { MCP_TOKEN: "transient-secret" },
      workspaceRoot: "/workspace",
      stdinMode: "open",
      approvedCapabilities: [
        "process.spawn",
        "workspace.read",
        "secrets.env",
        "external.read",
      ],
    });
    expect(JSON.stringify(fake.launch.mock.calls)).not.toContain(
      "UNRELATED_SECRET",
    );
    expect(catalog.tools[0]).toEqual(
      expect.objectContaining({
        name: "search",
        description: "Search fixture records",
      }),
    );
    expect(result).toEqual({
      contentText: 'Sandboxed result\n{"count":1}',
      isError: false,
    });
    expect(fake.methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  it("rejects missing mapped secrets before launching", async () => {
    const fake = createFakeSandbox();
    const client = new StdioMcpClient({
      transport: {
        type: "stdio",
        command: "/opt/napier/bin/fixture-mcp",
        env: { MCP_TOKEN: "MISSING_SOURCE" },
      },
      sandbox: fake.sandbox,
      workspaceRoot: "/workspace",
      approvedCapabilities: ["process.spawn", "secrets.env"],
      environment: {},
    });

    await expect(client.initialize()).rejects.toThrow(
      "MCP credential environment variable is missing: MISSING_SOURCE",
    );
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it("rejects workspace cwd without explicit read approval", async () => {
    const fake = createFakeSandbox();
    const client = new StdioMcpClient({
      transport: {
        type: "stdio",
        command: "/opt/napier/bin/fixture-mcp",
        cwd: "services/fixture",
      },
      sandbox: fake.sandbox,
      workspaceRoot: "/workspace",
      approvedCapabilities: ["process.spawn"],
    });

    await expect(client.initialize()).rejects.toThrow(
      "cwd requires approved workspace.read",
    );
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it("suppresses subprocess stderr from persisted connection errors", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let resolveExit:
      | ((result: {
          code: number | null;
          signal: NodeJS.Signals | null;
        }) => void)
      | undefined;
    const exit = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      resolveExit = resolve;
    });
    stdin.once("data", () => {
      stderr.write("echoed-transient-secret");
      resolveExit?.({ code: 1, signal: null });
    });
    const sandbox: OsSandboxAdapter = {
      id: "failing-sandbox",
      launch: async () => ({
        stdin,
        stdout,
        stderr,
        exit,
        terminate: async () => undefined,
      }),
    };
    const client = new StdioMcpClient({
      transport: {
        type: "stdio",
        command: "/opt/napier/bin/fixture-mcp",
      },
      sandbox,
      workspaceRoot: "/workspace",
      approvedCapabilities: ["process.spawn"],
    });

    let message = "";
    try {
      await client.initialize();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("stderr suppressed");
    expect(message).not.toContain("echoed-transient-secret");
  });
});
