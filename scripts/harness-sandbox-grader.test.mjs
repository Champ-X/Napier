import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  prepareSandboxGrader,
  runSandboxGrader,
} from "./harness-sandbox-grader.mjs";
import { graderEvidenceIdentity } from "./harness-grader-evidence.mjs";
import { createObservedWorkspaceReceipt } from "./harness-observed-workspace.mjs";
import { observation } from "./harness-campaign-test-fixture.mjs";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const seal = ({ contentSha256, ...value }) => ({
  ...value,
  contentSha256: hash(JSON.stringify(value)),
});
const sandbox = () => ({
  id: "oci-container",
  resolveCommandRuntime: async (runtime) => ({
    runtime,
    executable: runtime === "node" ? "/usr/local/bin/node" : "/usr/bin/python3",
    executableSha256: hash(runtime),
    runtimeIdentitySha256: hash("image"),
  }),
});
const exited = {
  status: "exited",
  exitCode: 0,
  signal: null,
  stdout: "pass\n",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
};
async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-grader-test-"));
  try {
    const graderPath = path.join(root, "__napier_external_grader__.mjs");
    await writeFile(path.join(root, "code.py"), "pass\n");
    await writeFile(graderPath, "// oracle\n");
    const adapter = sandbox(),
      configuration = await prepareSandboxGrader(adapter, ["node", "python"]);
    const options = {
      sandbox: adapter,
      configuration,
      runId: "run_one",
      workspaceRoot: root,
      graderPath,
      runSandboxedProcess: async () => ({ ...exited }),
    };
    await work(options);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function reportFor(options, arm = "candidate") {
  const result = await runSandboxGrader(options);
  const report = observation(arm, {
    runId: options.runId,
    sandbox: "oci-container",
    observedWorkspace: createObservedWorkspaceReceipt(options.runId, {
      "code.py": hash("pass\n"),
    }),
    outcomeSha256: hash("// oracle\n"),
    graderConfiguration: options.configuration,
    graderExecution: result.receipt,
    graderExitCode: result.status,
    graderOutput: (result.stdout + result.stderr).slice(0, 8000),
    taskSuccess: result.status === 0,
  });
  report.environmentEvidence = seal({
    ...report.environmentEvidence,
    sandboxId: "oci-container",
  });
  return report;
}

test.each([{}, { id: "host-direct" }, { id: "oci-container" }])(
  "missing OCI/runtime cannot fall back to host: %j",
  async (adapter) => {
    await assert.rejects(prepareSandboxGrader(adapter), /requires OCI/);
  },
);
test.each([["python"], ["node", "node"], ["node", "ruby"]])(
  "invalid runtime declarations fail before launch: %j",
  async (...runtimes) => {
    await assert.rejects(
      prepareSandboxGrader(sandbox(), runtimes),
      /requires OCI/,
    );
  },
);
test("runtime identity must be present and unchanged at grading", async () => {
  await assert.rejects(
    prepareSandboxGrader({
      ...sandbox(),
      resolveCommandRuntime: async () => ({}),
    }),
    /runtime identity/,
  );
  await fixture(async (options) => {
    options.configuration = {
      ...options.configuration,
      contentSha256: hash("changed"),
    };
    options.runSandboxedProcess = async () => assert.fail("must not launch");
    await assert.rejects(runSandboxGrader(options), /configuration changed/);
  });
});
test("resolved interpreter drift rejects grading before process launch", async () =>
  fixture(async (options) => {
    const original = options.sandbox.resolveCommandRuntime;
    options.sandbox.resolveCommandRuntime = async (runtime) => ({
      ...(await original(runtime)),
      executableSha256: hash("changed binary"),
    });
    options.runSandboxedProcess = async () => assert.fail("must not launch");
    await assert.rejects(runSandboxGrader(options), /configuration changed/);
  }));
test.each(["../outside.mjs", "missing.mjs"])(
  "unobserved grader cannot launch: %s",
  async (file) =>
    fixture(async (options) => {
      options.graderPath = path.resolve(options.workspaceRoot, file);
      options.runSandboxedProcess = async () => assert.fail("must not launch");
      await assert.rejects(
        runSandboxGrader(options),
        /inside the observed workspace|regular observed file/,
      );
    }),
);
test("grader uses bound Node, read-only workspace and no network; receipt binds outcome and workspace", async () =>
  fixture(async (options) => {
    options.runSandboxedProcess = async (request) => {
      assert.equal(request.sandbox, options.sandbox);
      assert.equal(request.launch.command, "/usr/local/bin/node");
      assert.deepEqual(request.launch.args, ["__napier_external_grader__.mjs"]);
      assert.deepEqual(request.launch.approvedCapabilities, [
        "workspace.read",
        "process.spawn",
      ]);
      assert.deepEqual(request.launch.env, {
        PATH: "/usr/local/bin:/usr/bin",
        PYTHONDONTWRITEBYTECODE: "1",
      });
      assert.equal(request.launch.workspaceRoot, options.workspaceRoot);
      return { ...exited };
    };
    const report = await reportFor(options);
    assert.equal(
      graderEvidenceIdentity(report),
      options.configuration.contentSha256,
    );
  }));
test.each([
  { status: "timed_out" },
  { status: "output_capped" },
  { stdoutTruncated: true },
  { stderrTruncated: true },
  { signal: "SIGTERM", exitCode: null },
])("incomplete execution cannot pass: %j", async (patch) =>
  fixture(async (options) => {
    options.runSandboxedProcess = async () => ({ ...exited, ...patch });
    const report = await reportFor(options);
    assert.equal(report.taskSuccess, false);
    assert.equal(report.graderExitCode, null);
    assert.equal(graderEvidenceIdentity(report), undefined);
  }),
);
test("mutation cannot pass even if grader exits zero", async () =>
  fixture(async (options) => {
    options.runSandboxedProcess = async () => {
      await writeFile(path.join(options.workspaceRoot, "code.py"), "changed\n");
      return { ...exited };
    };
    const report = await reportFor(options);
    assert.equal(report.graderExecution.workspaceUnchanged, false);
    assert.equal(report.taskSuccess, false);
    assert.equal(graderEvidenceIdentity(report), undefined);
  }));
test("a completed negative grade remains valid evidence", async () =>
  fixture(async (options) => {
    options.runSandboxedProcess = async () => ({ ...exited, exitCode: 1 });
    const report = await reportFor(options);
    assert.equal(report.taskSuccess, false);
    assert.equal(
      graderEvidenceIdentity(report),
      options.configuration.contentSha256,
    );
  }));
test("partial, altered and foreign receipts fail closed, including rehashed contradictions", async () =>
  fixture(async (options) => {
    const report = await reportFor(options);
    const mutations = [
      (r) => {
        delete r.graderExecution;
      },
      (r) => {
        delete r.graderConfiguration;
      },
      (r) => {
        r.graderExecution.exitCode = 1;
      },
      (r) => {
        r.graderExecution = seal({ ...r.graderExecution, runId: "foreign" });
      },
      (r) => {
        r.graderExecution = seal({
          ...r.graderExecution,
          graderSha256: hash("other"),
        });
      },
      (r) => {
        r.graderExecution = seal({ ...r.graderExecution, passed: false });
      },
      (r) => {
        r.graderExecution = seal({
          ...r.graderExecution,
          workspaceBeforeSha256: hash("other"),
          workspaceAfterSha256: hash("other"),
        });
      },
      (r) => {
        r.observedWorkspace = createObservedWorkspaceReceipt(r.runId, {
          "code.py": hash("other"),
        });
      },
      (r) => {
        r.graderOutput = "invented pass";
      },
      (r) => {
        r.graderExitCode = 1;
      },
      (r) => {
        r.graderConfiguration.runtimes[0].executableSha256 = hash("different");
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(report);
      mutate(copy);
      assert.equal(graderEvidenceIdentity(copy), undefined, mutate.toString());
    }
    assert.equal(
      graderEvidenceIdentity({ graderExecution: undefined }),
      undefined,
    );
    assert.equal(graderEvidenceIdentity({}), "legacy-host");
  }));
test("campaign rejects mixed grader modes/runtime identities and retains adverse outcomes", async () =>
  fixture(async (options) => {
    const baseline = await reportFor(
      { ...options, runId: "run_baseline" },
      "baseline",
    );
    const candidate = await reportFor(options);
    const limits = { minimumCases: 1, minimumTrials: 1 };
    assert.equal(
      evaluateCampaignQuality([baseline, candidate], limits).comparablePairs,
      1,
    );
    const host = { ...baseline };
    delete host.graderConfiguration;
    delete host.graderExecution;
    assert.equal(
      evaluateCampaignQuality([host, candidate], limits).comparablePairs,
      0,
    );
    const other = structuredClone(candidate);
    other.graderConfiguration.runtimes[1].runtimeIdentitySha256 =
      hash("new image");
    other.graderConfiguration = seal(other.graderConfiguration);
    other.graderExecution = seal({
      ...other.graderExecution,
      configurationSha256: other.graderConfiguration.contentSha256,
    });
    assert.equal(
      graderEvidenceIdentity(other),
      other.graderConfiguration.contentSha256,
    );
    assert.equal(
      evaluateCampaignQuality([baseline, other], limits).comparablePairs,
      0,
    );
    other.taskSuccess = false;
    const result = evaluateCampaignQuality([baseline, other], limits);
    assert.ok(
      result.regressions.includes("case_one:0: task completion regressed"),
    );
  }));
