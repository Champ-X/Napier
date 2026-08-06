import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BrowserUploadAuthorizationManager } from "../src/browser-upload-authorization.js";
import { MAX_PREPARED_BROWSER_UPLOADS } from "../src/browser-upload-authorization.js";
import { sha256 } from "../src/ed25519.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser upload authorization", () => {
  it("consumes one exact approved byte snapshot despite later file drift", async () => {
    const workspace = await createWorkspace();
    const manager = new BrowserUploadAuthorizationManager(workspace);
    const owner = { threadId: "thread_upload", runId: "run_upload" };
    const request = {
      action: "upload" as const,
      target: { ref: "e1" },
      path: "payload.txt",
    };
    await writeFile(path.join(workspace, request.path), "approved bytes");

    const candidate = await manager.prepare({
      owner,
      callId: "call_upload",
      request,
    });
    await writeFile(path.join(workspace, request.path), "changed bytes");
    manager.approve(candidate);

    const consumed = manager.consume({
      owner,
      callId: "call_upload",
      request,
    });
    expect(consumed.buffer.toString("utf8")).toBe("approved bytes");
    expect(consumed.fileSha256).toBe(sha256("approved bytes"));
    await expect(() =>
      manager.consume({ owner, callId: "call_upload", request }),
    ).toThrow("unavailable");
  });

  it("rejects call, Run, and argument substitution and clears cancelled Runs", async () => {
    const workspace = await createWorkspace();
    const manager = new BrowserUploadAuthorizationManager(workspace);
    const owner = { threadId: "thread_upload", runId: "run_upload" };
    const request = {
      action: "upload" as const,
      target: { ref: "e1" },
      path: "payload.txt",
    };
    await writeFile(path.join(workspace, request.path), "approved bytes");

    const substituted = await manager.prepare({
      owner,
      callId: "call_upload",
      request,
    });
    manager.approve(substituted);
    expect(() =>
      manager.consume({
        owner,
        callId: "call_upload",
        request: { ...request, target: { ref: "e2" } },
      }),
    ).toThrow("unavailable");
    expect(substituted.upload.buffer).toEqual(
      Buffer.alloc(substituted.upload.fileBytes),
    );

    const cancelled = await manager.prepare({
      owner,
      callId: "call_cancelled",
      request,
    });
    manager.approve(cancelled);
    manager.cancelRun(owner);
    expect(() =>
      manager.consume({ owner, callId: "call_cancelled", request }),
    ).toThrow("unavailable");
    expect(cancelled.upload.buffer).toEqual(
      Buffer.alloc(cancelled.upload.fileBytes),
    );
  });

  it("bounds prepared and approved upload memory globally", async () => {
    const workspace = await createWorkspace();
    const manager = new BrowserUploadAuthorizationManager(workspace);
    const owner = { threadId: "thread_limit", runId: "run_limit" };
    await writeFile(path.join(workspace, "payload.txt"), "bounded bytes");
    const request = {
      action: "upload" as const,
      target: { ref: "e1" },
      path: "payload.txt",
    };

    for (let index = 0; index < MAX_PREPARED_BROWSER_UPLOADS; index += 1) {
      const candidate = await manager.prepare({
        owner,
        callId: `call_limit_${String(index)}`,
        request,
      });
      if (index % 2 === 0) manager.approve(candidate);
    }
    await expect(
      manager.prepare({
        owner,
        callId: "call_over_limit",
        request,
      }),
    ).rejects.toThrow("limit reached");
    manager.cancelRun(owner);
    const afterCancel = await manager.prepare({
      owner,
      callId: "call_after_cancel",
      request,
    });
    expect(afterCancel).toEqual(
      expect.objectContaining({ callId: "call_after_cancel" }),
    );
    manager.cancelRun(owner);
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-upload-auth-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  return workspace;
}
