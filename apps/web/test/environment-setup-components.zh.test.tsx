import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SandboxSetupPreview } from "@napier/contracts/sandbox-setup";
import type { ProviderSetupPreview } from "@napier/contracts/provider-setup";

vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <svg {...props} />;
  return { Check: Icon, KeyRound: Icon, RefreshCw: Icon, ShieldCheck: Icon };
});

let container: HTMLElement | undefined;
let root: Root | undefined;

describe("environment setup Chinese UI", () => {
  afterEach(async () => {
    root?.unmount();
    await flush();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("localizes provider and Sandbox readiness without translating identifiers", async () => {
    container = installChineseDom();
    const { providerSetupStatusCopy } =
      await import("../src/provider-setup-view-model");
    const { sandboxSetupCopy } =
      await import("../src/sandbox-setup-view-model");
    const { SandboxSetupLedger } = await import("../src/SandboxSetupLedger");
    const preview = sandboxPreview();
    const status = sandboxSetupCopy(preview);

    root = createRoot(container);
    root.render(
      <SandboxSetupLedger
        preview={preview}
        ready={false}
        statusTitle={status.title}
        statusDetail={status.detail}
      />,
    );
    await flush();

    expect(providerSetupStatusCopy("available")).toEqual(
      expect.objectContaining({ label: "已找到" }),
    );
    expect(container.textContent).toContain("状态");
    expect(container.textContent).toContain("需要构建");
    expect(container.textContent).toContain("固定源码");
    expect(container.textContent).toContain("工具链");
    expect(container.textContent).toContain("napier-sandbox:0.1.0");
    expect(container.textContent).not.toContain("Build required");
  });

  it("lets users recheck missing server credentials and enable a newly detected provider", async () => {
    container = installChineseDom();
    const api = await import("../src/provider-setup-api");
    const preview = providerPreview();
    const load = vi
      .spyOn(api, "getProviderSetupPreview")
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({
        ...preview,
        availableCount: 1,
        candidates: preview.candidates.map((candidate) => ({
          ...candidate,
          status: "available",
        })),
      });
    const apply = vi.spyOn(api, "applyProviderSetup");
    const { ProviderSetupCard } = await import("../src/ProviderSetupCard");
    root = createRoot(container);
    root.render(
      <ProviderSetupCard threadId={undefined} onBootstrapUpdated={vi.fn()} />,
    );
    await vi.waitFor(() => {
      expect(container?.textContent).toContain("当前服务尚未检测到 API Key");
    });
    expect(container.textContent).toContain("开发模式会自动重载");
    expect(container.textContent).not.toContain("b".repeat(12));
    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "重新检查",
    );
    expect(refresh?.disabled).toBe(false);
    refresh?.dispatchEvent(new window.Event("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(container?.textContent).toContain("启用 DeepSeek");
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("当前服务尚未检测到 API Key");
  });
});

function providerPreview(): ProviderSetupPreview {
  return {
    kind: "napier.provider-setup-preview",
    schemaVersion: 1,
    candidates: [
      {
        providerId: "deepseek",
        providerName: "DeepSeek",
        environmentVariable: "DEEPSEEK_API_KEY",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        status: "missing",
      },
    ],
    candidateCount: 1,
    readyCount: 0,
    availableCount: 0,
    candidateSetSha256: "a".repeat(64),
    contentSha256: "b".repeat(64),
  };
}

function installChineseDom(): HTMLElement {
  vi.resetModules();
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => "zh" },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  return document.getElementById("app") as unknown as HTMLElement;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function sandboxPreview(): SandboxSetupPreview {
  return {
    kind: "napier.sandbox-runtime-setup-preview",
    schemaVersion: 1,
    component: "sandbox",
    status: "buildable",
    acquisition: "packaged_source",
    active: false,
    imageReference: "napier-sandbox:0.1.0",
    dockerfileSha256: "a".repeat(64),
    contextSha256: "b".repeat(64),
    platform: "linux",
    arch: "x64",
    contentSha256: "c".repeat(64),
  };
}
