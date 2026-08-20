import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isolatedProductionServerEnvironment } from "./production-server-test-environment.mjs";

const SOURCE_ROOTS = ["scripts", "apps", "packages"].map((root) =>
  path.resolve(root),
);
const PRODUCTION_SERVER_ENTRY = /apps\/server\/dist\/index\.js/u;
const PROCESS_LAUNCH_CALL = /\b(?:spawn|fork|execFile)\s*\(/u;

describe("production Server state isolation", () => {
  it("keeps state paths inside the owned test root", () => {
    const root = path.resolve("/tmp/napier-production-server-contract");
    const environment = isolatedProductionServerEnvironment(root, {
      NAPIER_STATE_HOME: "/should-not-win",
    });

    expect(environment).toMatchObject({
      NAPIER_HOME: path.join(root, "state"),
      NAPIER_STATE_HOME: path.join(root, "state"),
      NAPIER_WORKSPACE: path.join(root, "workspace"),
      TMPDIR: path.join(root, "tmp"),
    });
  });

  it("keeps every production Server test launcher out of user state", async () => {
    const files = (await Promise.all(SOURCE_ROOTS.map(sourceFiles)))
      .flat()
      .sort((left, right) => left.name.localeCompare(right.name));
    const sources = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        source: await readFile(file.absolute, "utf8"),
      })),
    );
    const launchers = sources.filter(
      ({ source }) =>
        PRODUCTION_SERVER_ENTRY.test(source) &&
        PROCESS_LAUNCH_CALL.test(source),
    );

    expect(launchers.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "scripts/sdk-capability-production-server-harness.mjs",
        "scripts/web-ui-e2e-runtime.mjs",
      ]),
    );
    for (const { name, source } of launchers) {
      expect(source, `${name} must isolate recent-workspaces.json`).toMatch(
        /isolatedProductionServerEnvironment\s*\(/u,
      );
    }
  });
});

async function sourceFiles(root) {
  const names = await readdir(root, { recursive: true });
  return names
    .filter((name) => /\.(?:[cm]?[jt]s|tsx)$/u.test(name))
    .filter((name) => {
      const segments = name.split(path.sep);
      return !segments.includes("dist") && !segments.includes("node_modules");
    })
    .map((name) => {
      const absolute = path.join(root, name);
      return {
        absolute,
        name: path.relative(process.cwd(), absolute).split(path.sep).join("/"),
      };
    });
}
