import { createHash } from "node:crypto";

import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";
import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCapabilityContractCard } from "../src/AgentCapabilityContractCard";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("AgentCapabilityContractCard", () => {
  it.each([
    ["current", "recommended", []],
    ["stale", "unknown_legacy", ["enabledTools", "toolPolicy"]],
    ["custom_unmanaged", "unmanaged", []],
    ["broken", "unmanaged", []],
  ] as const)(
    "renders the actual %s card with ownership and sorted overrides",
    async (driftState, ownership, explicitOverrideFields) => {
      const { container } = installDom();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          bodyResponse(
            projection({ driftState, ownership, explicitOverrideFields }),
          ),
        ),
      );
      await renderCard(container);
      await waitFor(() => !container.textContent?.includes("Loading"));
      expect(container.textContent).toContain(
        `v1 · ${driftState} · ${ownership}`,
      );
      if (explicitOverrideFields.length > 0) {
        const overrides = container.querySelector(
          ".agent-capability-contract-overrides",
        );
        expect(overrides?.querySelector("strong")?.textContent).toBe(
          "Explicit override fields",
        );
        expect(overrides?.querySelector("span")?.textContent).toBe(
          "enabledTools, toolPolicy",
        );
      }
      expect(container.querySelector("section")?.className).toContain(
        `state-${driftState}`,
      );
    },
  );

  it("automatically refetches an authoritative conflict projection and requires renewed confirmation", async () => {
    const { container, window } = installDom();
    const stale = projection({
      driftState: "stale",
      ownership: "unknown_legacy",
      explicitOverrideFields: ["toolPolicy", "enabledTools"],
    });
    const authoritative = projection({
      agentRevision: 3,
      driftState: "custom_unmanaged",
      ownership: "unmanaged",
      explicitOverrideFields: [],
      diffSha256: "f".repeat(64),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bodyResponse(stale))
      .mockResolvedValueOnce(errorResponse(409, "Capability restore conflict"))
      .mockResolvedValueOnce(bodyResponse(authoritative));
    vi.stubGlobal("fetch", fetchMock);
    await renderCard(container);
    await waitFor(() => !container.textContent?.includes("Loading"));

    const checkbox = findElementByLocalName<HTMLInputElement>(
      container,
      "input",
    );
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox!.checked = true;
      checkbox!.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const button = findElementByLocalName<HTMLButtonElement>(
      container,
      "button",
    );
    expect(button).not.toBeNull();
    await waitFor(() => !button!.disabled);
    expect(button!.disabled).toBe(false);
    await act(async () => {
      button!.click();
      await flush();
    });

    await waitFor(() => fetchMock.mock.calls.length === 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await waitFor(() => container.textContent?.includes("REV 3") === true);
    expect(container.textContent).toContain("REV 3");
    expect(container.textContent).toContain("f".repeat(64));
    expect(container.textContent).toContain("Authoritative projection loaded");
    const refreshedButton = findElementByLocalName<HTMLButtonElement>(
      container,
      "button",
    );
    expect(refreshedButton?.disabled).toBe(true);
    refreshedButton?.click();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("prefers safe upgrade and preserves explicit override fields", async () => {
    const { container, window } = installDom();
    const stale = projection({
      driftState: "stale",
      ownership: "explicit_overrides",
      explicitOverrideFields: ["enabledSkills"],
      upgradePreview: {
        schemaVersion: 1,
        contractId: "napier.default-agent.capabilities",
        sourceContractVersion: 1,
        targetContractVersion: 2,
        sourceRecommendationSha256: "a".repeat(64),
        targetRecommendationSha256: "a".repeat(64),
        agentId: "agent_napier",
        agentRevision: 2,
        explicitOverrideFields: ["enabledSkills"],
        currentManagedStateSha256: "b".repeat(64),
        targetManagedStateSha256: "c".repeat(64),
        operations: [
          {
            field: "enabledTools",
            operation: "add",
            value: "skill_load",
            effect: "read",
            risk: "low",
          },
        ],
        diffSha256: "f".repeat(64),
      },
    });
    const upgraded = {
      schemaVersion: 1,
      previousRevision: 2,
      projection: {
        ...stale,
        agentRevision: 3,
        driftState: "current" as const,
        upgradePreview: undefined,
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bodyResponse(stale))
      .mockResolvedValueOnce(bodyResponse(upgraded));
    vi.stubGlobal("fetch", fetchMock);
    await renderCard(container);
    await waitFor(() => !container.textContent?.includes("Loading"));

    expect(container.textContent).toContain("Safe contract upgrade diff");
    expect(container.textContent).toContain(
      "Upgrade while preserving overrides",
    );
    expect(container.textContent).toContain("enabledSkills");
    const checkbox = findElementByLocalName<HTMLInputElement>(
      container,
      "input",
    )!;
    await act(async () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const button = findElementByLocalName<HTMLButtonElement>(
      container,
      "button",
    )!;
    await waitFor(() => !button.disabled);
    await act(async () => {
      button.click();
      await flush();
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/agents/agent_napier/capabilities/upgrade",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: 2,
          diffSha256: "f".repeat(64),
        }),
      }),
    ]);
  });
});

