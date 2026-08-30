import { createHash } from "node:crypto";

import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";

import { ComposerCapabilityControl } from "../src/ComposerCapabilityControl";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  vi.unstubAllGlobals();
});

describe("ComposerCapabilityControl", () => {
  it("shows three persistent permission levels with Full access selected", async () => {
    const { container } = installDom();
    const selected = projection("full_access");
    const fetchMock = vi.fn(async (path: string) => {
      expect(path).toBe(
        "/api/agents/agent_napier/capabilities?preset=full_access",
      );
      return projectionResponse(selected, "full_access");
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSelectedPresetChange = vi.fn();
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ComposerCapabilityControl
          agent={agent()}
          disabled={false}
          selectedPreset="full_access"
          onSelectedPresetChange={onSelectedPresetChange}
          onReview={vi.fn()}
          onReadinessChange={vi.fn()}
        />,
      );
    });
    await waitFor(() =>
      container.textContent?.includes("Host-direct execution"),
    );

    expect(modeLabels(container)).toEqual([
      "Read only",
      "Workspace",
      "Full access",
    ]);
    expect(
      findModeButton(container, "Full access").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.textContent).not.toContain("NEXT RUN ONLY");
    expect(container.textContent).not.toContain("1×");
    expect(container.textContent).not.toContain("Safe Automation");
    expect(container.textContent).toContain("Host-direct execution");

    findModeButton(container, "Workspace").click();
    expect(onSelectedPresetChange).toHaveBeenCalledWith("safe_automation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps advanced Agent and Sandbox controls out of the primary choice", async () => {
    const { container } = installDom();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        projectionResponse(projection("read_only"), "read_only"),
      ),
    );
    const onReview = vi.fn();
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ComposerCapabilityControl
          agent={agent()}
          disabled={false}
          selectedPreset="read_only"
          onSelectedPresetChange={vi.fn()}
          onReview={onReview}
          onReadinessChange={vi.fn()}
        />,
      );
    });
    await waitFor(() => container.textContent?.includes("Advanced settings"));

    findButton(container, "Advanced settings").click();
    expect(onReview).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Install Sandbox");
    expect(
      findElements(container, (element) =>
        hasClass(element, "composer-readiness-item"),
      ),
    ).toHaveLength(1);
  });
});

function installDom() {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return { container: document.getElementById("app") as HTMLElement };
}

function agent(): AgentProfile {
  return {
    id: "agent_napier",
    name: "Napier",
    description: "Fixture",
    systemPrompt: "Stay bounded.",
    model: { provider: "faux", id: "faux-1" },
    thinkingLevel: "minimal",
    toolPolicy: "workspace",
    enabledTools: ["read_file", "apply_patch", "run_command"],
    enabledSkills: [],
    enabledSubagents: [],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    revision: 1,
  };
}

function projection(
  capabilityPreset: Extract<
    AgentCapabilityPresetId,
    "read_only" | "safe_automation" | "full_access"
  >,
): EffectiveAgentCapabilityProjectionV1 {
  const toolPolicy =
    capabilityPreset === "read_only"
      ? "observe"
      : capabilityPreset === "safe_automation"
        ? "workspace"
        : "unrestricted";
  const tools = [
    "web_search",
    "web_fetch",
    "browser",
    "apply_patch",
    "run_command",
  ];
  return {
    kind: "napier.effective-agent-capabilities",
    schemaVersion: 1,
    agentId: "agent_napier",
    agentRevision: 1,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 4,
    recommendationSha256: "a".repeat(64),
    driftState: "current",
    ownership: "recommended",
    explicitOverrideFields: [],
    capabilityPreset,
    toolPolicy,
    configuredTools: tools,
    runtimeExposedTools:
      capabilityPreset === "read_only"
        ? tools.filter((tool) => !["apply_patch", "run_command"].includes(tool))
        : tools,
    configuredSkills: [],
    configuredSubagents: [],
    readiness: [
      readiness("tool:web_search", "ready"),
      readiness("tool:web_fetch", "ready"),
      readiness("tool:browser", "ready"),
      readiness(
        "tool:apply_patch",
        capabilityPreset === "read_only" ? "blocked_by_policy" : "ready",
      ),
      readiness(
        "tool:run_command",
        capabilityPreset === "read_only" ? "blocked_by_policy" : "ready",
      ),
      readiness("sandbox:host-direct", "available_unverified"),
    ],
    restorePreview: {
      schemaVersion: 1,
      contractId: "napier.default-agent.capabilities",
      contractVersion: 4,
      recommendationSha256: "a".repeat(64),
      agentId: "agent_napier",
      agentRevision: 1,
      currentManagedStateSha256: "b".repeat(64),
      targetManagedStateSha256: "c".repeat(64),
      operations: [],
      diffSha256: "d".repeat(64),
    },
    projectionSha256: "e".repeat(64),
  };
}

function readiness(
  id: string,
  status: EffectiveAgentCapabilityProjectionV1["readiness"][number]["status"],
): EffectiveAgentCapabilityProjectionV1["readiness"][number] {
  const exposed = status === "ready" || status === "available_unverified";
  return {
    id,
    status,
    configured: true,
    allowedByPolicy: exposed,
    exposed,
    detail: "fixture",
  };
}

function projectionResponse(
  value: EffectiveAgentCapabilityProjectionV1,
  preset: AgentCapabilityPresetId,
): Response {
  const text = JSON.stringify(value);
  return new Response(text, {
    headers: {
      "Content-Type": "application/json",
      "X-Napier-Content-SHA256": createHash("sha256")
        .update(text)
        .digest("hex"),
      "X-Napier-Content-SHA256-Mode": "body",
      "X-Napier-Capability-Preset": preset,
    },
  });
}

function modeLabels(container: HTMLElement): string[] {
  return findElements(container, (element) =>
    hasClass(element, "composer-permission-label"),
  ).map((element) => element.textContent ?? "");
}

function findModeButton(
  container: HTMLElement,
  label: string,
): HTMLButtonElement {
  const labelElement = findElements(
    container,
    (element) =>
      hasClass(element, "composer-permission-label") &&
      element.textContent === label,
  )[0];
  const button = labelElement?.parentElement;
  if (!button) throw new Error(`Mode button not found: ${label}`);
  return button as HTMLButtonElement;
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = findElements(
    container,
    (candidate) =>
      candidate.localName === "button" &&
      candidate.textContent?.trim() === text,
  )[0];
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}

function findElements(
  root: Node,
  predicate: (element: Element) => boolean,
): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.childNodes)) {
    if ("localName" in child && predicate(child as Element)) {
      matches.push(child as Element);
    }
    matches.push(...findElements(child, predicate));
  }
  return matches;
}

function hasClass(element: Element, className: string): boolean {
  const candidate = element as Element & {
    getAttribute?: (name: string) => string | null;
  };
  return (
    typeof candidate.getAttribute === "function" &&
    (candidate.getAttribute("class") ?? "").split(/\s+/u).includes(className)
  );
}

async function waitFor(check: () => boolean | undefined): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true));
}
