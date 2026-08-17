import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BrowserWorkspacePreview } from "../src/browser-workspace-preview.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser workspace preview", () => {
  it("serves one HTML directory with bounded static resources", async () => {
    const root = path.join(
      tmpdir(),
      `napier-preview-${Date.now().toString(36)}`,
    );
    roots.push(root);
    await mkdir(path.join(root, "site"), { recursive: true });
    await writeFile(
      path.join(root, "site", "index.html"),
      '<script src="./app.js"></script>',
    );
    await writeFile(path.join(root, "site", "app.js"), "window.ready=true;");

    const preview = await BrowserWorkspacePreview.create(
      root,
      "site/index.html",
    );
    const entry = route(`${preview.entryUrl}`);
    const script = route(new URL("./app.js", preview.entryUrl).href);

    await expect(preview.fulfill(entry.route)).resolves.toBe(true);
    await expect(preview.fulfill(script.route)).resolves.toBe(true);
    expect(entry.response()).toEqual(
      expect.objectContaining({
        status: 200,
        body: expect.any(Buffer),
        headers: expect.objectContaining({
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            expect.stringContaining("connect-src 'none'"),
        }),
      }),
    );
    expect(script.response()).toEqual(
      expect.objectContaining({
        status: 200,
        body: Buffer.from("window.ready=true;"),
        headers: expect.objectContaining({
          "Content-Type": "text/javascript; charset=utf-8",
        }),
      }),
    );
    expect(preview.evidence).toEqual(
      expect.objectContaining({
        entryPathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        entrySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects protected, escaped, symlinked, and non-HTML entries", async () => {
    const root = path.join(
      tmpdir(),
      `napier-preview-deny-${Date.now().toString(36)}`,
    );
    roots.push(root);
    await mkdir(path.join(root, "site"), { recursive: true });
    await mkdir(path.join(root, ".napier"), { recursive: true });
    await writeFile(path.join(root, "site", "index.html"), "<h1>safe</h1>");
    await writeFile(path.join(root, "site", "notes.txt"), "not html");
    await symlink(
      path.join(root, "site", "index.html"),
      path.join(root, "site", "linked.html"),
    );

    await expect(
      BrowserWorkspacePreview.create(root, "../outside.html"),
    ).rejects.toThrow("safe scope");
    await expect(
      BrowserWorkspacePreview.create(root, ".napier/index.html"),
    ).rejects.toThrow("safe scope");
    await expect(
      BrowserWorkspacePreview.create(root, "site/linked.html"),
    ).rejects.toThrow("symbolic links");
    await expect(
      BrowserWorkspacePreview.create(root, "site/notes.txt"),
    ).rejects.toThrow("HTML");
  });
});

function route(url: string) {
  let response:
    | {
        status: number;
        body: Buffer;
        headers: Record<string, string>;
      }
    | undefined;
  return {
    route: {
      request: () => ({ url: () => url }),
      fulfill: async (value: {
        status: number;
        body: Buffer;
        headers: Record<string, string>;
      }) => {
        response = value;
      },
    } as never,
    response: () => response,
  };
}
