import { realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./ed25519.js";
import { readWorkspaceTextEvidence } from "./tools.js";
import { captureVerificationWorkspace } from "./verification-workspace-snapshot.js";
import { selectWriteLinkedTests } from "./write-linked-test-selection.js";
import { PYTHON_TEST_GRAPH_SCRIPT } from "./python-test-graph-script.js";
import {
  normalizeToolchainCommand,
  runPythonToolchainCommand,
  toolchainPath,
  type ToolchainOptions,
} from "./python-toolchain.js";

export interface AffectedTestSelection {
  runtime: "node" | "python";
  mode: "selected" | "full_suite_fallback";
  selectedTests: string[];
  reasons: string[];
  workspaceSnapshotSha256: string;
  graphSha256: string;
  changedFileSetSha256: string;
  selectionSha256: string;
  snapshotComplete: boolean;
}

/** Selection narrows execution only with a complete static graph and a fresh
 * workspace snapshot. Unknown/no-match/configuration cases retain full scope. */
export async function selectAffectedTests(
  options: ToolchainOptions,
  input: {
    runtime: "node" | "python";
    affectedBy: string[];
    cwd?: string;
    timeoutMs?: number;
  },
  signal?: AbortSignal,
): Promise<AffectedTestSelection> {
  const root = await realpath(options.workspaceRoot);
  const cwd = await toolchainPath(root, root, input.cwd ?? ".");
  const changedFiles = await readAffectedSources(root, cwd, input.affectedBy);
  const before = await captureVerificationWorkspace(root, signal);
  let selectedTests: string[] = [];
  let reasons: string[] = [];
  let graphSha256 = sha256("unavailable");
  const extensions = input.runtime === "python" ? /\.py$/u : /\.[cm]?[jt]sx?$/u;
  if (changedFiles.some((file) => !extensions.test(file.path))) {
    reasons.push("configuration_or_unsupported_source");
  } else if (input.runtime === "node") {
    const selection = await selectWriteLinkedTests({
      workspaceRoot: root,
      changedFiles,
    });
    selectedTests = selection.selectedTests;
    graphSha256 = selection.selectionSnapshotSha256;
    if (!selection.complete) reasons.push("incomplete_node_graph");
  } else {
    const relativeChanges = changedFiles.map((file) =>
      path.relative(cwd, path.join(root, file.path)).split(path.sep).join("/"),
    );
    const code = `CHANGED_JSON = ${JSON.stringify(JSON.stringify(relativeChanges))}\n${PYTHON_TEST_GRAPH_SCRIPT}`;
    // Very long path sets retain full verification instead of exceeding the
    // same inline command bounds used by the public Python tool.
    if (Buffer.byteLength(code, "utf8") > 8192) {
      reasons.push("graph_input_limit");
    } else {
      const command = normalizeToolchainCommand({
        runtime: "python",
        cwd: input.cwd ?? ".",
        code,
        timeoutMs: input.timeoutMs ?? 15_000,
      });
      const result = await runPythonToolchainCommand(
        options,
        { ...command, args: ["-I", "-S", ...command.args] },
        signal,
      );
      if (
        result.details.status !== "succeeded" ||
        result.details.stdoutTruncated ||
        result.details.stderrTruncated
      ) {
        reasons.push("python_graph_unavailable");
      } else {
        const graph = parsePythonGraph(result.stdout);
        reasons = graph.issues;
        graphSha256 = graph.graphSha256;
        selectedTests = graph.selectedTests.map((file) =>
          path.relative(root, path.join(cwd, file)).split(path.sep).join("/"),
        );
        if (!graph.complete && reasons.length === 0)
          reasons.push("incomplete_python_graph");
      }
    }
  }
  const after = await captureVerificationWorkspace(root, signal);
  if (before.truncated || after.truncated) reasons.push("snapshot_incomplete");
  if (before.sha256 !== after.sha256)
    reasons.push("workspace_changed_during_selection");
  if (selectedTests.length === 0) reasons.push("no_static_match");
  const content = {
    runtime: input.runtime,
    mode: reasons.length
      ? ("full_suite_fallback" as const)
      : ("selected" as const),
    selectedTests,
    reasons: [...new Set(reasons)].sort(),
    workspaceSnapshotSha256: after.sha256,
    graphSha256,
    changedFileSetSha256: sha256(canonicalJson(changedFiles)),
    snapshotComplete: !after.truncated,
  };
  return { ...content, selectionSha256: sha256(canonicalJson(content)) };
}

async function readAffectedSources(
  root: string,
  cwd: string,
  affectedBy: string[],
) {
  if (
    !Array.isArray(affectedBy) ||
    affectedBy.length < 1 ||
    affectedBy.length > 16
  )
    throw new Error(
      "affectedBy must contain 1-16 changed paths relative to cwd",
    );
  const changedFiles = [];
  for (const target of affectedBy) {
    if (
      typeof target !== "string" ||
      !target ||
      target.length > 500 ||
      path.isAbsolute(target)
    )
      throw new Error("Invalid affected test path");
    const absolute = await toolchainPath(root, cwd, target);
    const relative = path.relative(cwd, absolute);
    if (relative.startsWith(`..${path.sep}`) || relative === "..")
      throw new Error("affectedBy path escapes cwd");
    const observed = await readWorkspaceTextEvidence(root, {
      path: path.relative(root, absolute),
    });
    changedFiles.push({
      path: path.relative(root, absolute).split(path.sep).join("/"),
      expectedSha256: observed.fileSha256,
    });
  }
  return changedFiles;
}

function parsePythonGraph(text: string): {
  selectedTests: string[];
  complete: boolean;
  issues: string[];
  graphSha256: string;
} {
  const graph = JSON.parse(text) as Record<string, unknown>;
  if (
    !Array.isArray(graph.selectedTests) ||
    graph.selectedTests.length > 8 ||
    !graph.selectedTests.every(
      (p) =>
        typeof p === "string" &&
        p.endsWith(".py") &&
        !path.isAbsolute(p) &&
        !p.split(/[\\/]/u).includes(".."),
    ) ||
    typeof graph.complete !== "boolean" ||
    !Array.isArray(graph.issues) ||
    !graph.issues.every((p) => typeof p === "string") ||
    typeof graph.graphSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(graph.graphSha256)
  )
    throw new Error("Invalid Python test graph evidence");
  return graph as unknown as ReturnType<typeof parsePythonGraph>;
}
