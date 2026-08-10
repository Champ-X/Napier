import { createHash } from "node:crypto";

import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile } from "@napier/contracts";
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
  it("selects a temporary next-Run mode without persisting the Agent", async () => {
    const { container } = installDom();
    const fetchMock = vi.fn(async (path: string) => {
      expect(path).toBe("/api/agents/agent_napier/capabilities");
      return projectionResponse(projection());
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
          selectedPreset={undefined}
          onSelectedPresetChange={onSelectedPresetChange}
          onReview={vi.fn()}
          onReadinessChange={vi.fn()}
        />,
      );
    });
    await waitFor(() =>
      container
        .querySelector("[data-scope='next-run-only']")
        ?.getAttribute("aria-label")
        ?.startsWith("Next-run task mode"),
    );

    findButton(container, "Browser").click();
    expect(onSelectedPresetChange).toHaveBeenCalledWith("browser");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method !== "PUT")).toBe(
      true,
    );
  });

  it("renders the selected preset as one-shot and can restore the Agent default", async () => {
    const { container } = installDom();
    const selected = projection("browser");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        expect(path).toBe(
          "/api/agents/agent_napier/capabilities?preset=browser",
        );
        return projectionResponse(selected, "browser");
      }),
    );
    const onSelectedPresetChange = vi.fn();
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ComposerCapabilityControl
          agent={agent()}
          disabled={false}
          selectedPreset="browser"
          onSelectedPresetChange={onSelectedPresetChange}
          onReview={vi.fn()}
          onReadinessChange={vi.fn()}
        />,
      );
    });
    await waitFor(() => container.textContent?.includes("Browser 1×"));

    findButton(container, "Use default").click();
    expect(onSelectedPresetChange).toHaveBeenCalledWith(undefined);
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
    toolPolicy: "observe",
    enabledTools: ["read_file"],
    enabledSkills: [],
    enabledSubagents: [],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    revision: 1,
  };
}

function projection(
  capabilityPreset?: "browser",
): EffectiveAgentCapabilityProjectionV1 {
  return {
    kind: "napier.effective-agent-capabilities",
    schemaVersion: 1,
    agentId: "agent_napier",
    agentRevision: 1,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 3,
    recommendationSha256: "a".repeat(64),
    driftState: "custom_unmanaged",
    ownership: "unmanaged",
    explicitOverrideFields: [],
    toolPolicy: "observe",
    configuredTools: capabilityPreset
      ? ["browser", "web_fetch", "web_search"]
      : ["read_file"],
    runtimeExposedTools: capabilityPreset
      ? ["browser", "web_fetch", "web_search"]
      : ["read_file"],
    configuredSkills: [],
    configuredSubagents: [],
    ...(capabilityPreset ? { capabilityPreset } : {}),
    readiness: [
      readiness("tool:browser", "available_unverified"),
      readiness("tool:web_fetch", "available_unverified"),
      readiness("tool:web_search", "available_unverified"),
      readiness("sandbox:test", "ready"),
    ],
    restorePreview: {
      schemaVersion: 1,
      contractId: "napier.default-agent.capabilities",
      contractVersion: 3,
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
  return {
    id,
    status,
    configured: true,
    allowedByPolicy: true,
    exposed: true,
    detail: "fixture",
  };
}

function projectionResponse(
  value: EffectiveAgentCapabilityProjectionV1,
  preset?: string,
): Response {
  const text = JSON.stringify(value);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Napier-Content-SHA256": createHash("sha256")
      .update(text)
      .digest("hex"),
    "X-Napier-Content-SHA256-Mode": "body",
  };
  if (preset) headers["X-Napier-Capability-Preset"] = preset;
  return new Response(text, { headers });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = findElement<HTMLButtonElement>(container, (candidate) =>
    candidate.localName === "button" &&
    candidate.textContent?.trim() === text
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function findElement<T extends Element>(
  root: Node,
  predicate: (element: Element) => boolean,
): T | undefined {
  for (const child of Array.from(root.childNodes)) {
    if ("localName" in child && predicate(child as Element)) {
      return child as T;
    }
    const nested = findElement<T>(child, predicate);
    if (nested) return nested;
  }
  return undefined;
}

async function waitFor(check: () => boolean | undefined): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true));
}
