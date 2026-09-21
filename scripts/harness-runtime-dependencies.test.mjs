import { test, expect } from "vitest";
import {
  mkdir,
  mkdtemp,
  writeFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  scanRuntimeDependencies as scan,
  dependencyGraphReceipt,
} from "./harness-runtime-dependencies.mjs";
const scanRuntimeDependencies = (root) => scan(root, { execArgv: [], env: {} });

async function packageAt(root, name, dependencies = {}) {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name, version: "1.0.0", dependencies }),
  );
  await writeFile(path.join(root, "index.js"), "export const value=1;");
}

test("follows external workspace packages, nested resolution and cycles, detecting dependency-only edits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-deps-"));
  try {
    const snapshot = path.join(root, "snapshot"),
      runtime = path.join(snapshot, "packages/runtime"),
      dependency = path.join(root, "old-snapshot/linked"),
      nested = path.join(dependency, "node_modules/leaf");
    await packageAt(runtime, "@napier/runtime", { linked: "*" });
    await packageAt(dependency, "linked", { leaf: "*" });
    await packageAt(nested, "leaf", { linked: "*" });
    await mkdir(path.join(snapshot, "node_modules"), { recursive: true });
    await symlink(dependency, path.join(snapshot, "node_modules/linked"));
    await mkdir(path.join(nested, "node_modules"));
    await symlink(dependency, path.join(nested, "node_modules/linked"));
    const before = await scanRuntimeDependencies(snapshot);
    expect(before.eligible).toBe(true);
    expect(before.packages).toHaveLength(3);
    expect(Object.values(before.locations)).toContain(
      await realpath(dependency),
    );
    expect(
      dependencyGraphReceipt(before, await scanRuntimeDependencies(snapshot))
        .eligible,
    ).toBe(true);
    await writeFile(path.join(dependency, "index.js"), "export const value=2;");
    const after = await scanRuntimeDependencies(snapshot);
    expect(dependencyGraphReceipt(before, after)).toMatchObject({
      stable: false,
      eligible: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not claim attribution for custom resolution or preload code", async () => {
  for (const execution of [
    { execArgv: ["--preserve-symlinks"], env: {} },
    { execArgv: [], env: { NODE_OPTIONS: "--import=/some/module.mjs" } },
    { execArgv: [], env: { NODE_PATH: "/alternate/modules" } },
  ])
    await expect(scan("/unused", execution)).rejects.toThrow("not inventoried");
});

test("records missing optional packages but rejects missing required dependencies and hidden external file links", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-deps-missing-"));
  try {
    const runtime = path.join(root, "packages/runtime");
    await packageAt(runtime, "@napier/runtime");
    await writeFile(
      path.join(runtime, "package.json"),
      JSON.stringify({
        name: "@napier/runtime",
        optionalDependencies: { optional: "*" },
        peerDependencies: { peer: "*" },
        peerDependenciesMeta: { peer: { optional: true } },
        devDependencies: { unused: "*" },
      }),
    );
    let graph = await scanRuntimeDependencies(root);
    expect(graph.eligible).toBe(true);
    expect(graph.packages[0].dependencies).toHaveLength(2);
    await writeFile(
      path.join(runtime, "package.json"),
      JSON.stringify({
        name: "@napier/runtime",
        dependencies: { missing: "*" },
      }),
    );
    graph = await scanRuntimeDependencies(root);
    expect(graph.eligible).toBe(false);
    expect(graph.blockers).toContain(
      "@napier/runtime: missing required package missing",
    );
    await writeFile(path.join(root, "outside.js"), "external");
    await symlink(
      path.join(root, "outside.js"),
      path.join(runtime, "linked.js"),
    );
    await expect(scanRuntimeDependencies(root)).rejects.toThrow(
      "external internal link",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
