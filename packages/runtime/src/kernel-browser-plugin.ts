import type { BrowserSessionPort } from "./browser-session-port.js";
import type { RunBrowserSessionManager } from "./browser-session.js";
import { createKernelPluginManifest } from "./kernel-plugin-manifest.js";
import type { KernelPluginDefinition } from "./kernel-plugin-registry.js";
import { createKernelServiceKey } from "./kernel-service-registry.js";

export const BROWSER_KERNEL_PLUGIN_ID = "plugin.browser";
export const BROWSER_KERNEL_PLUGIN_VERSION = "1.0.0";
export const KERNEL_BROWSER_SESSIONS =
  createKernelServiceKey<BrowserSessionPort>("runtime.browser-session");

export class DynamicBrowserSessionPort implements BrowserSessionPort {
  private manager: BrowserSessionPort | undefined;

  available(): boolean {
    return this.manager !== undefined;
  }

  attach(manager: BrowserSessionPort): void {
    if (this.manager) {
      throw new Error("Browser plugin Session manager is already attached");
    }
    this.manager = manager;
  }

  detach(manager: BrowserSessionPort): void {
    if (this.manager === manager) this.manager = undefined;
  }

  hasActiveSession(
    ...input: Parameters<BrowserSessionPort["hasActiveSession"]>
  ) {
    return this.manager?.hasActiveSession(...input) ?? false;
  }

  hasWorkspacePreview(owner: { threadId: string; runId: string }): boolean {
    return this.manager?.hasWorkspacePreview?.(owner) ?? false;
  }

  capturePage(...input: Parameters<BrowserSessionPort["capturePage"]>) {
    return this.require().capturePage(...input);
  }

  captureLiveView(...input: Parameters<BrowserSessionPort["captureLiveView"]>) {
    return this.require().captureLiveView(...input);
  }

  captureTakeoverSnapshot(
    ...input: Parameters<BrowserSessionPort["captureTakeoverSnapshot"]>
  ) {
    return this.require().captureTakeoverSnapshot(...input);
  }

  executeTakeoverAction(
    ...input: Parameters<BrowserSessionPort["executeTakeoverAction"]>
  ) {
    return this.require().executeTakeoverAction(...input);
  }

  execute(...input: Parameters<BrowserSessionPort["execute"]>) {
    return this.require().execute(...input);
  }

  executeConfirmedUpload(
    ...input: Parameters<BrowserSessionPort["executeConfirmedUpload"]>
  ) {
    return this.require().executeConfirmedUpload(...input);
  }

  executeConfirmedAction(
    ...input: Parameters<BrowserSessionPort["executeConfirmedAction"]>
  ) {
    return this.require().executeConfirmedAction(...input);
  }

  captureConfirmationPageState(
    ...input: Parameters<BrowserSessionPort["captureConfirmationPageState"]>
  ) {
    return this.require().captureConfirmationPageState(...input);
  }

  cancelRun(...input: Parameters<BrowserSessionPort["cancelRun"]>) {
    return this.manager?.cancelRun(...input) ?? Promise.resolve();
  }

  private require(): BrowserSessionPort {
    if (!this.manager) throw new Error("Browser plugin is disabled");
    return this.manager;
  }
}

export function createBrowserKernelPlugin(input: {
  slot: DynamicBrowserSessionPort;
  manager:
    | RunBrowserSessionManager
    | (BrowserSessionPort & {
        shutdown?(): Promise<void>;
      });
}): KernelPluginDefinition {
  return {
    manifest: createKernelPluginManifest({
      id: BROWSER_KERNEL_PLUGIN_ID,
      version: BROWSER_KERNEL_PLUGIN_VERSION,
      displayName: "Browser",
      description:
        "Provides isolated Run-owned Browser Sessions, confirmation, takeover, and rendered-source capture.",
      trust: "first_party",
      dependencies: [],
      capabilities: ["tool", "ui_slot"],
      permissions: [
        "browser.control",
        "network.public",
        "workspace.read",
        "workspace.write",
      ],
      entries: {
        host: {
          package: "@napier/runtime",
          export: "./kernel-browser-plugin",
        },
        client: {
          package: "@napier/web",
          export: "./kernel-browser-inspector-slot",
        },
      },
      contributions: {
        tools: ["browser"],
        providers: [],
        prompts: [],
        projections: [],
        uiSlots: ["inspector.panel"],
      },
    }),
    setup(scope) {
      scope.register({
        key: KERNEL_BROWSER_SESSIONS,
        create: () => {
          input.slot.attach(input.manager);
          return input.manager;
        },
        async dispose() {
          await input.manager.shutdown?.();
          input.slot.detach(input.manager);
        },
      });
    },
  };
}
