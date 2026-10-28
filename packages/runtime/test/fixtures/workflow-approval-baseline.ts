import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

export const WORKFLOW_APPROVAL_BASELINE =
  "610a8ef54426fb3408d43d1e33f1ce6f419cd7ca";

/** Freeze the old approval API, with current real Store/Workflow dependencies. */
export async function withBaselineApprovalService<T>(
  execute: (modulePath: string) => Promise<T>,
): Promise<T> {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const directory = await mkdtemp(
    path.join(repository, "packages/runtime/test/.approval-baseline-"),
  );
  try {
    const source = (
      await promisify(execFile)(
        "git",
        [
          "show",
          `${WORKFLOW_APPROVAL_BASELINE}:packages/runtime/src/embedded-workflow-approvals.ts`,
        ],
        { cwd: repository },
      )
    ).stdout;
    const rewritten = source.replace(
      /from "\.\/([^"\n]+)\.js"/gu,
      (_, dependency: string) =>
        `from ${JSON.stringify(pathToFileURL(path.join(repository, "packages/runtime/src", `${dependency}.ts`)).href)}`,
    );
    const filename = path.join(directory, "embedded-workflow-approvals.ts");
    await writeFile(filename, rewritten);
    return await execute(pathToFileURL(filename).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
