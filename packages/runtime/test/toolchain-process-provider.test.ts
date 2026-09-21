import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { Value } from "typebox/value";
import { withToolchainProviders } from "../src/toolchain-provider.js";
import { createWorkspaceProcessTool } from "../src/workspace-process-tool.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { LocalStore } from "../src/store.js";
import { resolveCommandRuntimeBinding } from "../src/command-runtime.js";
import { createActiveTestRun } from "./active-run-test-fixture.js";
import { preserveAgentToolIdentity } from "../src/agent-tool-metadata.js";
import { workspaceToolchainEnvironment } from "../src/toolchain-process-options.js";

const liveIt = it.runIf(process.env.NAPIER_LIVE_TOOLCHAIN_SMOKE === "1");
const roots: string[] = [];
const exec = promisify(execFile);
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("extends only an admitted Process tool, retains original guards and bounds, and isolates policy scope", async () => {
  const original = createWorkspaceProcessTool(undefined as never, {
    threadId: "thread_test0000",
    runId: "run_test0000",
  });
  const guarded = preserveAgentToolIdentity(original, {
    ...original,
    execute: vi.fn(async () => {
      expect(workspaceToolchainEnvironment("python")).toEqual({
        toolchainEnvironment: "workspace",
      });
      throw new Error("original admission guard");
    }),
  });
  const options = {
    workspaceRoot: "/unused",
    sandbox: new HostDirectSandboxAdapter(),
  };
  const [tool] = withToolchainProviders([guarded], options);
  expect(withToolchainProviders([], options)).toEqual([]);
  const start = {
    action: "start",
    runtime: "python",
    args: ["worker.py"],
    interactive: true,
  };
  expect(Value.Check(original.parameters, start)).toBe(false);
  expect(Value.Check(tool!.parameters, start)).toBe(true);
  expect(
    Value.Check(tool!.parameters, {
      action: "preview_write",
      runtime: "python",
      args: ["worker.py"],
      writePaths: ["result.txt"],
    }),
  ).toBe(true);
  expect(
    Buffer.byteLength(
      JSON.stringify({
        name: tool!.name,
        description: tool!.description,
        parameters: tool!.parameters,
        constrainedSampling: null,
      }),
    ),
  ).toBeLessThanOrEqual(3.25 * 1024);
  await expect(tool!.execute("start", start)).rejects.toThrow(
    "original admission guard",
  );
  expect(guarded.execute).toHaveBeenCalledTimes(1);
  expect(() => workspaceToolchainEnvironment("python")).toThrow("policy");
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-process-toolchain-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const { run, thread } = await createActiveTestRun(
    store,
    "Python process lifecycle",
  );
  const sandbox = new HostDirectSandboxAdapter();
  const manager = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    dataRoot: path.join(root, "data"),
    sandbox,
  });
  await manager.initialize();
  const owner = { threadId: thread.id, runId: run.id };
  const original = createWorkspaceProcessTool(manager, owner);
  const tool = withToolchainProviders([original], {
    workspaceRoot,
    sandbox,
  })[0]!;
  const base = await resolveCommandRuntimeBinding("python");
  await exec(base.executable, [
    "-m",
    "venv",
    "--without-pip",
    path.join(workspaceRoot, ".venv"),
  ]);
  return {
    root,
    workspaceRoot,
    store,
    manager,
    tool,
    original,
    owner,
    close: async () => {
      await manager.shutdown();
      await store.close();
    },
  };
}

async function poll(
  f: Awaited<ReturnType<typeof fixture>>,
  processId: string,
  matches: (text: string, status: string) => boolean,
) {
  let text = "";
  let cursor = 0;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await f.tool.execute("poll", {
      action: "poll",
      processId,
      afterCursor: cursor,
      waitMs: 200,
    });
    cursor = result.details.nextCursor;
    text += result.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    if (matches(text, result.details.status)) return { text, result };
  }
  throw new Error(`Process did not settle: ${text}`);
}

