import type { AgentTool } from "@earendil-works/pi-agent-core";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { canonicalJson, sha256 } from "./ed25519.js";
import { captureVerificationWorkspace } from "./verification-workspace-snapshot.js";
import { selectAffectedTests } from "./affected-test-selection.js";
import type {
  ToolchainOptions,
  ToolchainVerificationRequest,
} from "./python-toolchain.js";

type Result = Awaited<ReturnType<AgentTool["execute"]>>;

export async function verifyAffectedTests(
  options: ToolchainOptions,
  input: ToolchainVerificationRequest & {
    runtime: "node" | "python";
    affectedBy: string[];
  },
  verify: (request: ToolchainVerificationRequest) => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> {
  if (input.kind !== "test" || input.target !== undefined)
    throw new Error(
      "affectedBy supports kind=test and cannot be combined with target",
    );
  const started = performance.now();
  const deadline = started + (input.timeoutMs ?? 60_000);
  const selection = await selectAffectedTests(
    options,
    { ...input, timeoutMs: Math.min(input.timeoutMs ?? 60_000, 15_000) },
    signal,
  );
  const root = await realpath(options.workspaceRoot);
  const before = await captureVerificationWorkspace(root, signal);
  let mode = selection.mode;
  const reasons = [...selection.reasons];
  if (before.sha256 !== selection.workspaceSnapshotSha256 || before.truncated) {
    mode = "full_suite_fallback";
    reasons.push("selection_not_current");
  }
  // Node's reverse graph includes cross-package dependents. Execute root-relative
  // targets rather than silently discarding tests outside the requested cwd.
  const cwd = input.runtime === "node" ? "." : (input.cwd ?? ".");
  const targets =
    mode === "selected"
      ? selection.selectedTests.map(
          (target) =>
            path.relative(path.resolve(root, cwd), path.join(root, target)) ||
            ".",
        )
      : ["."];
  const results: Result[] = [];
  let status = "passed";
  for (const target of targets) {
    signal?.throwIfAborted();
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1_000) {
      status = "timed_out";
      break;
    }
    const result = await verify({
      kind: "test",
      runtime: input.runtime,
      cwd,
      target,
      timeoutMs: remaining,
      ...(input.verifier ? { verifier: input.verifier } : {}),
      ...(input.testRunner ? { testRunner: input.testRunner } : {}),
    });
    results.push(result);
    if (result.details.status !== "passed") {
      status = String(result.details.status);
      break;
    }
  }
  const after = await captureVerificationWorkspace(root, signal);
  const snapshotStatus =
    before.truncated || after.truncated
      ? "indeterminate"
      : before.sha256 === after.sha256
        ? "unchanged"
        : "changed";
  if (snapshotStatus !== "unchanged") status = "failed";
  const body = results
    .flatMap((result) =>
      result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text),
    )
    .join("\n\n");
  const outputTruncated = body.length > 64_000;
  if (outputTruncated && status === "passed") status = "capped";
  const details = {
    kind: "test",
    runtime: input.runtime,
    status,
    sandbox: options.sandbox.id,
    selectionMode: mode,
    selectionSha256: selection.selectionSha256,
    selectionReasonsJson: JSON.stringify(reasons),
    selectedTestCount: mode === "selected" ? targets.length : 0,
    completedVerificationCount: results.length,
    selectedTestSetSha256: sha256(canonicalJson(targets)),
    verificationResultSetSha256: sha256(
      canonicalJson(results.map((result) => result.details)),
    ),
    workspaceSnapshotSha256: before.sha256,
    workspaceSnapshotScope: "workspace",
    observedWorkspaceSnapshotSha256: after.sha256,
    workspaceSnapshotTruncated: before.truncated || after.truncated,
    snapshotStatus,
    scopeSha256: sha256(
      canonicalJson({
        runtime: input.runtime,
        cwd,
        targets,
        workspaceSnapshotSha256: before.sha256,
      }),
    ),
    cwdPathSha256: sha256(cwd),
    targetPathSha256: sha256(canonicalJson(targets)),
    durationMs: performance.now() - started,
    stdoutTruncated: outputTruncated,
  };
  return {
    content: [
      {
        type: "text",
        text: [
          `Affected-test verification ${status.toUpperCase()}: ${mode}`,
          "Static dependency selection is not evidence of complete behavioral coverage.",
          reasons.length
            ? `Selection limits: ${reasons.join(", ")}; full test scope retained.`
            : `Selected tests: ${selection.selectedTests.join(", ")}`,
          `Workspace snapshot: ${snapshotStatus}`,
          body.slice(0, 64_000),
        ].join("\n"),
      },
    ],
    details: { ...details, resultSha256: sha256(canonicalJson(details)) },
  };
}
