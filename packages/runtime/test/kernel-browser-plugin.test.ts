import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { BROWSER_KERNEL_PLUGIN_ID } from "../src/kernel-browser-plugin.js";
import type { RunBrowserSessionManager } from "../src/browser-session.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser Kernel plugin", () => {
  it("removes Browser/Research schemas, closes Sessions, and restores them on enable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-plugin-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const manager = browserManager();
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      browserSessions: manager as unknown as RunBrowserSessionManager,
      env: {},
    });
    try {
      expect(
        services.kernel.plugins
          .inspect()
          .find((plugin) => plugin.id === BROWSER_KERNEL_PLUGIN_ID),
      ).toEqual(
        expect.objectContaining({
          status: "enabled",
          capabilities: ["tool", "ui_slot"],
          permissions: [
            "browser.control",
            "network.public",
            "workspace.read",
            "workspace.write",
          ],
          clientEntry: "@napier/web/kernel-browser-inspector-slot",
          contributions: expect.objectContaining({
            tools: ["browser"],
            uiSlots: ["inspector.panel"],
          }),
        }),
      );
      const agent = services.store.listAgents()[0]!;
      expect(agent.enabledTools).toEqual(
        expect.arrayContaining(["browser", "research_source", "web_fetch"]),
      );

      await services.kernel.plugins.disable(BROWSER_KERNEL_PLUGIN_ID);
      expect(manager.shutdown).toHaveBeenCalledOnce();
      const disabledProvider = fauxProvider({ provider: "faux-browser-off" });
      disabledProvider.setResponses([
        (context) => {
          const names = context.tools?.map((tool) => tool.name) ?? [];
          expect(names).not.toContain("browser");
          expect(names).not.toContain("research_source");
          expect(names).toContain("web_fetch");
          return fauxAssistantMessage("BROWSER_PLUGIN_DISABLED");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(disabledProvider.provider);
      const disabledThread = await services.store.createThread({
        title: "Browser disabled",
        agentId: agent.id,
      });
      const disabledRun = await services.kernel.runPrompt({
        threadId: disabledThread.id,
        text: "Report the Browser plugin state.",
        model: { provider: "faux-browser-off", id: "faux-1" },
      });
      expect(disabledRun.status).toBe("completed");
      expect(
        services.kernel.plugins
          .inspect()
          .find((plugin) => plugin.id === BROWSER_KERNEL_PLUGIN_ID)?.status,
      ).toBe("disabled");

      await services.kernel.plugins.enable(BROWSER_KERNEL_PLUGIN_ID);
      const enabledProvider = fauxProvider({ provider: "faux-browser-on" });
      enabledProvider.setResponses([
        (context) => {
          const names = context.tools?.map((tool) => tool.name) ?? [];
          expect(names).toContain("browser");
          expect(names).toContain("research_source");
          return fauxAssistantMessage("BROWSER_PLUGIN_ENABLED");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(enabledProvider.provider);
      const enabledThread = await services.store.createThread({
        title: "Browser enabled",
        agentId: agent.id,
      });
      const enabledRun = await services.kernel.runPrompt({
        threadId: enabledThread.id,
        text: "Report the restored Browser plugin state.",
        model: { provider: "faux-browser-on", id: "faux-1" },
      });
      expect(enabledRun.status).toBe("completed");
      expect(
        services.kernel.plugins
          .inspect()
          .find((plugin) => plugin.id === BROWSER_KERNEL_PLUGIN_ID)?.status,
      ).toBe("enabled");
    } finally {
      await services.shutdown();
    }
  });
});

function browserManager() {
  return {
    available: () => true,
    hasActiveSession: vi.fn(() => false),
    capturePage: vi.fn(),
    captureLiveView: vi.fn(),
    captureTakeoverSnapshot: vi.fn(),
    executeTakeoverAction: vi.fn(),
    execute: vi.fn(),
    executeConfirmedUpload: vi.fn(),
    executeConfirmedAction: vi.fn(),
    captureConfirmationPageState: vi.fn(),
    cancelRun: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
}
