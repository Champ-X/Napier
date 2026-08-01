import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import {
  observeSubagentWorktreeCandidate,
  type SubagentWorktreeSession,
} from "../src/subagent-worktree-files.js";
import { SubagentWorktreeOperationCoordinator } from "../src/subagent-worktree-verification.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Subagent worktree verification", () => {
  it("serializes mutation before verification and marks later edits stale", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-subagent-verification-"),
    );
    temporaryRoots.push(root);
    const candidateRoot = await realpath(root);
    await mkdir(path.join(candidateRoot, "src"), { recursive: true });
    const target = path.join(candidateRoot, "src/value.ts");
    await writeFile(target, "export const value = 1;\n");
    const session = { root: candidateRoot } as SubagentWorktreeSession;
    const operations = new SubagentWorktreeOperationCoordinator();
    const tool = operations.wrapVerificationTool(
      verificationTool(target),
      session,
    );

    const mutation = operations.runMutation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeFile(target, "export const value = 2;\n");
    });
    const verification = tool.execute("verify", {});
    await Promise.all([mutation, verification]);
    const verifiedSnapshot = await observeSubagentWorktreeCandidate(session);
    const fresh = operations.summarize(verifiedSnapshot.contentSha256);

    expect(fresh).toEqual(
      expect.objectContaining({
        attemptCount: 1,
        freshCount: 1,
        passedCount: 1,
        failedCount: 0,
        staleCount: 0,
      }),
    );
    expect(fresh.attempts[0]).toEqual(
      expect.objectContaining({
        toolName: "verify_workspace",
        status: "passed",
        fresh: true,
      }),
    );

    await operations.runMutation(() =>
      writeFile(target, "export const value = 3;\n"),
    );
    const finalSnapshot = await observeSubagentWorktreeCandidate(session);
    const stale = operations.summarize(finalSnapshot.contentSha256);
    expect(stale).toEqual(
      expect.objectContaining({
        freshCount: 0,
        passedCount: 0,
        failedCount: 0,
        staleCount: 1,
      }),
    );
  });

  it("records failed verification without persisting its diagnostic", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-subagent-verification-"),
    );
    temporaryRoots.push(root);
    const candidateRoot = await realpath(root);
    await writeFile(path.join(candidateRoot, "value.ts"), "export {};\n");
    const session = { root: candidateRoot } as SubagentWorktreeSession;
    const operations = new SubagentWorktreeOperationCoordinator();
    const diagnostic = "TOP_SECRET_VERIFIER_FAILURE";
    const failing: AgentTool = {
      name: "lsp_diagnostics",
      label: "LSP",
      description: "fixture",
      parameters: Type.Object({}),
      async execute() {
        throw new Error(diagnostic);
      },
    };

    await expect(
      operations.wrapVerificationTool(failing, session).execute("verify", {}),
    ).rejects.toThrow(diagnostic);
    const snapshot = await observeSubagentWorktreeCandidate(session);
    const summary = operations.summarize(snapshot.contentSha256);

    expect(summary).toEqual(
      expect.objectContaining({
        freshCount: 1,
        failedCount: 1,
        passedCount: 0,
      }),
    );
    expect(JSON.stringify(summary)).not.toContain(diagnostic);
  });

  it("records cancelled verification as fresh failed evidence without its reason", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-subagent-verification-"),
    );
    temporaryRoots.push(root);
    const candidateRoot = await realpath(root);
    await writeFile(path.join(candidateRoot, "value.ts"), "export {};\n");
    const session = { root: candidateRoot } as SubagentWorktreeSession;
    const operations = new SubagentWorktreeOperationCoordinator();
    const cancelled: AgentTool = {
      name: "verify_workspace",
      label: "Verify",
      description: "fixture",
      parameters: Type.Object({}),
      async execute(_toolCallId, _args, signal) {
        signal?.throwIfAborted();
        throw new Error("verification should have been cancelled");
      },
    };
    const controller = new AbortController();
    const reason = "TOP_SECRET_CANCELLATION_REASON";
    controller.abort(new Error(reason));

    await expect(
      operations
        .wrapVerificationTool(cancelled, session)
        .execute("verify", {}, controller.signal),
    ).rejects.toThrow(reason);
    const snapshot = await observeSubagentWorktreeCandidate(session);
    const summary = operations.summarize(snapshot.contentSha256);

    expect(summary).toEqual(
      expect.objectContaining({
        attemptCount: 1,
        freshCount: 1,
        passedCount: 0,
        failedCount: 1,
        staleCount: 0,
      }),
    );
    expect(JSON.stringify(summary)).not.toContain(reason);
  });

  it("records candidate command success independently and later marks it stale", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-command-"));
    temporaryRoots.push(root);
    const candidateRoot = await realpath(root);
    const target = path.join(candidateRoot, "value.js");
    await writeFile(target, "export const value = 1;\n");
    const session = { root: candidateRoot } as SubagentWorktreeSession;
    const operations = new SubagentWorktreeOperationCoordinator();
    const command = operations.wrapCommandTool(
      commandTool(async () => {
        const source = await readFile(target, "utf8");
        expect(source).toContain("value = 2");
        return source;
      }, "succeeded"),
      session,
    );

    const mutation = operations.runMutation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeFile(target, "export const value = 2;\n");
    });
    const execution = command.execute("command", {
      runtime: "node",
      args: ["value.js"],
    });
    await Promise.all([mutation, execution]);
    const observed = await observeSubagentWorktreeCandidate(session);
    expect(operations.summarizeCommands(observed.contentSha256)).toEqual(
      expect.objectContaining({
        attemptCount: 1,
        freshCount: 1,
        succeededCount: 1,
        failedCount: 0,
        staleCount: 0,
      }),
    );
    expect(operations.summarize(observed.contentSha256).attemptCount).toBe(0);

    await operations.runMutation(() =>
      writeFile(target, "export const value = 3;\n"),
    );
    const final = await observeSubagentWorktreeCandidate(session);
    expect(operations.summarizeCommands(final.contentSha256)).toEqual(
      expect.objectContaining({
        freshCount: 0,
        succeededCount: 0,
        failedCount: 0,
        staleCount: 1,
      }),
    );
  });

  it("records failed and cancelled commands without exposing output or reasons", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-command-"));
    temporaryRoots.push(root);
    const candidateRoot = await realpath(root);
    await writeFile(path.join(candidateRoot, "value.js"), "export {};\n");
    const session = { root: candidateRoot } as SubagentWorktreeSession;
    const operations = new SubagentWorktreeOperationCoordinator();
    const secretOutput = "TOP_SECRET_COMMAND_OUTPUT";
    await operations
      .wrapCommandTool(
        commandTool(async () => secretOutput, "failed"),
        session,
      )
      .execute("failed", { runtime: "node", args: ["value.js"] });

    const reason = "TOP_SECRET_COMMAND_CANCELLATION";
    const controller = new AbortController();
    controller.abort(new Error(reason));
    let toolchainChecks = 0;
    await expect(
      operations
        .wrapCommandTool(
          {
            ...commandTool(async () => "", "succeeded"),
            async execute(_id, _args, signal) {
              signal?.throwIfAborted();
              throw new Error("command should have been cancelled");
            },
          },
          session,
          async () => {
            toolchainChecks += 1;
          },
        )
        .execute("cancelled", {}, controller.signal),
    ).rejects.toThrow(reason);

    const snapshot = await observeSubagentWorktreeCandidate(session);
    const summary = operations.summarizeCommands(snapshot.contentSha256);
    expect(summary).toEqual(
      expect.objectContaining({
        attemptCount: 2,
        freshCount: 2,
        succeededCount: 0,
        failedCount: 2,
      }),
    );
    expect(JSON.stringify(summary)).not.toContain(secretOutput);
    expect(JSON.stringify(summary)).not.toContain(reason);
    expect(toolchainChecks).toBe(2);
  });

  it("blocks preview settlement after a command violates read-only access", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-command-"));
    temporaryRoots.push(root);
    const candidateRoot = await realpath(root);
    const target = path.join(candidateRoot, "value.js");
    await writeFile(target, "export const value = 1;\n");
    const session = { root: candidateRoot } as SubagentWorktreeSession;
    const operations = new SubagentWorktreeOperationCoordinator();
    const command = operations.wrapCommandTool(
      commandTool(async () => {
        await writeFile(target, "export const value = 2;\n");
        return "";
      }, "succeeded"),
      session,
    );

    await expect(command.execute("command", {})).rejects.toThrow(
      "changed candidate bytes",
    );
    const snapshot = await observeSubagentWorktreeCandidate(session);
    expect(() => operations.summarizeCommands(snapshot.contentSha256)).toThrow(
      "violated the read-only",
    );
  });

  it("caps serialized candidate commands at eight attempts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-command-"));
    temporaryRoots.push(root);
    const candidateRoot = await realpath(root);
    await writeFile(path.join(candidateRoot, "value.js"), "export {};\n");
    const session = { root: candidateRoot } as SubagentWorktreeSession;
    const operations = new SubagentWorktreeOperationCoordinator();
    const command = operations.wrapCommandTool(
      commandTool(async () => "", "succeeded"),
      session,
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await command.execute(`command-${attempt}`, {});
    }
    await expect(command.execute("command-over-limit", {})).rejects.toThrow(
      "attempt limit exceeded",
    );
    const snapshot = await observeSubagentWorktreeCandidate(session);
    expect(
      operations.summarizeCommands(snapshot.contentSha256).attemptCount,
    ).toBe(8);
  });

  it("keeps timeout and output-cap outcomes as failed command evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-command-"));
    temporaryRoots.push(root);
    const candidateRoot = await realpath(root);
    await writeFile(path.join(candidateRoot, "value.js"), "export {};\n");
    const session = { root: candidateRoot } as SubagentWorktreeSession;
    const operations = new SubagentWorktreeOperationCoordinator();

    for (const status of ["timed_out", "output_capped"] as const) {
      await operations
        .wrapCommandTool(
          commandTool(async () => "", status),
          session,
        )
        .execute(status, {});
    }
    const snapshot = await observeSubagentWorktreeCandidate(session);
    const summary = operations.summarizeCommands(snapshot.contentSha256);
    expect(summary).toEqual(
      expect.objectContaining({
        attemptCount: 2,
        succeededCount: 0,
        failedCount: 2,
      }),
    );
    expect(summary.attempts.map((attempt) => attempt.status)).toEqual([
      "timed_out",
      "output_capped",
    ]);
  });
});

function verificationTool(target: string): AgentTool {
  return {
    name: "verify_workspace",
    label: "Verify",
    description: "fixture",
    parameters: Type.Object({}),
    async execute() {
      const source = await readFile(target, "utf8");
      expect(source).toContain("value = 2");
      return {
        content: [{ type: "text", text: "passed" }],
        details: {
          kind: "typecheck",
          status: "passed",
          resultSha256: sha256(source),
        },
      };
    },
  };
}

function commandTool(
  execute: () => Promise<string>,
  status: "succeeded" | "failed" | "timed_out" | "output_capped",
): AgentTool {
  return {
    name: "run_command",
    label: "Command",
    description: "fixture",
    parameters: Type.Object({}),
    async execute() {
      const output = await execute();
      return {
        content: [{ type: "text", text: output }],
        details: {
          runtime: "node",
          status,
          resultSha256: sha256(output),
        },
      };
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
