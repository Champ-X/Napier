import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type {
  AutomaticRecoveryAssessment,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

export const PATCH_RECOVERY_BASELINE =
  "caf37eaf5e5a1ab1fae55b4a644d2ee460ed54d1";

/** Run the pinned pre-change assessor against the exact observed event stream. */
export async function baselinePatchAssessment(
  root: string,
  run: RunRecord,
  events: RunEvent[],
): Promise<AutomaticRecoveryAssessment> {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const source = await promisify(execFile)(
    "git",
    [
      "show",
      `${PATCH_RECOVERY_BASELINE}:packages/runtime/src/automatic-recovery.ts`,
    ],
    { cwd: repository },
  );
  const baseline = path.join(root, "baseline.ts");
  const input = path.join(root, "baseline-input.json");
  const output = path.join(root, "baseline-result.json");
  await writeFile(
    baseline,
    source.stdout.replace(
      /from "\.\/([^"\n]+)\.js"/gu,
      (_, name: string) =>
        `from ${JSON.stringify(pathToFileURL(path.join(repository, "packages/runtime/src", `${name}.ts`)).href)}`,
    ),
  );
  await writeFile(input, JSON.stringify({ run, events }));
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { readFile, writeFile } from 'node:fs/promises';
     const module = await import(process.argv[1]);
     const result = module.assessAutomaticRecovery(JSON.parse(await readFile(process.argv[2], 'utf8')));
     await writeFile(process.argv[3], JSON.stringify(result));`,
      pathToFileURL(baseline).href,
      input,
      output,
    ],
    { cwd: repository },
  );
  return JSON.parse(
    await readFile(output, "utf8"),
  ) as AutomaticRecoveryAssessment;
}
