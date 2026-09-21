import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";

export async function createCapabilityContractTestRuntime(
  roots: string[],
  skills?: readonly string[],
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-capability-contract-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  for (const name of skills ?? []) {
    const directory = path.join(workspaceRoot, "skills", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} readiness fixture.\n---\n\n# ${name}\n\nFollow the bounded workflow.\n`,
    );
  }
  return createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
    env: {},
    sandbox: new UnsupportedSandboxAdapter(
      skills ? "capability-contract-skill-test" : "capability-contract-test",
    ),
  });
}
