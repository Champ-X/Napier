import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runPromptRegressionMatrix,
  verifyPromptRegressionMatrix,
} from "./prompt-regression-matrix.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const options = parseArguments(process.argv.slice(2));
const expected = options.verifyReceiptPath
  ? verifyPromptRegressionMatrix(
      JSON.parse(await readFile(options.verifyReceiptPath, "utf8")),
    )
  : undefined;
const artifact = await runPromptRegressionMatrix(repositoryRoot);
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (options.receiptPath) {
  await writeFile(options.receiptPath, serialized, {
    encoding: "utf8",
    mode: 0o600,
  });
}
if (expected) {
  if (JSON.stringify(expected) !== JSON.stringify(artifact)) {
    throw new Error(
      `Prompt regression artifact drifted: ${options.verifyReceiptPath}`,
    );
  }
}
verifyPromptRegressionMatrix(artifact);
process.stdout.write(serialized);

function parseArguments(args) {
  const options = {
    receiptPath: undefined,
    verifyReceiptPath: undefined,
  };
  for (let index = 0; index < args.length; index += 2) {
    const argument = args[index];
    const value = args[index + 1];
    if (
      !value ||
      (argument !== "--receipt" && argument !== "--verify-receipt")
    ) {
      throw new Error(
        "Usage: node scripts/run-prompt-regression-matrix.mjs [--receipt <path>] [--verify-receipt <path>]",
      );
    }
    if (argument === "--receipt") options.receiptPath = path.resolve(value);
    else options.verifyReceiptPath = path.resolve(value);
  }
  return options;
}
