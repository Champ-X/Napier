import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { createCommandTool } from "../src/command-tool.js";
import { resolveCommandRuntimeBinding } from "../src/command-runtime.js";
import { createPlatformSandboxAdapter } from "../src/sandbox.js";
import { createVerificationTool } from "../src/verification.js";
import {
  detectToolchains,
  withToolchainProviders,
} from "../src/toolchain-provider.js";
import { verifyPythonToolchain } from "../src/python-toolchain.js";
import {
  validateHarnessPolicyProfile,
  createHarnessPolicyProfile,
} from "../src/harness-policy-profile.js";

const liveIt = it.runIf(process.env.NAPIER_LIVE_TOOLCHAIN_SMOKE === "1");
const roots: string[] = [];
const exec = promisify(execFile);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "napier-toolchains-"),
  );
  roots.push(workspaceRoot);
  await writeFile(
    path.join(workspaceRoot, "price.py"),
    "def total(n):\n    return n * 2\n",
  );
  await writeFile(
    path.join(workspaceRoot, "test_price.py"),
    [
      "import unittest",
      "from price import total",
      "class PriceTest(unittest.TestCase):",
      "    def test_total(self):",
      "        self.assertEqual(total(3), 6)",
      "",
    ].join("\n"),
  );
  const options = { workspaceRoot, sandbox: createPlatformSandboxAdapter() };
  const tools = withToolchainProviders(
    [createCommandTool(options), createVerificationTool(options)],
    options,
  );
  return {
    ...options,
    tools,
    verify: tools.find((tool) => tool.name === "verify_workspace")!,
  };
}

liveIt(
  "runs actual Python tests and syntax checks in the OS sandbox with source-bound evidence",
  async () => {
    const f = await fixture();
    const success = await f.verify.execute("test", {
      kind: "test",
      runtime: "python",
    });
    expect(success.details.status, JSON.stringify(success.content)).toBe(
      "passed",
    );
    expect(success.details.snapshotStatus).toBe("unchanged");
    expect(success.details.workspaceSnapshotSha256).toBe(
      success.details.observedWorkspaceSnapshotSha256,
    );
    await writeFile(
      path.join(f.workspaceRoot, "price.py"),
      "def total(n):\n    return n * 3\n",
    );
    const failure = await f.verify.execute("test", {
      kind: "test",
      target: "test_price.py",
    });
    expect(failure.details.status).toBe("failed");
    expect(failure.details.workspaceSnapshotSha256).not.toBe(
      success.details.workspaceSnapshotSha256,
    );
    const syntax = await f.verify.execute("syntax", {
      kind: "syntax",
      target: "price.py",
    });
    expect(syntax.details.status).toBe("passed");
    expect(syntax.details.kind).toBe("syntax");
    await writeFile(path.join(f.workspaceRoot, "price.py"), "def total(\n");
    expect(
      (await f.verify.execute("syntax", { kind: "syntax", target: "price.py" }))
        .details.status,
    ).toBe("failed");
  },
);

liveIt(
  "detects mixed languages and keeps the original Node execution available",
  async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspaceRoot, "price.js"), "console.log(6)");
    expect((await detectToolchains(f.workspaceRoot)).runtimes).toEqual([
      "node",
      "python",
    ]);
    await expect(f.verify.execute("test", { kind: "test" })).rejects.toThrow(
      "specify runtime",
    );
    const command = f.tools.find((tool) => tool.name === "run_command")!;
    const node = await command.execute("node", {
      runtime: "node",
      args: ["price.js"],
    });
    expect(node.details.status).toBe("succeeded");
    expect(JSON.stringify(node.content)).toContain("6");
    await expect(
      command.execute("shell", { runtime: "shell", args: ["echo hi"] }),
    ).rejects.toThrow("Unsupported");
  },
);

liveIt(
  "preserves the .venv interpreter invocation and binds its configuration",
  async () => {
    const f = await fixture();
    const base = await resolveCommandRuntimeBinding("python");
    await exec(base.executable, [
      "-m",
      "venv",
      "--without-pip",
      path.join(f.workspaceRoot, ".venv"),
    ]);
    const command = f.tools.find((tool) => tool.name === "run_command")!;
    const venv = await command.execute("venv", {
      runtime: "python",
      args: ["-c", "import sys; print(sys.prefix); print(sys.base_prefix)"],
    });
    expect(venv.details.status, JSON.stringify(venv.content)).toBe("succeeded");
    expect(JSON.stringify(venv.content)).toContain(".venv");
    const binding = await resolveCommandRuntimeBinding("python", {
      python: path.join(f.workspaceRoot, ".venv/bin/python3"),
    });
    expect(binding.executable).toContain(".venv/bin/python3");
    expect(
      binding.runtimeAssets.some((asset) => asset.path.endsWith("pyvenv.cfg")),
    ).toBe(true);
    const verified = await f.verify.execute("test", {
      kind: "test",
      runtime: "python",
    });
    expect(verified.details.status, JSON.stringify(verified.content)).toBe(
      "passed",
    );
  },
);

liveIt(
  "rejects zero tests and missing verifiers instead of reporting a false pass",
  async () => {
    const f = await fixture();
    await mkdir(path.join(f.workspaceRoot, "empty"));
    const empty = await f.verify.execute("test", {
      kind: "test",
      runtime: "python",
      target: "empty",
    });
    expect(empty.details.status).toBe("failed");
    expect(JSON.stringify(empty.content)).toContain("No tests collected");
    const base = await resolveCommandRuntimeBinding("python");
    await exec(base.executable, [
      "-m",
      "venv",
      "--without-pip",
      path.join(f.workspaceRoot, ".venv"),
    ]);
    const missing = await f.verify.execute("test", {
      kind: "typecheck",
      runtime: "python",
    });
    expect(missing.details.status).toBe("failed");
    expect(JSON.stringify(missing.content)).toContain("mypy");
  },
);

