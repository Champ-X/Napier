import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const PROMPT_REGRESSION_DIMENSIONS = [
  "network",
  "coding",
  "browser",
  "long_task",
  "user_interrupt",
  "dangerous_action",
  "partial_block",
  "correction",
];

export const PROMPT_REGRESSION_CASES = [
  promptCase(
    "network",
    "apps/cli/test/open-web-research-benchmark.test.ts",
    "executes default Search, Fetch, Browser, capture, and citation semantics",
  ),
  promptCase(
    "coding",
    "apps/cli/test/coding-benchmark.test.ts",
    "scores a real Agent edit and emits self-verifying CAS artifacts",
  ),
  promptCase(
    "browser",
    "packages/runtime/test/agent-browser.test.ts",
    "executes one confirmed Browser interaction in the same Run Session",
  ),
  promptCase(
    "long_task",
    "apps/cli/test/workflow-benchmark-long-horizon.test.ts",
    "recovers the persisted Approval answer after a second Runtime restart",
  ),
  promptCase(
    "user_interrupt",
    "apps/cli/test/interactive-cli.test.ts",
    "cancels an active turn on interrupt and remains usable",
  ),
  promptCase(
    "dangerous_action",
    "packages/runtime/test/agent-browser-sensitive-target.test.ts",
    "blocks credential typing before confirmation or Browser execution",
  ),
  promptCase(
    "partial_block",
    "apps/cli/test/workflow-cli.test.ts",
    "returns blocked evidence and requires explicit retry for a failed node",
  ),
  promptCase(
    "correction",
    "packages/runtime/test/model-advisor.test.ts",
    "creates hash-only correction requests and outcomes",
  ),
];

export async function runPromptRegressionMatrix(
  repositoryRoot,
  execute = executeVitestCase,
) {
  const cases = [];
  for (const definition of PROMPT_REGRESSION_CASES) {
    const absolutePath = path.join(repositoryRoot, definition.testFile);
    const source = await readFile(absolutePath);
    const argv = vitestArguments(definition);
    const result = await execute({
      cwd: repositoryRoot,
      argv,
      definition,
    });
    if (
      result.status !== "passed" ||
      result.testFileCount !== 1 ||
      result.testCount !== 1
    ) {
      throw new Error(
        `Prompt regression failed: ${definition.dimension} (${result.status})`,
      );
    }
    const content = {
      id: definition.id,
      dimension: definition.dimension,
      testFile: definition.testFile,
      testNameSha256: sha256(definition.testName),
      testFileSha256: sha256(source),
      argvSha256: sha256(canonicalJson(argv)),
      status: "passed",
      testFileCount: result.testFileCount,
      testCount: result.testCount,
    };
    cases.push({
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    });
  }
  const content = {
    kind: "napier.prompt-regression-matrix",
    schemaVersion: 1,
    matrixVersion: "napier.prompt-regression.v1",
    promptContentStored: false,
    dimensions: [...PROMPT_REGRESSION_DIMENSIONS],
    caseCount: cases.length,
    cases,
  };
  return verifyPromptRegressionMatrix({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function verifyPromptRegressionMatrix(input) {
  if (
    !record(input) ||
    input.kind !== "napier.prompt-regression-matrix" ||
    input.schemaVersion !== 1 ||
    input.matrixVersion !== "napier.prompt-regression.v1" ||
    input.promptContentStored !== false ||
    !Array.isArray(input.dimensions) ||
    canonicalJson(input.dimensions) !==
      canonicalJson(PROMPT_REGRESSION_DIMENSIONS) ||
    input.caseCount !== PROMPT_REGRESSION_CASES.length ||
    !Array.isArray(input.cases) ||
    input.cases.length !== PROMPT_REGRESSION_CASES.length ||
    !digest(input.contentSha256)
  ) {
    throw new Error("Prompt regression matrix is invalid");
  }
  const seen = new Set();
  for (const [index, item] of input.cases.entries()) {
    const definition = PROMPT_REGRESSION_CASES[index];
    if (
      !record(item) ||
      item.id !== definition.id ||
      item.dimension !== definition.dimension ||
      item.testFile !== definition.testFile ||
      !digest(item.testNameSha256) ||
      item.testNameSha256 !== sha256(definition.testName) ||
      !digest(item.testFileSha256) ||
      !digest(item.argvSha256) ||
      item.argvSha256 !== sha256(canonicalJson(vitestArguments(definition))) ||
      item.status !== "passed" ||
      item.testFileCount !== 1 ||
      item.testCount !== 1 ||
      !digest(item.contentSha256) ||
      seen.has(item.dimension)
    ) {
      throw new Error("Prompt regression case is invalid");
    }
    seen.add(item.dimension);
    const { contentSha256, ...content } = item;
    if (sha256(canonicalJson(content)) !== contentSha256) {
      throw new Error("Prompt regression case hash mismatch");
    }
  }
  const { contentSha256, ...content } = input;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Prompt regression matrix hash mismatch");
  }
  return structuredClone(input);
}

export function promptRegressionArtifactMatchesSources(
  artifact,
  sourceSha256ByPath,
) {
  const verified = verifyPromptRegressionMatrix(artifact);
  return verified.cases.every(
    (item) => sourceSha256ByPath[item.testFile] === item.testFileSha256,
  );
}

function promptCase(dimension, testFile, testName) {
  return {
    id: `prompt_${dimension}_v1`,
    dimension,
    testFile,
    testName,
  };
}

function vitestArguments(definition) {
  return [
    "node_modules/vitest/vitest.mjs",
    "run",
    definition.testFile,
    "-t",
    definition.testName,
    "--maxWorkers=1",
    "--testTimeout=30000",
  ];
}

async function executeVitestCase({ cwd, argv }) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    const errorChunks = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => errorChunks.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const output = stripAnsi(Buffer.concat(chunks).toString("utf8"));
      const errorOutput = stripAnsi(
        Buffer.concat(errorChunks).toString("utf8"),
      );
      const counts = vitestCounts(`${output}\n${errorOutput}`);
      resolve({
        status: code === 0 && signal === null ? "passed" : "failed",
        ...counts,
      });
    });
  });
}

function vitestCounts(output) {
  const fileMatch = /Test Files\s+(\d+)\s+passed/u.exec(output);
  const testMatch = /Tests\s+(\d+)\s+passed/u.exec(output);
  return {
    testFileCount: fileMatch ? Number(fileMatch[1]) : 0,
    testCount: testMatch ? Number(testMatch[1]) : 0,
  };
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, "");
}

function digest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}
