import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyWindowsHostProductAcceptanceDispatch,
  previewWindowsHostProductAcceptanceDispatch,
  validateWindowsHostProductAcceptanceDispatchPreview,
  validateWindowsHostProductAcceptanceDispatchResult,
} from "./windows-host-product-acceptance-dispatch.mjs";
import { WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES } from "./windows-host-product-acceptance-dispatch-state.mjs";

const execFileAsync = promisify(execFile);
const SOURCE_SHA = "a".repeat(40);
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Windows host acceptance dispatch", () => {
  it.each([
    ["missing", [], [], ["windows_runner_missing"]],
    [
      "offline",
      [runner({ status: "offline" })],
      [],
      ["windows_runner_offline"],
    ],
    ["busy", [runner({ busy: true })], [], ["windows_runner_busy"]],
    [
      "active",
      [runner()],
      [workflowRun({ id: 90, status: "queued" })],
      ["windows_acceptance_run_active"],
    ],
  ])(
    "blocks without dispatch when runner capacity is %s",
    async (_name, runners, runs, blockers) => {
      const fixture = dispatchFixture({ runners, runs });
      const preview =
        await previewWindowsHostProductAcceptanceDispatch(fixture);

      expect(
        validateWindowsHostProductAcceptanceDispatchPreview(preview),
      ).toEqual([]);
      expect(preview).toEqual(
        expect.objectContaining({
          status: "blocked",
          blockers,
          sourceSha: SOURCE_SHA,
          scope: expect.objectContaining({
            dispatchAllowed: false,
            windowsHostProductAcceptance: false,
            s1Complete: false,
          }),
        }),
      );
      expect(fixture.commands).not.toContainEqual(
        expect.arrayContaining(["workflow", "run"]),
      );
      await expect(
        applyWindowsHostProductAcceptanceDispatch({
          ...fixture,
          expectedPreviewSha256: preview.contentSha256,
        }),
      ).rejects.toThrow("capacity is unavailable");
      expect(fixture.commands).not.toContainEqual(
        expect.arrayContaining(["workflow", "run"]),
      );
    },
  );

  it("dispatches once and resolves one exact new source-bound run", async () => {
    const fixture = dispatchFixture({ runners: [runner()], runs: [] });
    const preview = await previewWindowsHostProductAcceptanceDispatch(fixture);
    expect(preview.status).toBe("ready");

    const result = await applyWindowsHostProductAcceptanceDispatch({
      ...fixture,
      expectedPreviewSha256: preview.contentSha256,
    });

    expect(
      validateWindowsHostProductAcceptanceDispatchResult(result, preview),
    ).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        status: "dispatched",
        outcomeCode: "run_identity_verified",
        sourceSha: SOURCE_SHA,
        workflowRunId: "101",
        workflowRunAttempt: "1",
        runStatus: "queued",
        scope: {
          runnerCapacityObserved: true,
          dispatchRequested: true,
          dispatchOutcomeKnown: true,
          acceptanceReceiptVerified: false,
          windowsHostProductAcceptance: false,
          s1Complete: false,
        },
      }),
    );
    expect(fixture.commands).toContainEqual([
      "workflow",
      "run",
      "windows-host-product-acceptance.yml",
      "--repo",
      "github.com/Champ-X/Napier",
      "--ref",
      "main",
      "-f",
      `source_sha=${SOURCE_SHA}`,
    ]);
    const blockedPreview = structuredClone(preview);
    blockedPreview.status = "blocked";
    blockedPreview.blockers = ["windows_runner_busy"];
    blockedPreview.scope.dispatchAllowed = false;
    expect(
      validateWindowsHostProductAcceptanceDispatchResult(
        result,
        blockedPreview,
      ),
    ).not.toEqual([]);
  });

  it("rejects stale/wrong-main/duplicates and reports indeterminate dispatches", async () => {
    const stale = dispatchFixture({ runners: [runner()], runs: [] });
    const preview = await previewWindowsHostProductAcceptanceDispatch(stale);
    stale.runners[0].busy = true;
    await expect(
      applyWindowsHostProductAcceptanceDispatch({
        ...stale,
        expectedPreviewSha256: preview.contentSha256,
      }),
    ).rejects.toThrow("preview is stale");

    const wrongMain = dispatchFixture({
      runners: [runner()],
      runs: [],
      mainSha: "b".repeat(40),
    });
    await expect(
      previewWindowsHostProductAcceptanceDispatch(wrongMain),
    ).rejects.toThrow("not exact current main");

    const duplicateRunners = dispatchFixture({
      runners: [runner({ id: 1 }), runner({ id: 1 })],
      runs: [],
    });
    await expect(
      previewWindowsHostProductAcceptanceDispatch(duplicateRunners),
    ).rejects.toThrow();

    const invalidDispatch = dispatchFixture({
      runners: [runner()],
      runs: [],
      dispatchedRun: workflowRun({
        id: 101,
        status: "queued",
        headSha: "b".repeat(40),
      }),
    });
    const invalidDispatchPreview =
      await previewWindowsHostProductAcceptanceDispatch(invalidDispatch);
    await expect(
      applyWindowsHostProductAcceptanceDispatch({
        ...invalidDispatch,
        expectedPreviewSha256: invalidDispatchPreview.contentSha256,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "indeterminate",
        outcomeCode: "run_identity_invalid",
        workflowRunId: "101",
        scope: expect.objectContaining({
          dispatchRequested: true,
          dispatchOutcomeKnown: false,
        }),
      }),
    );

    const missingUrl = dispatchFixture({
      runners: [runner()],
      runs: [],
      dispatchStdout: "",
    });
    const missingUrlPreview =
      await previewWindowsHostProductAcceptanceDispatch(missingUrl);
    await expect(
      applyWindowsHostProductAcceptanceDispatch({
        ...missingUrl,
        expectedPreviewSha256: missingUrlPreview.contentSha256,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "indeterminate",
        outcomeCode: "run_url_missing",
        workflowRunId: null,
      }),
    );
  });

  it("returns blocked JSON with exit 2 and never leaks gh stderr", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-windows-dispatch-"));
    roots.push(root);
    const ghPath = path.join(root, "gh");
    const gitPath = path.join(root, "git");
    const secret = "windows-dispatch-secret-never-print";
    await Promise.all([
      writeFile(
        ghPath,
        `#!/bin/sh
case "$*" in
  *"/commits/main"*) printf '{"sha":"${SOURCE_SHA}"}' ;;
  *"/actions/runners"*) printf '{"total_count":0,"runners":[]}' ;;
  *"/actions/workflows/"*) printf '{"total_count":0,"workflow_runs":[]}' ;;
  *) printf '%s\n' '${secret}' >&2; exit 1 ;;
esac
`,
      ),
      writeFile(
        gitPath,
        `#!/bin/sh
printf '%s\n' '${SOURCE_SHA}'
`,
      ),
    ]);
    await Promise.all([chmod(ghPath, 0o700), chmod(gitPath, 0o700)]);

    const result = await execFileAsync(
      process.execPath,
      [
        path.resolve(
          "scripts/check-windows-host-product-acceptance-dispatch.mjs",
        ),
        "--repo-root",
        root,
        "--source-sha",
        SOURCE_SHA,
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
          GH_TOKEN: secret,
        },
      },
    ).catch((error) => error);

    expect(result.code).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(secret);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        status: "blocked",
        blockers: ["windows_runner_missing"],
      }),
    );
  });

  it("returns indeterminate after a dispatch request with unknown outcome", async () => {
    const commandFailure = dispatchFixture({
      runners: [runner()],
      runs: [],
      dispatchError: true,
    });
    const commandPreview =
      await previewWindowsHostProductAcceptanceDispatch(commandFailure);
    await expect(
      applyWindowsHostProductAcceptanceDispatch({
        ...commandFailure,
        expectedPreviewSha256: commandPreview.contentSha256,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "indeterminate",
        outcomeCode: "dispatch_command_failed",
        workflowRunId: null,
        scope: expect.objectContaining({
          dispatchRequested: true,
          dispatchOutcomeKnown: false,
        }),
      }),
    );

    const lookupFailure = dispatchFixture({
      runners: [runner()],
      runs: [],
      lookupError: true,
    });
    const lookupPreview =
      await previewWindowsHostProductAcceptanceDispatch(lookupFailure);
    await expect(
      applyWindowsHostProductAcceptanceDispatch({
        ...lookupFailure,
        expectedPreviewSha256: lookupPreview.contentSha256,
        sleep: async () => {},
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "indeterminate",
        outcomeCode: "run_lookup_failed",
        workflowRunId: "101",
      }),
    );
  });

  it("emits indeterminate JSON with exit 3 from the CLI", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-windows-dispatch-"));
    roots.push(root);
    const ghPath = path.join(root, "gh");
    const gitPath = path.join(root, "git");
    await Promise.all([
      writeFile(
        ghPath,
        `#!/bin/sh
case "$*" in
  *"/commits/main"*) printf '{"sha":"${SOURCE_SHA}"}' ;;
  *"/actions/runners"*) printf '{"total_count":1,"runners":[{"id":7,"status":"online","busy":false,"labels":[{"name":"self-hosted"},{"name":"Windows"},{"name":"X64"},{"name":"napier-windows-docker"}]}]}' ;;
  *"/actions/workflows/"*) printf '{"total_count":0,"workflow_runs":[]}' ;;
  "workflow run"*) printf '%s\n' 'https://github.com/Champ-X/Napier/actions/runs/101' ;;
  *"/actions/runs/101"*) printf '{"id":101,"run_attempt":1,"event":"workflow_dispatch","status":"queued","head_branch":"main","head_sha":"${"b".repeat(40)}","path":".github/workflows/windows-host-product-acceptance.yml","display_title":"Windows Docker host acceptance @ ${SOURCE_SHA}","repository":{"full_name":"Champ-X/Napier"},"head_repository":{"full_name":"Champ-X/Napier"}}' ;;
  *) exit 1 ;;
esac
`,
      ),
      writeFile(
        gitPath,
        `#!/bin/sh
printf '%s\n' '${SOURCE_SHA}'
`,
      ),
    ]);
    await Promise.all([chmod(ghPath, 0o700), chmod(gitPath, 0o700)]);

    const preview = await runDispatchCli(root, ["--source-sha", SOURCE_SHA]);
    expect(preview.code).toBe(0);
    const previewValue = JSON.parse(preview.stdout);

    const result = await runDispatchCli(root, [
      "--source-sha",
      SOURCE_SHA,
      "--expected-preview",
      previewValue.contentSha256,
      "--apply",
    ]);

    expect(result.code).toBe(3);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        outcomeCode: "run_identity_invalid",
        workflowRunId: "101",
      }),
    );
  });
});

