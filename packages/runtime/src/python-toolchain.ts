import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  CommandRunner,
  type CommandExecutionRequest,
  type CommandRunnerOptions,
} from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { captureVerificationWorkspace } from "./verification-workspace-snapshot.js";

export type ToolchainOptions = CommandRunnerOptions;
export type ToolchainCommandRequest = Omit<CommandExecutionRequest, "args"> & {
  args?: string[];
  code?: string;
};

export function normalizeToolchainCommand(
  input: ToolchainCommandRequest,
): CommandExecutionRequest {
  if (input.code === undefined) {
    if (!Array.isArray(input.args))
      throw new Error(
        "Command args are required unless Python code is supplied",
      );
    return { ...input, args: input.args };
  }
  if (
    input.runtime !== "python" ||
    input.args !== undefined ||
    typeof input.code !== "string" ||
    !input.code.trim() ||
    Buffer.byteLength(input.code, "utf8") > 8192
  )
    throw new Error(
      "Python code must be 1-8192 bytes; omit args when supplying code",
    );
  const encoded = Buffer.from(input.code, "utf8").toString("base64");
  const chunks = encoded.match(/.{1,1800}/gu) ?? [];
  return {
    runtime: "python",
    args: [
      "-B",
      "-c",
      "import base64,sys; exec(compile(base64.b64decode(''.join(sys.argv[1:])), '<napier-python>', 'exec'))",
      ...chunks,
    ],
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  };
}

export interface ToolchainVerificationRequest {
  runtime?: "node" | "python";
  kind: "test" | "typecheck" | "format" | "syntax";
  cwd?: string;
  target?: string;
  affectedBy?: string[];
  verifier?: "unittest" | "pytest" | "mypy" | "ruff";
  testRunner?: "node-test" | "vitest";
  timeoutMs?: number;
}

/** Resolve only explicit workspace environments. A broken .venv is an error,
 * never permission to silently run tests against an unrelated global Python. */
export async function pythonToolchainOptions(
  options: CommandRunnerOptions,
  cwd = ".",
): Promise<CommandRunnerOptions> {
  const root = await realpath(options.workspaceRoot);
  const directory = await toolchainPath(root, root, cwd);
  const envRoot = path.join(directory, ".venv");
  try {
    await lstat(envRoot);
  } catch (error) {
    if (missing(error)) return options;
    throw error;
  }
  const canonicalEnv = await toolchainPath(root, directory, ".venv");
  if (!(await stat(canonicalEnv)).isDirectory())
    throw new Error("Python .venv must be a directory");
  const executable = path.join(canonicalEnv, "bin/python3");
  await stat(executable);
  return {
    ...options,
    executables: { ...options.executables, python: executable },
  };
}

export async function runPythonToolchainCommand(
  options: CommandRunnerOptions,
  request: CommandExecutionRequest,
  signal?: AbortSignal,
) {
  return new CommandRunner(
    await pythonToolchainOptions(options, request.cwd),
  ).run(request, signal);
}

