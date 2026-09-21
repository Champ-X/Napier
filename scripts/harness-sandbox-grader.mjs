import { createHash } from "node:crypto";
import path from "node:path";
import { inventorySuiteTree } from "./harness-suite.mjs";
import { createObservedWorkspaceReceipt } from "./harness-observed-workspace.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const validHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** Prepare before any model request. No implicit host-interpreter fallback. */
export async function prepareSandboxGrader(sandbox, runtimes = ["node"]) {
  if (
    sandbox?.id !== "oci-container" ||
    typeof sandbox.resolveCommandRuntime !== "function" ||
    !Array.isArray(runtimes) ||
    !runtimes.includes("node") ||
    new Set(runtimes).size !== runtimes.length ||
    runtimes.some((runtime) => !["node", "python"].includes(runtime))
  )
    throw new Error(
      "Sandbox grading requires OCI and explicit node/python runtimes",
    );
  const bindings = [];
  for (const runtime of runtimes) {
    const binding = await sandbox.resolveCommandRuntime(runtime);
    if (
      binding?.runtime !== runtime ||
      !path.posix.isAbsolute(binding.executable) ||
      !validHash(binding.executableSha256) ||
      !validHash(binding.runtimeIdentitySha256)
    )
      throw new Error("Missing image-bound grader runtime identity");
    bindings.push({
      runtime,
      executable: binding.executable,
      executableSha256: binding.executableSha256,
      runtimeIdentitySha256: binding.runtimeIdentitySha256,
    });
  }
  const content = {
    kind: "napier.harness-grader-configuration",
    schemaVersion: 1,
    mode: "sandbox",
    sandboxId: sandbox.id,
    runtimes: bindings,
  };
  return Object.freeze({
    ...content,
    runtimes: Object.freeze(bindings.map((binding) => Object.freeze(binding))),
    contentSha256: hash(JSON.stringify(content)),
  });
}

/** Run the trusted oracle after the Agent stops, using that Agent's adapter.
 * The model workspace is read-only; grader failure never becomes a host retry. */
export async function runSandboxGrader({
  sandbox,
  configuration,
  runSandboxedProcess,
  runId,
  workspaceRoot,
  graderPath,
  timeoutMs = 30_000,
  maxOutputChars = 256 * 1024,
}) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxOutputChars) ||
    maxOutputChars < 1 ||
    typeof runId !== "string" ||
    !runId
  )
    throw new Error("Invalid grader execution limits or Run identity");
  const current = await prepareSandboxGrader(
    sandbox,
    configuration.runtimes.map((binding) => binding.runtime),
  );
  if (JSON.stringify(current) !== JSON.stringify(configuration))
    throw new Error("Grader runtime configuration changed");
  const relative = path.relative(workspaceRoot, graderPath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Grader must be inside the observed workspace");
  const before = await inventorySuiteTree(workspaceRoot);
  if (!before[relative])
    throw new Error("Grader is not a regular observed file");
  const observedFiles = { ...before };
  delete observedFiles[relative];
  const observedWorkspace = createObservedWorkspaceReceipt(
    runId,
    observedFiles,
  );
  const node = configuration.runtimes.find(
    (binding) => binding.runtime === "node",
  );
  const result = await runSandboxedProcess({
    sandbox,
    launch: {
      command: node.executable,
      args: [relative],
      cwd: workspaceRoot,
      workspaceRoot,
      env: {
        PATH: [
          ...new Set(
            configuration.runtimes.map((binding) =>
              path.posix.dirname(binding.executable),
            ),
          ),
        ].join(":"),
        PYTHONDONTWRITEBYTECODE: "1",
      },
      approvedCapabilities: ["workspace.read", "process.spawn"],
      parentDeathGuard: true,
    },
    timeoutMs,
    maxOutputChars,
    abortedMessage: "External grader execution aborted",
  });
  const after = await inventorySuiteTree(workspaceRoot);
  const beforeHash = createObservedWorkspaceReceipt(
      runId,
      before,
    ).contentSha256,
    afterHash = createObservedWorkspaceReceipt(runId, after).contentSha256;
  const observationComplete =
    result.status === "exited" &&
    Number.isInteger(result.exitCode) &&
    result.signal === null &&
    !result.stdoutTruncated &&
    !result.stderrTruncated &&
    beforeHash === afterHash;
  const content = {
    kind: "napier.harness-grader-execution",
    schemaVersion: 1,
    runId,
    configurationSha256: configuration.contentSha256,
    graderSha256: before[relative],
    graderRelativePath: relative,
    observedWorkspaceSha256: observedWorkspace.contentSha256,
    workspaceBeforeSha256: beforeHash,
    workspaceAfterSha256: afterHash,
    workspaceUnchanged: beforeHash === afterHash,
    processStatus: result.status,
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutSha256: hash(result.stdout),
    stderrSha256: hash(result.stderr),
    reportOutputSha256: hash((result.stdout + result.stderr).slice(0, 8000)),
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    observationComplete,
    passed: observationComplete && result.exitCode === 0,
  };
  return {
    status: observationComplete ? result.exitCode : null,
    stdout: result.stdout,
    stderr: result.stderr,
    receipt: { ...content, contentSha256: hash(JSON.stringify(content)) },
  };
}