liveIt(
  "enforces literal args, denied writes and private environment, and propagates cancellation",
  async () => {
    const f = await fixture();
    const command = f.tools.find((tool) => tool.name === "run_command")!;
    const result = await command.execute("literal", {
      runtime: "python",
      args: [
        "-c",
        "import os,sys; print(sys.argv[1]); print(os.getenv('DEEPSEEK_API_KEY') is None)",
        "$(touch denied)",
      ],
    });
    expect(result.details.status).toBe("succeeded");
    expect(JSON.stringify(result.content)).toContain("$(touch denied)");
    expect(JSON.stringify(result.content)).toContain("True");
    const write = await command.execute("write", {
      runtime: "python",
      args: ["-c", "open('denied','w').write('bad')"],
    });
    expect(write.details.status).toBe("failed");
    await expect(
      readFile(path.join(f.workspaceRoot, "denied")),
    ).rejects.toThrow();
    const controller = new AbortController();
    const pending = command.execute(
      "cancel",
      { runtime: "python", args: ["-c", "import time; time.sleep(20)"] },
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await expect(pending).rejects.toThrow(/abort/iu);
    } finally {
      clearTimeout(timer);
    }
  },
);

liveIt(
  "refuses escaping scopes and broken environments before executing",
  async () => {
    const f = await fixture();
    await symlink(tmpdir(), path.join(f.workspaceRoot, "outside"));
    await expect(
      f.verify.execute("test", {
        kind: "test",
        runtime: "python",
        target: "outside",
      }),
    ).rejects.toThrow("escapes");
    await expect(
      f.verify.execute("test", { kind: "test", runtime: "python", cwd: ".." }),
    ).rejects.toThrow("escapes");
    await mkdir(path.join(f.workspaceRoot, ".venv"));
    await expect(
      f.verify.execute("test", { kind: "test", runtime: "python" }),
    ).rejects.toThrow();
  },
);

liveIt(
  "invalidates successful execution if source changes while the process is running",
  async () => {
    const f = await fixture();
    const sandbox = {
      id: f.sandbox.id,
      launch: async (request: Parameters<typeof f.sandbox.launch>[0]) => {
        const process = await f.sandbox.launch(request);
        await writeFile(
          path.join(f.workspaceRoot, "concurrent.txt"),
          "changed",
        );
        return process;
      },
    };
    const result = await verifyPythonToolchain(
      { workspaceRoot: f.workspaceRoot, sandbox },
      { kind: "test", runtime: "python" },
    );
    expect(result.details.exitCode).toBe(0);
    expect(result.details.status).toBe("failed");
    expect(result.details.snapshotStatus).toBe("changed");
  },
);

liveIt(
  "executes multiline Python inline without introducing helper files",
  async () => {
    const f = await fixture();
    const command = f.tools.find((tool) => tool.name === "run_command")!;
    const result = await command.execute("inline", {
      runtime: "python",
      code: "from price import total\nfor value in [0, 1, 3]:\n    assert total(value) == value * 2\nprint('inline verified')",
    });
    expect(result.details.status, JSON.stringify(result.content)).toBe(
      "succeeded",
    );
    expect(JSON.stringify(result.content)).toContain("inline verified");
    const verification = await f.verify.execute("test", {
      runtime: "python",
      kind: "test",
    });
    expect(verification.details.workspaceSnapshotFileCount).toBe(2);
    await expect(
      command.execute("bad", { runtime: "node", code: "console.log(1)" }),
    ).rejects.toThrow("Python code");
    await expect(
      command.execute("bad", { runtime: "python", args: [], code: "pass" }),
    ).rejects.toThrow("omit args");
  },
);

liveIt(
  "loads the pinned unittest package before adding the project to import resolution",
  async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.workspaceRoot, "unittest.py"),
      "raise RuntimeError('SHADOW_VERIFIER_LOADED')\n",
    );
    const result = await f.verify.execute("test", {
      runtime: "python",
      kind: "test",
      target: "test_price.py",
    });
    expect(result.details.status, JSON.stringify(result.content)).toBe(
      "passed",
    );
    expect(JSON.stringify(result.content)).not.toContain(
      "SHADOW_VERIFIER_LOADED",
    );
  },
);

liveIt(
  "cannot introduce commands or verification into an unavailable tool surface",
  async () => {
    const f = await fixture();
    expect(withToolchainProviders([], f)).toEqual([]);
    const commandOnly = [createCommandTool(f)];
    expect(
      withToolchainProviders(commandOnly, f).map((tool) => tool.name),
    ).toEqual(["run_command"]);
  },
);

it("rejects unknown policy strategies instead of silently activating a fallback", () => {
  const policy = createHarnessPolicyProfile({
    id: "coding-python",
    revision: 1,
    context: { prompt: "legacy", memory: "legacy", workingState: "legacy" },
    toolSurface: { editReferences: true },
    verification: "node-python-v1",
  });
  expect(validateHarnessPolicyProfile(policy)).toEqual(policy);
  expect(() =>
    createHarnessPolicyProfile({
      id: policy.id,
      revision: policy.revision,
      toolSurface: policy.toolSurface,
      verification: policy.verification,
      context: { ...policy.context, prompt: "future-v1" as "stable-v1" },
    }),
  ).toThrow();
});
