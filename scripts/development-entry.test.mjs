import { execFile as execFileWithCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import rootPackage from "../package.json" with { type: "json" };

const execFile = promisify(execFileWithCallback);
const roots = [];
const concurrentlyPath = path.resolve(
  "node_modules/concurrently/dist/bin/concurrently.js",
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("development entry", () => {
  it("loads the optional repository environment before concurrently", () => {
    expect(rootPackage.scripts.dev).toBe(
      'npm run build:core && node --env-file-if-exists=.env node_modules/concurrently/dist/bin/concurrently.js -n contracts,runtime,server,web -c magenta,green,yellow,cyan "npm run dev -w @napier/contracts" "npm run dev -w @napier/runtime" "npm run dev -w @napier/server" "npm run dev -w @napier/web"',
    );
  });

  it("inherits env-file values in a concurrently child process", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-dev-entry-"));
    roots.push(root);
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "NAPIER_DEV_ENTRY_TEST=visible_to_child\n");
    const { stdout } = await execFile(
      process.execPath,
      [
        `--env-file=${envPath}`,
        concurrentlyPath,
        "--raw",
        "--success",
        "all",
        "node -p process.env.NAPIER_DEV_ENTRY_TEST",
      ],
      { cwd: root },
    );

    expect(stdout.trim()).toBe("visible_to_child");
  });
});
