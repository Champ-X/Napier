import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExtensionRecord } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ReviewedMcpToolBindingDriftError,
  reviewedMcpToolExecutionBinding,
} from "../src/mcp-agent-tool-protocol.js";
import { type McpClient, McpExtensionManager } from "../src/mcp.js";
import { LocalStore } from "../src/store.js";

interface Fixture {
  extension: ExtensionRecord;
  store: LocalStore;
  manager: McpExtensionManager;
  tool: ReturnType<McpExtensionManager["createAgentTools"]>[number];
  callTool: ReturnType<typeof vi.fn>;
  setDiscoveredSchema(schema: Record<string, unknown>): void;
}

interface InternalExtensionUpdater {
  updateExtension(
    extensionId: string,
    update: (current: ExtensionRecord) => ExtensionRecord,
  ): Promise<ExtensionRecord>;
}

const temporaryRoots: string[] = [];
const fixtures: Fixture[] = [];

afterEach(async () => {
  await Promise.allSettled(
    fixtures.splice(0).map(async ({ manager, store }) => {
      await manager.shutdown();
      store.close();
    }),
  );
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("reviewed MCP tool execution binding", () => {
  it("keeps an unchanged reviewed wrapper executable", async () => {
    const fixture = await createFixture();
    const binding = reviewedMcpToolExecutionBinding(
      fixture.extension,
      fixture.extension.tools[0]!,
    );

    expect(Object.isFrozen(binding)).toBe(true);
    await expect(
      fixture.tool.execute("unchanged", { query: "ledger" }),
    ).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({ effect: "read" }),
      }),
    );
    expect(fixture.callTool).toHaveBeenCalledTimes(1);
  });

  it("rejects extension revision drift before the MCP client is called", async () => {
    const fixture = await createFixture();
    const current = fixture.store.getExtension(fixture.extension.id);
    await fixture.store.setExtensionConnection(current.id, current.connection);

    await expectBindingDrift(
      fixture.tool.execute("revision-drift", { query: "ledger" }),
      ["extension_revision"],
    );
    expect(fixture.callTool).not.toHaveBeenCalled();
  });

  it("rejects schema and effect drift instead of reusing reviewed policy", async () => {
    const schemaFixture = await createFixture();
    schemaFixture.setDiscoveredSchema({
      type: "object",
      properties: { destructive: { type: "boolean" } },
    });
    await schemaFixture.manager.connect(schemaFixture.extension.id);

    await expectBindingDrift(
      schemaFixture.tool.execute("schema-drift", { query: "ledger" }),
      ["extension_revision", "schema_sha256", "effect"],
    );
    expect(schemaFixture.callTool).not.toHaveBeenCalled();

    const effectFixture = await createFixture();
    await effectFixture.store.reviewMcpTool(
      effectFixture.extension.id,
      "search",
      { action: "approve", effect: "write" },
    );

    await expectBindingDrift(
      effectFixture.tool.execute("effect-drift", { query: "ledger" }),
      ["extension_revision", "effect"],
    );
    expect(effectFixture.callTool).not.toHaveBeenCalled();
  });

  it("rejects executable route drift even if a corrupted record reuses the revision", async () => {
    const fixture = await createFixture();
    const updater = fixture.store as unknown as InternalExtensionUpdater;
    await updater.updateExtension(fixture.extension.id, (current) => {
      if (current.transport.type !== "streamable_http") {
        throw new Error("Expected an HTTP MCP fixture");
      }
      return {
        ...current,
        transport: {
          ...current.transport,
          url: "https://replacement.example.com/mcp",
        },
      };
    });

    await expectBindingDrift(
      fixture.tool.execute("implementation-drift", { query: "ledger" }),
      ["implementation_sha256"],
    );
    expect(fixture.callTool).not.toHaveBeenCalled();
  });
});

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-mcp-binding-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  let discoveredSchema: Record<string, unknown> = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  };
  const callTool = vi.fn(async () => ({
    contentText: "One reviewed result",
    isError: false,
  }));
  const client: McpClient = {
    initialize: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: [
        {
          name: "search",
          description: "Search approved records",
          inputSchema: structuredClone(discoveredSchema),
        },
      ],
    })),
    callTool,
    close: vi.fn(async () => undefined),
  };
  const manager = new McpExtensionManager({
    store,
    createClient: async () => client,
    validateEndpoint: async () => undefined,
  });
  let extension = await store.createMcpExtension({
    name: "Reviewed records",
    transport: {
      type: "streamable_http",
      url: "https://example.com/mcp",
    },
    requestedCapabilities: ["external.read", "external.write"],
  });
  extension = await store.reviewExtension(extension.id, { action: "approve" });
  extension = await manager.connect(extension.id);
  extension = await store.reviewMcpTool(extension.id, "search", {
    action: "approve",
    effect: "read",
  });
  extension = await store.setExtensionEnabled(extension.id, agent.id, true);
  const tool = manager.createAgentTools(agent.id)[0];
  if (!tool) throw new Error("Expected one reviewed MCP AgentTool");
  const fixture: Fixture = {
    extension,
    store,
    manager,
    tool,
    callTool,
    setDiscoveredSchema(schema) {
      discoveredSchema = schema;
    },
  };
  fixtures.push(fixture);
  return fixture;
}

async function expectBindingDrift(
  operation: Promise<unknown>,
  expectedDrift: ReviewedMcpToolBindingDriftError["drift"],
): Promise<void> {
  let observed: unknown;
  try {
    await operation;
  } catch (error) {
    observed = error;
  }
  expect(observed).toBeInstanceOf(ReviewedMcpToolBindingDriftError);
  expect((observed as ReviewedMcpToolBindingDriftError).drift).toEqual(
    expectedDrift,
  );
  expect((observed as Error).message).toContain(
    "rebuild MCP agent tools before execution",
  );
}
