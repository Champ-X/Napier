import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SandboxSetupPreview,
  SandboxSetupResult,
  SandboxUninstallPreview,
  SandboxUninstallResult,
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

  it("renders a signed release docket and applies the immutable pull preview", async () => {
    const { container } = installDom();
    const preview = await sandboxPreview("pullable");
    const result = await sandboxResult(preview, "pulled");
    const ready = {
      ...preview,
      status: "ready" as const,
      active: true,
      imageId: `sha256:${"a".repeat(64)}`,
    };
    ready.contentSha256 = await sha256Text(
      canonicalJson(
        Object.fromEntries(
          Object.entries(ready).filter(([key]) => key !== "contentSha256"),
        ),
      ),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stableResponse(preview))
      .mockResolvedValueOnce(stableResponse(result))
      .mockResolvedValueOnce(stableResponse(ready));
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(container);
    roots.push(root);

    root.render(<SandboxSetupCard />);
    await waitFor(() => container.textContent?.includes("Install & activate"));
    expect(container.textContent).toContain("SIGNED RELEASE");
    expect(container.textContent).toContain(
      preview.releaseDigest!.slice(0, 19),
    );

    findElementByText<HTMLButtonElement>(
      container,
      "Install & activate",
    )!.click();
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
  });

  it("requires an exact removal review and retains the shared image", async () => {
    const { container, window } = installDom();
    const ready = await sandboxPreview("ready");
    const removal = await sandboxUninstallPreview();
    const result = await sandboxUninstallResult(removal);
    const inactive = { ...ready, active: false };
    inactive.contentSha256 = await sha256Text(
      canonicalJson(
        Object.fromEntries(
          Object.entries(inactive).filter(([key]) => key !== "contentSha256"),
        ),
      ),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stableResponse(ready))
      .mockResolvedValueOnce(stableResponse(removal))
      .mockResolvedValueOnce(stableResponse(result))
      .mockResolvedValueOnce(stableResponse(inactive));
    vi.stubGlobal("fetch", fetchMock);
    let readinessEvents = 0;
    window.addEventListener(SANDBOX_READY_EVENT, () => {
      readinessEvents += 1;
    });
    const root = createRoot(container);
    roots.push(root);
    root.render(<SandboxSetupCard />);
    await waitFor(() => container.textContent?.includes("Review removal"));

    findElementByText<HTMLButtonElement>(container, "Review removal")!.click();
    await waitFor(() => container.textContent?.includes("Remove binding"));
    expect(container.textContent).toContain("image retained locally");
    expect(container.textContent).toContain("macos-sandbox-exec");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    findElementByText<HTMLButtonElement>(container, "Remove binding")!.click();
    await waitFor(() =>
      container.textContent?.includes("Enable coding runtime"),
    );
    expect(fetchMock.mock.calls[2]).toEqual([
      "/api/setup/sandbox/uninstall",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedPreviewSha256: removal.contentSha256,
        }),
      }),
    ]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("docker rmi");
    expect(readinessEvents).toBe(1);
  });

  it("automatically reviews an invalid binding before offering ordinary setup", async () => {
    const { container } = installDom();
    const ready = await sandboxPreview("ready");
    const removal = await sandboxUninstallPreview("invalid");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stableResponse(ready))
      .mockResolvedValueOnce(stableResponse(removal));
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(container);
    roots.push(root);

    root.render(<SandboxSetupCard reviewInvalidBinding />);
    await waitFor(() => container.textContent?.includes("Remove binding"));

    expect(container.textContent).toContain("Remove Napier binding?");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/setup/sandbox",
      "/api/setup/sandbox/uninstall",
    ]);
    expect(
      findElementByText<HTMLButtonElement>(container, "Verify & activate"),
    ).toBeNull();
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
    acquisition:
      status === "pullable"
        ? ("external_release" as const)
        : ("packaged_source" as const),
    active: status === "ready",
    imageReference:
      status === "pullable"
        ? `ghcr.io/champ-x/napier-sandbox@sha256:${"f".repeat(64)}`
        : "napier-sandbox:0.1.0",
    ...(status === "pullable"
      ? {
          releaseReference: `ghcr.io/champ-x/napier-sandbox@sha256:${"f".repeat(64)}`,
          releaseDigest: `sha256:${"f".repeat(64)}`,
          releaseSourceSha: "e".repeat(40),
          releaseReceiptSha256: "d".repeat(64),
        }
      : {}),
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
  action: SandboxSetupResult["action"] = "built",
): Promise<SandboxSetupResult> {
  const content = {
    kind: "napier.sandbox-runtime-setup-result" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    action,
    acquisition: preview.acquisition,
    status: "ready" as const,
    imageReference: preview.imageReference,
    imageId: `sha256:${"a".repeat(64)}`,
    dockerfileSha256: preview.dockerfileSha256,
    contextSha256: preview.contextSha256,
    identitySha256: "d".repeat(64),
    installationSha256: "e".repeat(64),
    checks: {
      node: "sandbox_process_ready",
      resources: "sandbox_resources_ready",
      verification: "verification_ready",
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

async function sandboxUninstallPreview(
  status: SandboxUninstallPreview["status"] = "installed",
): Promise<SandboxUninstallPreview> {
  const content = {
    kind: "napier.sandbox-runtime-uninstall-preview" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    status,
    active: status === "installed",
    imageRetained: true as const,
    bindingSha256: "f".repeat(64),
    imageReference: "napier-sandbox:0.1.0",
    imageId: `sha256:${"a".repeat(64)}`,
    identitySha256: "d".repeat(64),
    installationSha256: "e".repeat(64),
    fallbackSandbox: "macos-sandbox-exec",
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function sandboxUninstallResult(
  preview: SandboxUninstallPreview,
): Promise<SandboxUninstallResult> {
  const content = {
    kind: "napier.sandbox-runtime-uninstall-result" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    action: "uninstalled" as const,
    status: "removed" as const,
    imageRetained: true as const,
    bindingSha256: preview.bindingSha256!,
    imageReference: preview.imageReference!,
    imageId: preview.imageId!,
    identitySha256: preview.identitySha256!,
    installationSha256: preview.installationSha256!,
    fallbackSandbox: preview.fallbackSandbox,
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