export async function verifyPythonToolchain(
  options: CommandRunnerOptions,
  request: ToolchainVerificationRequest,
  signal?: AbortSignal,
) {
  const root = await realpath(options.workspaceRoot);
  const cwd = await toolchainPath(root, root, request.cwd ?? ".");
  if (!(await stat(cwd)).isDirectory())
    throw new Error("verification cwd must be a directory");
  const target = await toolchainPath(root, cwd, request.target ?? ".");
  const verifier = selectPythonVerifier(request);
  const executionOptions = await pythonToolchainOptions(options, request.cwd);
  if (["pytest", "mypy", "ruff"].includes(verifier)) {
    const executable = executionOptions.executables?.python;
    if (!executable)
      throw new Error(
        "Third-party Python verification requires a workspace .venv with the verifier installed",
      );
    const config = await readFile(
      path.resolve(executable, "../../pyvenv.cfg"),
      "utf8",
    );
    if (!/^include-system-site-packages\s*=\s*false\s*$/mu.test(config))
      throw new Error(
        "Verification .venv must exclude unbound system site packages",
      );
  }
  const args = pythonVerificationArgs(
    verifier,
    target,
    (await stat(target)).isDirectory(),
    cwd,
  );
  // Full workspace scope includes imports outside cwd and local environments.
  // A bounded/incomplete snapshot may execute, but cannot attest stable success.
  const before = await captureVerificationWorkspace(root, signal);
  const result = await new CommandRunner(executionOptions).run(
    {
      runtime: "python",
      args,
      cwd: path.relative(root, cwd) || ".",
      timeoutMs: request.timeoutMs ?? 60_000,
    },
    signal,
  );
  const after = await captureVerificationWorkspace(root, signal);
  const snapshotStatus =
    before.truncated || after.truncated
      ? "indeterminate"
      : before.sha256 === after.sha256
        ? "unchanged"
        : "changed";
  const status =
    snapshotStatus !== "unchanged"
      ? "failed"
      : result.details.status === "succeeded"
        ? "passed"
        : result.details.status;
  const details = {
    ...result.details,
    kind: request.kind,
    status,
    runtime: "python" as const,
    cwd: path.relative(root, cwd) || ".",
    target: path.relative(root, target) || ".",
    targetPathSha256: sha256(path.relative(root, target) || "."),
    verifier,
    verifierSha256: sha256(canonicalJson({ verifier, args })),
    toolchainSha256: sha256(
      canonicalJson({
        executable: result.details.executableSha256,
        assets: result.details.runtimeAssetSetSha256 ?? "",
        provider: result.details.runtimeIdentitySha256 ?? "",
      }),
    ),
    workspaceSnapshotSha256: before.sha256,
    workspaceSnapshotScope: "workspace",
    observedWorkspaceSnapshotSha256: after.sha256,
    workspaceSnapshotFileCount: before.fileCount,
    workspaceSnapshotBytes: before.bytes,
    workspaceSnapshotTruncated: before.truncated || after.truncated,
    snapshotStatus,
    scopeSha256: sha256(
      canonicalJson({
        runtime: "python",
        kind: request.kind,
        verifier,
        cwd: path.relative(root, cwd),
        target: path.relative(root, target),
        workspaceSnapshotSha256: before.sha256,
      }),
    ),
  };
  return {
    content: [
      {
        type: "text" as const,
        text: [
          `Verification ${status.toUpperCase()}: python/${request.kind} (${verifier})`,
          request.kind === "syntax"
            ? "Syntax compilation only; this does not check types or execute tests."
            : "",
          `Sandbox: ${details.sandbox}`,
          ...(details.sandbox === "host-direct"
            ? ["Isolation: none (host-direct)"]
            : []),
          `Workspace snapshot: ${before.sha256} (${snapshotStatus})`,
          ...(snapshotStatus === "unchanged"
            ? []
            : [
                "Verification evidence is not current; inspect changes and rerun.",
              ]),
          "STDOUT",
          result.stdout || "(empty)",
          "STDERR",
          result.stderr || "(empty)",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    details: { ...details, resultSha256: sha256(canonicalJson(details)) },
  };
}

function selectPythonVerifier(request: ToolchainVerificationRequest) {
  if (request.kind === "syntax" && request.verifier === undefined)
    return "syntax";
  if (
    request.kind === "test" &&
    (!request.verifier || ["pytest", "unittest"].includes(request.verifier))
  )
    return request.verifier ?? "unittest";
  if (
    request.kind === "typecheck" &&
    (!request.verifier || request.verifier === "mypy")
  )
    return "mypy";
  if (
    request.kind === "format" &&
    (!request.verifier || request.verifier === "ruff")
  )
    return "ruff";
  throw new Error(
    "Python verifier does not support the requested verification kind",
  );
}

function pythonVerificationArgs(
  verifier: string,
  target: string,
  directory: boolean,
  cwd: string,
): string[] {
  if (verifier === "pytest")
    return ["-I", "-B", "-m", "pytest", "-p", "no:cacheprovider", "--", target];
  if (verifier === "mypy")
    return [
      "-I",
      "-B",
      "-m",
      "mypy",
      "--no-incremental",
      "--cache-dir=/dev/null",
      "--",
      target,
    ];
  if (verifier === "ruff")
    return [
      "-I",
      "-B",
      "-m",
      "ruff",
      "format",
      "--check",
      "--no-cache",
      "--",
      target,
    ];
  // Use stdlib code without creating .pyc or importing source for syntax checks.
  const source =
    verifier === "syntax"
      ? [
          "import pathlib, sys",
          "p = pathlib.Path(sys.argv[1])",
          "files = sorted(p.rglob('*.py')) if p.is_dir() else [p]",
          "files = [f for f in files if not any(s in ('.venv', '.git', 'node_modules', '__pycache__') for s in f.parts) and not f.is_symlink()]",
          "if not files: raise SystemExit('No Python source files selected')",
          "for f in files: compile(f.read_bytes(), str(f), 'exec', dont_inherit=True)",
          "print('Syntax checked:', len(files))",
        ]
      : [
          "import pathlib, sys, unittest",
          "sys.path.insert(0, sys.argv[2])",
          "p = pathlib.Path(sys.argv[1])",
          "loader = unittest.TestLoader()",
          directory
            ? "suite = loader.discover(str(p), pattern='test*.py')"
            : "suite = loader.discover(str(p.parent), pattern=p.name)",
          "if suite.countTestCases() == 0: raise SystemExit('No tests collected; select a test directory/file or verifier=pytest')",
          "result = unittest.TextTestRunner(verbosity=2).run(suite)",
          "raise SystemExit(0 if result.wasSuccessful() else 1)",
        ];
  return [
    "-I",
    "-B",
    "-c",
    `exec(${JSON.stringify(source.join("\n"))})`,
    target,
    cwd,
  ];
}

export async function toolchainPath(
  root: string,
  cwd: string,
  candidate: string,
) {
  if (
    !candidate ||
    candidate.length > 500 ||
    path.isAbsolute(candidate) ||
    /[\u0000-\u001f\u007f]/u.test(candidate)
  )
    throw new Error("Toolchain path must be workspace-relative");
  const lexical = path.resolve(cwd, candidate);
  inside(root, lexical);
  const resolved = await realpath(lexical);
  inside(root, resolved);
  return resolved;
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Toolchain path escapes the workspace");
}

function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
