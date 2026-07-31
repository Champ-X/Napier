import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertBrowserRuntimeCurrent,
  resolveBrowserRuntime,
} from "../src/browser-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("browser runtime binding", () => {
  it("binds an allowlisted executable and rejects later identity drift", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-runtime-"));
    roots.push(root);
    const executable = path.join(root, "chrome");
    await writeFile(executable, "first executable");
    await chmod(executable, 0o755);

    const runtime = await resolveBrowserRuntime(executable);
    expect(runtime).toEqual(
      expect.objectContaining({
        executablePath: await realpath(executable),
        executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        identity: expect.objectContaining({
          size: 16,
        }),
      }),
    );
    await expect(assertBrowserRuntimeCurrent(runtime)).resolves.toBeUndefined();

    await writeFile(executable, "replacement executable");
    await expect(assertBrowserRuntimeCurrent(runtime)).rejects.toThrow(
      "changed before Session launch",
    );
  });

  it("rejects an executable outside the Chrome, Chromium, or Edge names", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-runtime-"));
    roots.push(root);
    const executable = path.join(root, "arbitrary-runner");
    await writeFile(executable, "not a browser");
    await chmod(executable, 0o755);

    await expect(resolveBrowserRuntime(executable)).rejects.toThrow(
      "No supported Chrome",
    );
  });
});