async function runDispatchCli(root, args) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        path.resolve(
          "scripts/check-windows-host-product-acceptance-dispatch.mjs",
        ),
        "--repo-root",
        root,
        ...args,
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    return { ...result, code: 0 };
  } catch (error) {
    return error;
  }
}

function dispatchFixture({
  runners,
  runs,
  mainSha = SOURCE_SHA,
  dispatchedRun = workflowRun({ id: 101, status: "queued" }),
  dispatchStdout = "https://github.com/Champ-X/Napier/actions/runs/101\n",
  dispatchError = false,
  lookupError = false,
}) {
  const commands = [];
  let dispatched = false;
  const fixture = {
    repoRoot: process.cwd(),
    sourceSha: SOURCE_SHA,
    runners,
    commands,
    runGit: async () => ({ stdout: `${SOURCE_SHA}\n`, stderr: "" }),
    runGh: async (args) => {
      commands.push(args);
      const endpoint = args.at(-1) ?? "";
      if (args[0] === "workflow") {
        dispatched = true;
        if (dispatchError) throw new Error("dispatch failed");
        return { stdout: dispatchStdout, stderr: "" };
      }
      if (endpoint.includes("/commits/main")) {
        return { stdout: JSON.stringify({ sha: mainSha }), stderr: "" };
      }
      if (endpoint.includes("/actions/runners")) {
        return {
          stdout: JSON.stringify({
            total_count: runners.length,
            runners,
          }),
          stderr: "",
        };
      }
      if (endpoint.includes("/actions/workflows/")) {
        const requestedStatus = WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES.find(
          (status) => endpoint.includes(`status=${status}`),
        );
        if (!requestedStatus) throw new Error("missing active run status");
        const observed = runs.filter((run) => run.status === requestedStatus);
        return {
          stdout: JSON.stringify({
            total_count: observed.length,
            workflow_runs: observed,
          }),
          stderr: "",
        };
      }
      if (endpoint.includes("/actions/runs/101") && dispatched) {
        if (lookupError) throw new Error("lookup failed");
        return { stdout: JSON.stringify(dispatchedRun), stderr: "" };
      }
      throw new Error("unexpected gh command");
    },
  };
  return fixture;
}

function runner({ id = 7, status = "online", busy = false } = {}) {
  return {
    id,
    status,
    busy,
    labels: [
      { name: "self-hosted" },
      { name: "Windows" },
      { name: "X64" },
      { name: "napier-windows-docker" },
    ],
  };
}

function workflowRun({ id, status, headSha = SOURCE_SHA }) {
  return {
    id,
    run_attempt: 1,
    event: "workflow_dispatch",
    status,
    conclusion: status === "completed" ? "success" : null,
    head_branch: "main",
    head_sha: headSha,
    path: ".github/workflows/windows-host-product-acceptance.yml",
    display_title: `Windows Docker host acceptance @ ${SOURCE_SHA}`,
    repository: { full_name: "Champ-X/Napier" },
    head_repository: { full_name: "Champ-X/Napier" },
  };
}
