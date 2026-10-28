import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorkspaceRuntimeCatalog } from "../src/workspace-runtime-catalog.js";
import { resolveWorkspaceRuntimeIdentity } from "../src/workspace-runtime-identity.js";
import { WorkspaceRuntimeRegistry } from "../src/workspace-runtime-registry.js";

export interface TestRuntime { name: string; busy: boolean }

export async function runtimeFixture(options: {
  maxResident?: number; maxIdle?: number; idleMs?: number;
  prepare?: (name: string) => Promise<TestRuntime>;
  dispose?: (runtime: TestRuntime) => Promise<void>;
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "napier-test-runtime-registry-"));
  const stateHome = path.join(directory, "state");
  const catalog = await WorkspaceRuntimeCatalog.open(stateHome);
  const identities = await Promise.all(["a", "b", "c"].map(async (name) => {
    const root = path.join(directory, name);
    await mkdir(root);
    return resolveWorkspaceRuntimeIdentity(root, path.join(directory, `${name}-data`));
  }));
  for (const identity of identities) catalog.register(identity);
  const [a, b, c] = identities;
  if (!a || !b || !c) throw new Error("Missing test identities");
  let now = 0;
  const prepared: string[] = [];
  const disposed: string[] = [];
  const registry = new WorkspaceRuntimeRegistry<TestRuntime>({
    catalog, now: () => now,
    maxResident: options.maxResident ?? 3,
    maxIdle: options.maxIdle ?? 1,
    idleMs: options.idleMs ?? 100,
    prepare: async (identity) => {
      const name = path.basename(identity.root);
      prepared.push(name);
      return options.prepare ? options.prepare(name) : { name, busy: false };
    },
    dispose: async (runtime) => {
      await options.dispose?.(runtime);
      disposed.push(runtime.name);
    },
    canDispose: (runtime) => !runtime.busy,
  });
  return {
    directory, stateHome, catalog, registry, a, b, c, prepared, disposed,
    advance: (ms: number) => { now += ms; },
    async cleanup() {
      try { await registry.shutdown(); }
      finally { catalog.close(); await rm(directory, { recursive: true, force: true }); }
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
