import { describe, expect, it } from "vitest";

import {
  createKernelServiceKey,
  KernelServiceRegistry,
} from "../src/kernel-service-registry.js";

describe("Kernel service registry", () => {
  it("resolves typed dependencies once and disposes in reverse order", async () => {
    const registry = new KernelServiceRegistry();
    const alpha = createKernelServiceKey<{ value: number }>("service.alpha");
    const beta = createKernelServiceKey<{ value: number }>("service.beta");
    const lifecycle: string[] = [];
    registry.register({
      key: alpha,
      create: () => {
        lifecycle.push("create:alpha");
        return { value: 2 };
      },
      dispose: () => lifecycle.push("dispose:alpha"),
    });
    registry.register({
      key: beta,
      dependencies: [alpha],
      create: (services) => {
        lifecycle.push("create:beta");
        return { value: services.require(alpha).value * 3 };
      },
      dispose: () => lifecycle.push("dispose:beta"),
    });

    await expect(registry.resolve(beta)).resolves.toEqual({ value: 6 });
    await expect(registry.resolve(beta)).resolves.toEqual({ value: 6 });
    expect(registry.inspect()).toEqual([
      {
        id: "service.alpha",
        owner: "kernel",
        state: "resolved",
        dependencies: [],
      },
      {
        id: "service.beta",
        owner: "kernel",
        state: "resolved",
        dependencies: ["service.alpha"],
      },
    ]);

    await registry.shutdown();
    await registry.shutdown();
    expect(lifecycle).toEqual([
      "create:alpha",
      "create:beta",
      "dispose:beta",
      "dispose:alpha",
    ]);
    expect(() => registry.require(alpha)).toThrow("registry is closed");
  });

  it("fails closed on dependency cycles", async () => {
    const registry = new KernelServiceRegistry();
    const left = createKernelServiceKey<string>("service.left");
    const right = createKernelServiceKey<string>("service.right");
    registry.register({
      key: left,
      dependencies: [right],
      create: () => "left",
    });
    registry.register({
      key: right,
      dependencies: [left],
      create: () => "right",
    });

    await expect(registry.resolve(left)).rejects.toThrow(
      "service.left -> service.right -> service.left",
    );
  });

  it("removes owner-scoped services without residue", async () => {
    const registry = new KernelServiceRegistry();
    const plugin = registry.scope("plugin.fixture");
    const key = createKernelServiceKey<string>("plugin.fixture.service");
    const disposed: string[] = [];
    plugin.register({
      key,
      create: () => "ready",
      dispose: (value) => disposed.push(value),
    });

    await expect(registry.resolve(key)).resolves.toBe("ready");
    await plugin.dispose();
    await plugin.dispose();
    expect(disposed).toEqual(["ready"]);
    expect(registry.inspect()).toEqual([]);
    await expect(registry.resolve(key)).rejects.toThrow("not registered");
  });
});
