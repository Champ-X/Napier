import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

export const DECISION_RECOVERY_BASELINE =
  "9ba6ed3d52f463a597c0750c7eeace762526c21b";

/** Execute the pre-change Store and repository, retaining their actual writes. */
export async function withBaselineStore<T>(
  execute: (modulePath: string) => Promise<T>,
): Promise<T> {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const directory = await mkdtemp(
    path.join(repository, "packages/runtime/test/.decision-baseline-"),
  );
  const names = ["store", "thread-interaction-repository"];
  try {
    for (const name of names) {
      const source = (
        await promisify(execFile)(
          "git",
          [
            "show",
            `${DECISION_RECOVERY_BASELINE}:packages/runtime/src/${name}.ts`,
          ],
          { cwd: repository },
        )
      ).stdout;
      const rewritten = source.replace(
        /from "\.\/([^"\n]+)\.js"/gu,
        (_, dependency: string) => {
          const filename = names.includes(dependency)
            ? path.join(directory, `${dependency}.ts`)
            : path.join(repository, "packages/runtime/src", `${dependency}.ts`);
          return `from ${JSON.stringify(pathToFileURL(filename).href)}`;
        },
      );
      await writeFile(path.join(directory, `${name}.ts`), rewritten);
    }
    return await execute(pathToFileURL(path.join(directory, "store.ts")).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
