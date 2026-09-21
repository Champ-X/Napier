import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Value } from "typebox/value";
import {
  CommandRunner,
  prepareCommandExecution,
} from "../src/command-execution.js";
import {
  commandToolCallArgumentsLedgerProjection,
  createCommandTool,
} from "../src/command-tool.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { withToolchainProviders } from "../src/toolchain-provider.js";
import { createWorkspaceProcessTool } from "../src/workspace-process-tool.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true })));
});

function surfaces() {
  const options = {
    workspaceRoot: "/unused",
    sandbox: new HostDirectSandboxAdapter(),
  };
  const command = createCommandTool(options);
  const process = createWorkspaceProcessTool(undefined as never, {
    threadId: "thread_multiline",
    runId: "run_multiline",
  });
  const extended = withToolchainProviders([command, process], options);
  return { command, process, extended };
}

it("accepts text whitespace across direct and managed command schemas", () => {
  const { command, process, extended } = surfaces();
  for (const tool of [process, extended[1]!]) {
    expect(
      Buffer.byteLength(
        JSON.stringify({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          constrainedSampling: null,
        }),
      ),
    ).toBeLessThanOrEqual(3.25 * 1024);
  }
  for (const code of ["one\ntwo", "one\r\ntwo", "one\ttwo", "\n"]) {
    const args = ["-e", code];
    expect(Value.Check(command.parameters, { runtime: "node", args })).toBe(
      true,
    );
    for (const tool of [process, extended[1]!])
      for (const action of ["start", "preview_write"])
        expect(
          Value.Check(tool.parameters, {
            action,
            runtime: "node",
            args,
            ...(action === "preview_write"
              ? { writePaths: ["result.txt"] }
              : {}),
          }),
        ).toBe(true);
    expect(
      Value.Check(extended[0]!.parameters, {
        runtime: "python",
        args: ["-c", code],
      }),
    ).toBe(true);
    expect(
      Value.Check(extended[1]!.parameters, {
        action: "start",
        runtime: "python",
        args: ["-c", code],
      }),
    ).toBe(true);
    expect(
      Value.Check(process.parameters, {
        action: "start",
        runtime: "shell",
        args: [code],
      }),
    ).toBe(true);
  }
});

it("rejects every other ASCII control byte before any launch", async () => {
  const { command, process, extended } = surfaces();
  const sandbox = { id: "not-launched", launch: vi.fn() };
  const forbidden = [...Array.from({ length: 32 }, (_, n) => n), 127].filter(
    (n) => ![9, 10, 13].includes(n),
  );
  for (const n of forbidden) {
    const args = [`before${String.fromCharCode(n)}after`];
    expect(Value.Check(command.parameters, { runtime: "node", args })).toBe(
      false,
    );
    expect(
      Value.Check(process.parameters, {
        action: "preview_write",
        runtime: "node",
        args,
        writePaths: ["out"],
      }),
    ).toBe(false);
    expect(
      Value.Check(extended[0]!.parameters, { runtime: "python", args }),
    ).toBe(false);
    for (const runtime of ["node", "python", "shell"] as const)
      await expect(
        prepareCommandExecution(
          { workspaceRoot: "/unused", sandbox },
          { runtime, args },
        ),
      ).rejects.toThrow("bounded explicit argv");
  }
  expect(sandbox.launch).not.toHaveBeenCalled();
});

it("retains strict path, count, size, shell-script and runtime contracts", async () => {
  const { command, process, extended } = surfaces();
  const options = {
    workspaceRoot: "/unused",
    sandbox: { id: "unused", launch: vi.fn() },
  };
  for (const whitespace of ["\n", "\r", "\t"]) {
    const cwd = `src${whitespace}`;
    expect(
      Value.Check(command.parameters, { runtime: "node", args: [], cwd }),
    ).toBe(false);
    expect(
      Value.Check(process.parameters, {
        action: "start",
        runtime: "node",
        args: [],
        cwd,
      }),
    ).toBe(false);
    expect(
      Value.Check(process.parameters, {
        action: "preview_write",
        runtime: "node",
        args: [],
        writePaths: [cwd],
      }),
    ).toBe(false);
    await expect(
      prepareCommandExecution(options, {
        runtime: "node",
        args: [],
        cwd,
      }),
    ).rejects.toThrow("cwd must be workspace-relative");
  }
  for (const args of [
    ["x".repeat(2049)],
    Array(65).fill(""),
    Array(9).fill("x".repeat(2048)),
  ])
    await expect(
      prepareCommandExecution(options, {
        runtime: "node",
        args,
      }),
    ).rejects.toThrow("bounded explicit argv");
  expect(
    Value.Check(command.parameters, { runtime: "shell", args: ["true"] }),
  ).toBe(false);
  expect(
    Value.Check(extended[0]!.parameters, { runtime: "shell", args: ["true"] }),
  ).toBe(false);
  await expect(
    prepareCommandExecution(options, {
      runtime: "shell",
      args: ["true", "false"],
    }),
  ).rejects.toThrow("exactly one explicit script");
});

it.each(["\n", "\r\n"])(
  "executes multiline Node source with %j and preserves literal argv and receipts",
  async (lineEnding) => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-multiline-argv-"));
    roots.push(root);
    const tool = createCommandTool({
      workspaceRoot: root,
      sandbox: new HostDirectSandboxAdapter(),
    });
    const code = [
      'import assert from "node:assert/strict";',
      "const data = process.argv.slice(1);",
      "\tassert.equal(data.length, 4);",
      "console.log(JSON.stringify(data));",
    ].join(lineEnding);
    const data = [
      "one\ntwo\r\n\tend",
      "$(touch must-not-exist)",
      "`touch also-must-not-exist`",
      "$HOME",
    ];
    const input = {
      runtime: "node" as const,
      args: ["--input-type=module", "-e", code, ...data],
    };
    expect(Value.Check(tool.parameters, input)).toBe(true);
    const result = await tool.execute("multiline", input);
    expect(result.details.status).toBe("succeeded");
    const text = result.content.find((c) => c.type === "text")!;
    expect(text.type === "text" && text.text).toContain(JSON.stringify(data));
    expect(result.details.argumentSetSha256).toBe(
      sha256(canonicalJson(input.args)),
    );
    expect(result.details.argumentCount).toBe(input.args.length);
    expect(await readdir(root)).toEqual([]);
    expect(
      JSON.stringify(commandToolCallArgumentsLedgerProjection(input)),
    ).not.toContain(code);
    // Host-direct verifies execution/fidelity here, not OS isolation.
    expect(result.details.sandbox).toBe("host-direct");
  },
);

it("keeps line endings significant in command identities", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-multiline-identity-"));
  roots.push(root);
  const runner = new CommandRunner({
    workspaceRoot: root,
    sandbox: new HostDirectSandboxAdapter(),
  });
  const a = await runner.run({
    runtime: "node",
    args: ["-e", "// first\nconsole.log(1)"],
  });
  const b = await runner.run({
    runtime: "node",
    args: ["-e", "// first\r\nconsole.log(1)"],
  });
  expect(a.stdout).toBe(b.stdout);
  expect(a.details.argumentSetSha256).not.toBe(b.details.argumentSetSha256);
  expect(a.details.commandSha256).not.toBe(b.details.commandSha256);
});