liveIt(
  "runs a real venv-backed interactive Python process through start/input/poll/cancel and rejects cross-Run input",
  async () => {
    const f = await fixture();
    try {
      await writeFile(
        path.join(f.workspaceRoot, "worker.py"),
        "import sys\nprint('ENV=' + sys.prefix, flush=True)\nfor line in sys.stdin:\n    print('ECHO=' + line.strip(), flush=True)\n",
      );
      const started = await f.tool.execute("start", {
        action: "start",
        runtime: "python",
        args: ["-B", "-u", "worker.py"],
        interactive: true,
        timeoutMs: 10000,
      });
      const processId = started.details.processId;
      const ready = await poll(f, processId, (text) => text.includes("ENV="));
      expect(ready.text).toContain(".venv");
      await f.tool.execute("input", {
        action: "input",
        processId,
        text: "PRIVATE_PROCESS_INPUT",
        appendNewline: true,
      });
      expect(
        (
          await poll(f, processId, (text) =>
            text.includes("ECHO=PRIVATE_PROCESS_INPUT"),
          )
        ).text,
      ).toContain("ECHO=PRIVATE_PROCESS_INPUT");
      await expect(
        f.manager.writeInput({
          ...f.owner,
          runId: "run_other0000",
          processId,
          text: "x",
          initiatedBy: "agent",
        }),
      ).rejects.toThrow();
      expect(
        (await f.tool.execute("cancel", { action: "cancel", processId }))
          .details.status,
      ).toBe("cancelled");
      const events = await f.store.listRunEvents(f.owner.runId);
      expect(JSON.stringify(events)).not.toContain("PRIVATE_PROCESS_INPUT");
      expect((await f.manager.list(f.owner.threadId))[0]!.runtime).toBe(
        "python",
      );
      await expect(
        f.original.execute("direct", {
          action: "start",
          runtime: "python",
          args: ["--version"],
        } as never),
      ).rejects.toThrow("policy");
    } finally {
      await f.close();
    }
  },
);

liveIt(
  "binds scoped write previews to the selected interpreter and rejects environment drift before launch",
  async () => {
    const f = await fixture();
    try {
      await writeFile(
        path.join(f.workspaceRoot, "writer.py"),
        "from pathlib import Path\nPath('result.txt').write_text('verified')\n",
      );
      await writeFile(path.join(f.workspaceRoot, "result.txt"), "pending");
      const request = {
        action: "preview_write",
        runtime: "python",
        args: ["-B", "writer.py"],
        writePaths: ["result.txt"],
      };
      const preview = await f.tool.execute("preview", request);
      const cfg = path.join(f.workspaceRoot, ".venv/pyvenv.cfg");
      const before = await readFile(cfg, "utf8");
      await writeFile(cfg, before + "# drift\n");
      await expect(
        f.tool.execute("write", {
          action: "start_write",
          previewId: preview.details.previewId,
        }),
      ).rejects.toThrow();
      expect(await f.manager.list(f.owner.threadId)).toHaveLength(0);
      await writeFile(cfg, before);
      const fresh = await f.tool.execute("preview", request);
      const started = await f.tool.execute("write", {
        action: "start_write",
        previewId: fresh.details.previewId,
      });
      const settled = await poll(
        f,
        started.details.processId,
        (_text, status) => status !== "running",
      );
      expect(settled.result.details.status).toBe("succeeded");
      expect(
        await readFile(path.join(f.workspaceRoot, "result.txt"), "utf8"),
      ).toBe("verified");
    } finally {
      await f.close();
    }
  },
);

liveIt(
  "settles Python on timeout, cancellation and manager shutdown without relaunching sessions",
  async () => {
    const f = await fixture();
    try {
      await writeFile(
        path.join(f.workspaceRoot, "wait.py"),
        "import time\ntime.sleep(20)\n",
      );
      const first = await f.tool.execute("start", {
        action: "start",
        runtime: "python",
        args: ["-B", "wait.py"],
        timeoutMs: 1000,
      });
      expect(
        (
          await poll(
            f,
            first.details.processId,
            (_text, status) => status !== "running",
          )
        ).result.details.status,
      ).toBe("timed_out");
      const controller = new AbortController();
      const second = await f.tool.execute(
        "start",
        {
          action: "start",
          runtime: "python",
          args: ["-B", "wait.py"],
          timeoutMs: 10000,
        },
        controller.signal,
      );
      controller.abort();
      expect(
        (
          await poll(
            f,
            second.details.processId,
            (_text, status) => status !== "running",
          )
        ).result.details.status,
      ).toBe("cancelled");
      await f.tool.execute("start", {
        action: "start",
        runtime: "python",
        args: ["-B", "wait.py"],
        timeoutMs: 10000,
      });
      await f.manager.shutdown();
      const events = await f.store.listRunEvents(f.owner.runId);
      expect(
        events.filter((event) => event.type === "workspace.process.started"),
      ).toHaveLength(3);
      expect(
        events.filter((event) => event.type === "workspace.process.settled"),
      ).toHaveLength(2);
      expect(
        events.filter(
          (event) => event.type === "workspace.process.interrupted",
        ),
      ).toHaveLength(1);
      expect(
        (await f.manager.list(f.owner.threadId)).every(
          (session) => session.status !== "running",
        ),
      ).toBe(true);
    } finally {
      await f.close();
    }
  },
);
