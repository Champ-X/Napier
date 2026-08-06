import { writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareBrowserUpload } from "../src/browser-workspace-files.js";
import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness,
} from "./browser-session-harness.js";

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
});

describe("prepared Browser upload Session", () => {
  it("uploads exact prepared bytes after the workspace path changes", async () => {
    const harness = await createBrowserSessionHarness();
    const target = path.join(harness.workspace, "upload.json");
    await writeFile(target, '{"approved":true}\n');
    const prepared = await prepareBrowserUpload(
      harness.workspace,
      "upload.json",
    );
    await writeFile(target, '{"approved":false}\n');
    const owner = {
      threadId: "thread_prepared_upload",
      runId: "run_prepared_upload",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });

    const upload = await harness.manager.executePreparedUpload(
      owner,
      {
        action: "upload",
        target: { selector: "#upload" },
        path: "upload.json",
      },
      prepared,
    );

    expect(upload.details.file).toEqual({
      pathSha256: prepared.pathSha256,
      fileSha256: prepared.fileSha256,
      fileBytes: prepared.fileBytes,
    });
    expect(harness.pages[0]?.uploaded).toEqual([
      {
        selector: "#upload",
        name: "upload.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"approved":true}\n'),
      },
    ]);
    expect(prepared.buffer).toEqual(Buffer.alloc(prepared.fileBytes));
    await harness.manager.cancelRun(owner);
  });

  it("rejects tampered prepared bytes before Browser execution", async () => {
    const harness = await createBrowserSessionHarness();
    await writeFile(path.join(harness.workspace, "upload.txt"), "approved");
    const prepared = await prepareBrowserUpload(
      harness.workspace,
      "upload.txt",
    );
    prepared.buffer[0] = "X".charCodeAt(0);

    await expect(
      harness.manager.executePreparedUpload(
        { threadId: "thread_tampered", runId: "run_tampered" },
        {
          action: "upload",
          target: { selector: "#upload" },
          path: "upload.txt",
        },
        prepared,
      ),
    ).rejects.toThrow("prepared upload is invalid");
    expect(harness.browsers).toEqual([]);
  });
});
