import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertBrowserUploadCurrent,
  inspectBrowserUpload,
  MAX_BROWSER_DOWNLOAD_BYTES,
  prepareBrowserUpload,
  writeBrowserDownload,
  writeBrowserScreenshot,
} from "../src/browser-workspace-files.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("browser workspace files", () => {
  it("binds uploads to a bounded canonical workspace file", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "input.txt"), "upload body");

    const inspected = await inspectBrowserUpload(workspace, "input.txt");
    expect(inspected).toEqual(
      expect.objectContaining({
        path: "input.txt",
        fileBytes: 11,
      }),
    );
    await expect(
      assertBrowserUploadCurrent(inspected),
    ).resolves.toBeUndefined();

    await writeFile(path.join(workspace, "input.txt"), "changed");
    await expect(assertBrowserUploadCurrent(inspected)).rejects.toThrow(
      "changed during execution",
    );
  });

  it("prepares exact upload bytes independently from later workspace drift", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "input.json"), '{"approved":true}\n');

    const prepared = await prepareBrowserUpload(workspace, "input.json");
    await writeFile(path.join(workspace, "input.json"), '{"approved":false}\n');

    expect(prepared).toEqual(
      expect.objectContaining({
        path: "input.json",
        name: "input.json",
        mimeType: "application/json",
        fileBytes: 18,
      }),
    );
    expect(prepared.buffer.toString("utf8")).toBe('{"approved":true}\n');
    await expect(assertBrowserUploadCurrent(prepared)).rejects.toThrow(
      "changed during execution",
    );
  });

  it("rejects upload escapes, protected paths, and symlinks", async () => {
    const workspace = await createWorkspace();
    const outside = path.join(path.dirname(workspace), "outside.txt");
    await writeFile(outside, "outside");
    await symlink(outside, path.join(workspace, "linked.txt"));

    await expect(
      inspectBrowserUpload(workspace, "../outside.txt"),
    ).rejects.toThrow("escapes");
    await expect(
      inspectBrowserUpload(workspace, ".git/config"),
    ).rejects.toThrow("protected");
    await expect(inspectBrowserUpload(workspace, "linked.txt")).rejects.toThrow(
      "regular file",
    );
  });

  it("streams downloads into a new file and refuses overwrite or symlink parents", async () => {
    const workspace = await createWorkspace();
    await mkdir(path.join(workspace, "downloads"));

    const result = await writeBrowserDownload(
      workspace,
      "downloads/result.txt",
      Readable.from(["download ", "body"]),
    );
    expect(result).toEqual(
      expect.objectContaining({
        path: path.join("downloads", "result.txt"),
        fileBytes: 13,
      }),
    );
    await expect(
      readFile(path.join(workspace, "downloads/result.txt"), "utf8"),
    ).resolves.toBe("download body");
    await expect(
      writeBrowserDownload(
        workspace,
        "downloads/result.txt",
        Readable.from(["replacement"]),
      ),
    ).rejects.toThrow("already exists");

    const outside = path.join(path.dirname(workspace), "outside-directory");
    await mkdir(outside);
    await symlink(outside, path.join(workspace, "linked-directory"));
    await expect(
      writeBrowserDownload(
        workspace,
        "linked-directory/escape.txt",
        Readable.from(["escape"]),
      ),
    ).rejects.toThrow("symlink");
  });

  it("removes partial downloads after cancellation or size overflow", async () => {
    const workspace = await createWorkspace();
    const controller = new AbortController();
    async function* cancelled() {
      yield Buffer.from("partial");
      controller.abort();
      yield Buffer.from("unreachable");
    }
    await expect(
      writeBrowserDownload(
        workspace,
        "cancelled.bin",
        Readable.from(cancelled()),
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
    await expect(
      readFile(path.join(workspace, "cancelled.bin")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    async function* oversized() {
      const chunk = Buffer.alloc(1024 * 1024);
      for (
        let bytes = 0;
        bytes <= MAX_BROWSER_DOWNLOAD_BYTES;
        bytes += chunk.byteLength
      ) {
        yield chunk;
      }
    }
    await expect(
      writeBrowserDownload(
        workspace,
        "oversized.bin",
        Readable.from(oversized()),
      ),
    ).rejects.toThrow("up to");
    await expect(
      readFile(path.join(workspace, "oversized.bin")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes screenshots only to new PNG files inside safe parents", async () => {
    const workspace = await createWorkspace();
    await mkdir(path.join(workspace, "artifacts"));
    const screenshot = Buffer.from("PNG_SCREENSHOT_BYTES");

    const saved = await writeBrowserScreenshot(
      workspace,
      "artifacts/page.png",
      screenshot,
    );

    expect(saved).toEqual(
      expect.objectContaining({
        path: path.join("artifacts", "page.png"),
        fileBytes: screenshot.byteLength,
      }),
    );
    await expect(
      readFile(path.join(workspace, "artifacts/page.png")),
    ).resolves.toEqual(screenshot);
    await expect(
      writeBrowserScreenshot(workspace, "artifacts/page.png", screenshot),
    ).rejects.toThrow("already exists");
    await expect(
      writeBrowserScreenshot(workspace, "artifacts/page.jpg", screenshot),
    ).rejects.toThrow("end in .png");
    await expect(
      writeBrowserScreenshot(workspace, "../page.png", screenshot),
    ).rejects.toThrow("escapes");
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-files-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  return workspace;
}