async function renderCard(container: HTMLElement): Promise<void> {
  containers.push(container);
  await act(async () => {
    render(
      <AgentCapabilityContractCard
        agentId="agent_napier"
        agentRevision={2}
        disabled={false}
        onRestored={() => undefined}
      />,
      container,
    );
    await flush();
  });
}

function findElementByLocalName<T extends Element>(
  root: Node,
  localName: string,
): T | null {
  for (const child of Array.from(root.childNodes)) {
    if (
      "localName" in child &&
      typeof child.localName === "string" &&
      child.localName === localName
    ) {
      return child as T;
    }
    const nested = findElementByLocalName<T>(child, localName);
    if (nested) return nested;
  }
  return null;
}

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
  return {
    container: document.getElementById("app") as unknown as HTMLElement,
    window,
  };
}

function projection(
  options: Partial<EffectiveAgentCapabilityProjectionV1> & {
    diffSha256?: string;
  },
): EffectiveAgentCapabilityProjectionV1 {
  const agentRevision = options.agentRevision ?? 2;
  return {
    kind: "napier.effective-agent-capabilities",
    schemaVersion: 1,
    agentId: "agent_napier",
    agentRevision,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 1,
    recommendationSha256: "a".repeat(64),
    driftState: options.driftState ?? "current",
    ownership: options.ownership ?? "recommended",
    explicitOverrideFields: [...(options.explicitOverrideFields ?? [])],
    toolPolicy: "observe",
    configuredTools: ["read_file"],
    runtimeExposedTools: ["read_file"],
    configuredSkills: [],
    configuredSubagents: [],
    readiness: [
      {
        id: "tool:read_file",
        status: "ready",
        configured: true,
        allowedByPolicy: true,
        exposed: true,
        detail: "ready",
      },
    ],
    ...(options.upgradePreview
      ? { upgradePreview: structuredClone(options.upgradePreview) }
      : {}),
    restorePreview: {
      schemaVersion: 1,
      contractId: "napier.default-agent.capabilities",
      contractVersion: 1,
      recommendationSha256: "a".repeat(64),
      agentId: "agent_napier",
      agentRevision,
      currentManagedStateSha256: "b".repeat(64),
      targetManagedStateSha256: "c".repeat(64),
      operations: [],
      diffSha256: options.diffSha256 ?? "d".repeat(64),
    },
    projectionSha256: "e".repeat(64),
  };
}

function bodyResponse(value: unknown): Response {
  const text = JSON.stringify(value);
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Napier-Content-SHA256": sha256(text),
      "X-Napier-Content-SHA256-Mode": "body",
    },
  });
}

function errorResponse(status: number, message: string): Response {
  const text = JSON.stringify({ error: message });
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Napier-Content-SHA256": sha256(text),
      "X-Napier-Content-SHA256-Mode": "body",
      "X-Napier-Error-Code": "conflict",
      "X-Napier-Error-Message-SHA256": sha256(message),
    },
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => flush());
  }
  throw new Error("Timed out waiting for component state");
}
