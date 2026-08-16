import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import KernelPluginDesk from "../src/KernelPluginDesk";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("Kernel Plugin desk", () => {
  it("renders status, contribution, permission, dependency, and entry metadata", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <KernelPluginDesk
          plugins={[
            {
              id: "plugin.artifact",
              version: "1.0.0",
              displayName: "Artifact",
              description: "Projects authoritative Plan artifact state.",
              status: "enabled",
              trust: "first_party",
              dependencies: [],
              capabilities: ["projection"],
              permissions: [],
              hostEntry: "@napier/runtime/kernel-artifact-plugin",
              contributions: {
                tools: [],
                providers: [],
                prompts: [],
                projections: ["conversation.artifacts"],
                uiSlots: [],
              },
              contentSha256: "f".repeat(64),
            },
            {
              id: "plugin.search",
              version: "1.0.0",
              displayName: "Search",
              description: "Provides policy-bounded live public Web Search.",
              status: "enabled",
              trust: "first_party",
              dependencies: [],
              capabilities: ["tool"],
              permissions: ["network.public"],
              hostEntry: "@napier/runtime/kernel-search-plugin",
              contributions: {
                tools: ["web_search"],
                providers: [],
                prompts: [],
                projections: [],
                uiSlots: [],
              },
              contentSha256: "e".repeat(64),
            },
            {
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
              contentSha256: "d".repeat(64),
            },
          ]}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("FIRST-PARTY PLUGINS");
    expect(container.textContent).toContain("Artifact");
    expect(container.textContent).toContain("plugin.artifact@1.0.0");
    expect(container.textContent).toContain("Enabled");
    expect(container.textContent).toContain(
      "projection:conversation.artifacts",
    );
    expect(container.textContent).toContain("No additional permissions");
    expect(container.textContent).toContain("No plugin dependencies");
    expect(container.textContent).toContain(
      "@napier/runtime/kernel-artifact-plugin",
    );
    expect(container.textContent).toContain("Search");
    expect(container.textContent).toContain("tool:web_search");
    expect(container.textContent).toContain("network.public");
    expect(container.textContent).toContain(
      "@napier/runtime/kernel-search-plugin",
    );
    expect(container.textContent).toContain("Browser");
    expect(container.textContent).toContain("tool:browser");
    expect(container.textContent).toContain("ui:inspector.panel");
    expect(container.textContent).toContain("browser.control");
    expect(container.textContent).toContain(
      "@napier/runtime/kernel-browser-plugin",
    );
    expect(container.textContent).toContain(
      "@napier/web/kernel-browser-inspector-slot",
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

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
