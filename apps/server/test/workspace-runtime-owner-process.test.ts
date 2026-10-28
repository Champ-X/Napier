import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runtimeFixture } from "./workspace-runtime-test-fixture.js";

describe("workspace runtime process ownership", () => {
  it("refuses a live owner, then reclaims after SIGKILL without losing custom identities", async () => {
    const f = await runtimeFixture();
    const child = fork(fileURLToPath(new URL("./workspace-runtime-owner-process-fixture.ts", import.meta.url)),
      [f.stateHome, f.a.workspaceId], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const exited = once(child, "exit");
    try {
      const message = await Promise.race([
        once(child, "message"),
        exited.then(() => { throw new Error(`Owner process exited early: ${stderr}`); }),
      ]);
      expect(message[0]).toEqual({ status: "owned", workspaceId: f.a.workspaceId });
      await expect(f.registry.acquire(f.a.workspaceId)).rejects.toThrow("live server");
      expect(f.prepared).toEqual([]);
      const b = await f.registry.acquire(f.b.workspaceId); b.release();
      child.kill("SIGKILL");
      expect((await exited)[1]).toBe("SIGKILL");
      const restored = await f.registry.acquire(f.a.workspaceId);
      expect(restored.identity).toEqual(f.a);
      restored.release();
      expect(f.catalog.get(f.a.workspaceId).dataRoot).toBe(f.a.dataRoot);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      await f.cleanup();
    }
  });
});
