import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createS1UpstreamRunAuthority,
  validateS1UpstreamRunAuthority,
} from "./s1-upstream-run-authority.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function writeS1UpstreamRunAuthority(options) {
  const runPath = path.resolve(options.runPath);
  const artifactsPath = path.resolve(options.artifactsPath);
  const outputPath = path.resolve(options.outputPath);
  const [run, artifacts] = await Promise.all([
    readJson(runPath, "S1 upstream workflow run response"),
    readJson(artifactsPath, "S1 upstream artifact list response"),
  ]);
  const authority = createS1UpstreamRunAuthority({
    authority: options.authority,
    sourceSha: options.sourceSha,
    expectedRunId: options.expectedRunId,
    run,
    artifacts,
  });
  const errors = validateS1UpstreamRunAuthority(authority, {
    authority: options.authority,
    sourceSha: options.sourceSha,
    workflowRunId: options.expectedRunId,
  });
  if (errors.length > 0) {
    throw new Error(`S1 upstream run authority failed: ${errors.join("; ")}`);
  }
  await writeJson(outputPath, authority);
  return {
    valid: true,
    errors: [],
    path: outputPath,
    authority,
  };
}

export async function verifyS1UpstreamRunAuthorityFile(options) {
  const artifactPath = path.resolve(options.artifactPath);
  const value = await readJson(artifactPath, "S1 upstream run authority");
  const errors = validateS1UpstreamRunAuthority(value, {
    authority: options.authority,
    sourceSha: options.sourceSha,
    workflowRunId: options.expectedRunId,
  });
  return {
    valid: errors.length === 0,
    errors,
    path: artifactPath,
    value,
  };
}

function parseOptions(args) {
  const options = {};
  let verify = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--verify") {
      verify = true;
      continue;
    }
    const value = args[index + 1];
    if (
      ![
        "--authority",
        "--source-sha",
        "--expected-run-id",
        "--run-path",
        "--artifacts-path",
        "--output-path",
        "--artifact-path",
      ].includes(name) ||
      !value
    ) {
      throw new Error("S1 upstream run authority arguments are invalid");
    }
    if (name === "--authority") options.authority = value;
    if (name === "--source-sha") options.sourceSha = value;
    if (name === "--expected-run-id") options.expectedRunId = value;
    if (name === "--run-path") options.runPath = value;
    if (name === "--artifacts-path") options.artifactsPath = value;
    if (name === "--output-path") options.outputPath = value;
    if (name === "--artifact-path") options.artifactPath = value;
    index += 1;
  }
  return { options, verify };
}

async function runCli() {
  const { options, verify } = parseOptions(process.argv.slice(2));
  if (verify) {
    if (
      !options.authority ||
      !options.sourceSha ||
      !options.expectedRunId ||
      !options.artifactPath ||
      options.runPath ||
      options.artifactsPath ||
      options.outputPath
    ) {
      throw new Error("S1 upstream authority verify inputs are invalid");
    }
    const result = await verifyS1UpstreamRunAuthorityFile(options);
    if (!result.valid) {
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log(
      `S1 upstream run authority verified: ${result.value.authority} run ${result.value.workflowRunId}`,
    );
    return;
  }
  if (
    !options.authority ||
    !options.sourceSha ||
    !options.expectedRunId ||
    !options.runPath ||
    !options.artifactsPath ||
    !options.outputPath ||
    options.artifactPath
  ) {
    throw new Error("S1 upstream authority write inputs are invalid");
  }
  const result = await writeS1UpstreamRunAuthority(options);
  console.log(
    `S1 upstream run authority written: ${result.authority.authority} run ${result.authority.workflowRunId}`,
  );
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function writeJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
