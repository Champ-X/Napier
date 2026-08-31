import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SandboxSetupPreview } from "@napier/contracts/sandbox-setup";

let container: HTMLElement | undefined;
let root: Root | undefined;

describe("environment setup Chinese UI", () => {
  afterEach(async () => {
    root?.unmount();
    await flush();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
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
});

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
