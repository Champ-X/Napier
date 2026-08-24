import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

export const rpcCliTemporaryRoots: string[] = [];

export class RpcChild {
  private readonly received: Array<Record<string, unknown>> = [];
  private readonly stderrChunks: string[] = [];

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      this.received.push(JSON.parse(line) as Record<string, unknown>);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString("utf8"));
    });
  }

  send(value: unknown): void {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  messages(): Array<Record<string, unknown>> {
    return [...this.received];
  }

  stderr(): string {
    return this.stderrChunks.join("");
  }

  async waitForId(
    id: string | number | null,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const message = this.received.find((candidate) => candidate["id"] === id);
      if (message) return message;
      if (this.child.exitCode !== null) {
        throw new Error(`RPC child exited early: ${this.stderr()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for RPC response ${String(id)}`);
  }
}

export async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rpc-cli-"));
  rpcCliTemporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot };
}

export function minimalEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  };
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
