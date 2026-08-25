import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";
import { parseHTML } from "linkedom";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KernelPluginInspectorSlots,
  resolveKernelInspectorSlots,
} from "../src/KernelPluginInspectorSlots";

vi.mock("../src/BrowserInspectorPanel", () => ({
  BrowserInspectorPanel: () =>
    h("div", { "data-plugin-browser-slot": "mounted" }),
}));

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("Kernel plugin inspector slots", () => {
  it("resolves only the exact enabled reviewed Browser contribution", () => {
    const [slot] = resolveKernelInspectorSlots([browserPlugin()]);
    expect(slot).toEqual(
      expect.objectContaining({
        pluginId: "plugin.browser",
        version: "1.0.0",
        contentSha256:
          "9242e78a76b9a7cef23c397360c3014c2895e0a8cc1cfb126c14ee08b3ed23a8",
        clientEntry: "@napier/web/kernel-browser-inspector-slot",
        slot: "inspector.panel",
        tab: "browser",
        load: expect.any(Function),
      }),
    );
    for (const plugin of [
      browserPlugin({ status: "disabled" }),
      browserPlugin({ version: "2.0.0" }),
      browserPlugin({ clientEntry: "@napier/web/unreviewed" }),
      browserPlugin({ contentSha256: "e".repeat(64) }),
      browserPlugin({ capabilities: ["tool"] }),
      browserPlugin({
        contributions: {
          ...browserPlugin().contributions,
          uiSlots: [],
        },
      }),
      {
        ...browserPlugin(),
        id: "plugin.unknown",
      },
    ]) {
      expect(resolveKernelInspectorSlots([plugin])).toEqual([]);
    }
  });

  it("mounts the lazy Browser panel only for an exact enabled descriptor", async () => {
    const enabled = installDom();
    await act(async () => {
      render(
        h(KernelPluginInspectorSlots, {
          plugins: [browserPlugin()],
          activeTab: "browser",
          browser: browserProps(),
        }),
        enabled,
      );
    });
    await vi.waitFor(() =>
      expect(
        enabled.querySelector('[data-plugin-browser-slot="mounted"]'),
      ).not.toBeNull(),
    );

    const disabled = installDom();
    await act(async () => {
      render(
        h(KernelPluginInspectorSlots, {
          plugins: [browserPlugin({ status: "disabled" })],
          activeTab: "browser",
          browser: browserProps(),
        }),
        disabled,
      );
      await Promise.resolve();
    });
    expect(
      disabled.querySelector('[data-plugin-browser-slot="mounted"]'),
    ).toBeNull();
  });
});

function browserPlugin(
  overrides: Partial<KernelPluginInspection> = {},
): KernelPluginInspection {
  return {
    id: "plugin.browser",
    version: "1.0.0",
    displayName: "Browser",
    description: "Provides isolated Run-owned Browser Sessions.",
    status: "enabled",
    trust: "first_party",
    dependencies: [],
    capabilities: ["tool", "ui_slot"],
    permissions: [
      "browser.control",
      "network.public",
      "workspace.read",
      "workspace.write",
    ],
    hostEntry: "@napier/runtime/kernel-browser-plugin",
    clientEntry: "@napier/web/kernel-browser-inspector-slot",
    contributions: {
      tools: ["browser"],
      providers: [],
      prompts: [],
      projections: [],
      uiSlots: ["inspector.panel"],
    },
    contentSha256:
      "9242e78a76b9a7cef23c397360c3014c2895e0a8cc1cfb126c14ee08b3ed23a8",
    ...overrides,
  };
}

function browserProps() {
  return {
    events: [],
    activeRunId: undefined,
    taskContext: {
      models: [],
      credentials: [],
      selectedModel: {
        key: "napier/demo",
        provider: "napier",
        id: "demo",
        label: "Demo",
        configured: true,
        known: true,
      },
    },
  };
}

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}
