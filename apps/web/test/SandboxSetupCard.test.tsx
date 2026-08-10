import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SandboxSetupPreview,
  SandboxSetupResult,
} from "@napier/contracts/sandbox-setup";

import { SandboxSetupCard } from "../src/SandboxSetupCard";
import { SANDBOX_READY_EVENT } from "../src/use-agent-capability-projection";
import { canonicalJson, sha256Text } from "../src/stable-digest";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    root.unmount();
  }
  await flush();
  await flush();
  vi.unstubAllGlobals();
});

describe("SandboxSetupCard", () => {
  it("renders a build docket, applies its exact preview, and announces hot activation", async () => {
    const { container, window } = installDom();
    const preview = await sandboxPreview("buildable");
    const result = await sandboxResult(preview);
    const ready = await sandboxPreview("ready");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stableResponse(preview))
      .mockResolvedValueOnce(stableResponse(result))
      .mockResolvedValueOnce(stableResponse(ready));
    vi.stubGlobal("fetch", fetchMock);
    let activationEvents = 0;
    window.addEventListener(SANDBOX_READY_EVENT, () => {
      activationEvents += 1;
    });

    const root = createRoot(container);
    roots.push(root);
    root.render(<SandboxSetupCard />);
    await flush();
    await waitFor(() => container.textContent?.includes("Build & activate"));
    expect(container.textContent).toContain("NODE · PY · GIT · LSP · DAP");
    expect(container.textContent).toContain(preview.contentSha256.slice(0, 12));

    const button = findElementByText<HTMLButtonElement>(
      container,
      "Build & activate",
    );
    expect(button).not.toBeNull();
    button!.click();
    await flush();
    await waitFor(() => container.textContent?.includes("Sandbox active"));

    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/setup/sandbox",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedPreviewSha256: preview.contentSha256,
        }),
      }),
    ]);
    expect(container.textContent).toContain("Coding runtime ready");
    expect(activationEvents).toBe(1);
  });
});

async function sandboxPreview(
  status: SandboxSetupPreview["status"],
): Promise<SandboxSetupPreview> {
  const content = {
    kind: "napier.sandbox-runtime-setup-preview" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    status,
    active: status === "ready",
    imageReference: "napier-sandbox:0.1.0",
    ...(status === "ready" ? { imageId: `sha256:${"a".repeat(64)}` } : {}),
    dockerfileSha256: "b".repeat(64),
    contextSha256: "c".repeat(64),
    platform: "linux" as const,
    arch: "x64",
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function sandboxResult(
  preview: SandboxSetupPreview,
): Promise<SandboxSetupResult> {
  const content = {
    kind: "napier.sandbox-runtime-setup-result" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    action: "built" as const,
    status: "ready" as const,
    imageReference: preview.imageReference,
    imageId: `sha256:${"a".repeat(64)}`,
    dockerfileSha256: preview.dockerfileSha256,
    contextSha256: preview.contextSha256,
    identitySha256: "d".repeat(64),
    installationSha256: "e".repeat(64),
    checks: {
      node: "sandbox_process_ready",
      shell: "shell_ready",
      python: "python_ready",
      git: "git_ready",
      lsp: "lsp_ready",
      dap: "dap_ready",
      service: "service_ready",
    },
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

function stableResponse(value: { contentSha256: string }): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Napier-Content-SHA256": value.contentSha256,
      "X-Napier-Content-SHA256-Mode": "stable",
    },
  });
}

function installDom() {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Event", window.Event);
  return {
    window,
    container: document.querySelector("#app") as HTMLElement,
  };
}

function findElementByText<T extends Element>(
  root: Node,
  text: string,
): T | null {
  for (const child of Array.from(root.childNodes)) {
    if (
      "textContent" in child &&
      child.textContent?.trim() === text &&
      "localName" in child
    ) {
      return child as T;
    }
    const nested = findElementByText<T>(child, text);
    if (nested) return nested;
  }
  return null;
}

async function waitFor(check: () => boolean | undefined): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
