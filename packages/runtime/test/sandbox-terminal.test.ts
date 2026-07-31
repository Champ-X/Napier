import { realpath } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { launchTerminalProcess } from "../src/sandbox-terminal.js";

const describeUnix = process.platform === "win32" ? describe.skip : describe;

describeUnix("node-pty process adapter", () => {
  it("allocates, resizes, writes, and merges a real terminal stream", async () => {
    const executable = await realpath(process.execPath);
    const child = await launchTerminalProcess({
      command: executable,
      args: [
        "-e",
        [
          "process.stdin.setEncoding('utf8');",
          "process.stdout.write(`READY:${process.stdin.isTTY}:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}:${process.env.TERM}\\n`);",
          "process.on('SIGWINCH', () => process.stdout.write(`SIZE:${process.stdout.columns}x${process.stdout.rows}\\n`));",
          "process.stdin.on('data', data => {",
          "  process.stderr.write(`INPUT:${JSON.stringify(data)}\\n`);",
          "  process.exit(0);",
          "});",
        ].join(""),
      ],
      cwd: process.cwd(),
      env: {
        CI: "1",
        LANG: "C",
        LC_ALL: "C",
        TERM: "xterm-256color",
      },
      columns: 91,
      rows: 37,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    await vi.waitFor(() => {
      expect(stdout).toContain("READY:true:true:91x37:xterm-256color");
    });
    await child.resize!(111, 43);
    await vi.waitFor(() => {
      expect(stdout).toContain("SIZE:111x43");
    });
    child.stdin.write("terminal-input\n");
    await expect(child.exit).resolves.toEqual({ code: 0, signal: null });
    expect(stdout).toContain('INPUT:"terminal-input\\n"');
    expect(stderr).toBe("");
  });

  it("terminates a real terminal process group", async () => {
    const executable = await realpath(process.execPath);
    const child = await launchTerminalProcess({
      command: executable,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: {
        CI: "1",
        LANG: "C",
        LC_ALL: "C",
        TERM: "xterm-256color",
      },
      columns: 80,
      rows: 24,
    });
    await child.terminate();
    await expect(child.exit).resolves.toEqual(
      expect.objectContaining({
        code: expect.any(Number),
      }),
    );
  });
});
