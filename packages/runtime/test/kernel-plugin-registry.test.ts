import { describe, expect, it } from "vitest";

import { KernelHookRegistry } from "../src/kernel-hooks.js";
import { createKernelPluginManifest } from "../src/kernel-plugin-manifest.js";
import { KernelPluginRegistry } from "../src/kernel-plugin-registry.js";
import {
  createKernelServiceKey,
  KernelServiceRegistry,
} from "../src/kernel-service-registry.js";

describe("Kernel plugin registry", () => {
  it("installs, enables, inspects, disables, and uninstalls without residue", async () => {
    const services = new KernelServiceRegistry();
    const hooks = new KernelHookRegistry();
    const registry = new KernelPluginRegistry((owner) => {
      const serviceScope = services.scope(owner);
      const hookScope = hooks.scope(owner);
      return {
        register: (registration) => serviceScope.register(registration),
        on: (name, handler) => hookScope.on(name, handler),
        resolve: () => serviceScope.resolve(),
        async dispose() {
          hookScope.dispose();
          await serviceScope.dispose();
        },
      };
    });
    const key = createKernelServiceKey<string>("plugin.fixture.service");
    let disposed = false;
    registry.install({
      manifest: manifest("plugin.fixture", "1.0.0", {
        tools: ["fixture.read"],
      }),
      setup(scope) {
        scope.register({
          key,
          create: () => "ready",
          dispose: () => {
            disposed = true;
          },
        });
        scope.on("tool.request", () => undefined);
      },
    });

    expect(registry.inspect()).toEqual([
      expect.objectContaining({
        id: "plugin.fixture",
        status: "disabled",
        capabilities: ["tool"],
        permissions: ["workspace.read"],
        hostEntry: "@napier/plugin-fixture/host",
      }),
    ]);
    await registry.enable("plugin.fixture");
    await expect(services.resolve(key)).resolves.toBe("ready");
    expect(registry.inspect()[0]?.status).toBe("enabled");
    expect(services.inspect()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: "plugin.fixture" }),
      ]),
    );
    expect(hooks.inspect()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owners: ["plugin.fixture"] }),
      ]),
    );

    await registry.disable("plugin.fixture");
    expect(disposed).toBe(true);
    expect(services.inspect()).toEqual([]);
    expect(hooks.inspect()).toEqual([]);
    expect(registry.inspect()[0]?.status).toBe("disabled");
    await registry.uninstall("plugin.fixture");
    expect(registry.inspect()).toEqual([]);
  });

  it("gates dependency status/version and unload order", async () => {
    const disposed: string[] = [];
    const scopes = new Map<string, { dispose(): Promise<void> }>();
    const registry = new KernelPluginRegistry((owner) => {
      const scope = {
        register: () => undefined,
        on: () => () => undefined,
        resolve: async () => undefined,
        async dispose() {
          disposed.push(owner);
        },
      };
      scopes.set(owner, scope);
      return scope;
    });
    registry.install({
      manifest: manifest("plugin.foundation", "1.2.0"),
      setup: () => undefined,
    });
    registry.install({
      manifest: manifest("plugin.feature", "2.0.0", {}, [
        { id: "plugin.foundation", versionRange: "^1.0.0" },
      ]),
      setup: () => undefined,
    });
    await expect(registry.enable("plugin.feature")).rejects.toThrow(
      "not enabled",
    );
    await registry.enable("plugin.foundation");
    await registry.enable("plugin.feature");
    await expect(registry.disable("plugin.foundation")).rejects.toThrow(
      "required by enabled",
    );
    await registry.shutdown();
    expect(disposed).toEqual(["plugin.feature", "plugin.foundation"]);
    expect(() =>
      registry.install({
        manifest: manifest("plugin.closed", "1.0.0"),
        setup: () => undefined,
      }),
    ).toThrow("closed");
  });

  it("rolls back partial setup and rejects incompatible dependencies", async () => {
    const disposed: string[] = [];
    const registry = new KernelPluginRegistry((owner) => ({
      register: () => undefined,
      on: () => () => undefined,
      resolve: async () => undefined,
      async dispose() {
        disposed.push(owner);
      },
    }));
    registry.install({
      manifest: manifest("plugin.foundation", "0.2.0"),
      setup: () => undefined,
    });
    registry.install({
      manifest: manifest("plugin.feature", "1.0.0", {}, [
        { id: "plugin.foundation", versionRange: "^0.1.0" },
      ]),
      setup: () => undefined,
    });
    await registry.enable("plugin.foundation");
    await expect(registry.enable("plugin.feature")).rejects.toThrow(
      "version is incompatible",
    );
    registry.install({
      manifest: manifest("plugin.failing", "1.0.0"),
      setup: () => {
        throw new Error("setup failed");
      },
    });
    await expect(registry.enable("plugin.failing")).rejects.toThrow(
      "setup failed",
    );
    expect(disposed).toContain("plugin.failing");
    expect(
      registry.inspect().find((item) => item.id === "plugin.failing"),
    ).toEqual(expect.objectContaining({ status: "disabled" }));
  });
});

function manifest(
  id: string,
  version: string,
  contributions: Partial<{
    tools: string[];
    projections: string[];
  }> = {},
  dependencies: Array<{ id: string; versionRange: string }> = [],
) {
  const tools = contributions.tools ?? [];
  const projections = contributions.projections ?? [];
  return createKernelPluginManifest({
    id,
    version,
    displayName: id,
    description: `First-party ${id} test plugin.`,
    trust: "first_party",
    dependencies,
    capabilities: [
      ...(projections.length ? ["projection" as const] : []),
      ...(tools.length ? ["tool" as const] : []),
    ],
    permissions: tools.length ? ["workspace.read"] : [],
    entries: {
      host: {
        package: "@napier/plugin-fixture",
        export: "./host",
      },
    },
    contributions: {
      tools,
      providers: [],
      prompts: [],
      projections,
      uiSlots: [],
    },
  });
}
