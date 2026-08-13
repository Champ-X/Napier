import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { canonicalJson, LocalStore, sha256 } from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCliArgs, runCli } from "../src/cli.js";
import type { CliIo, RunCliDependencies } from "../src/cli-runtime.js";
import type { DoctorCheck } from "../src/doctor-report.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier Doctor CLI", () => {
  it("parses online, offline, model, and timeout options", () => {
    expect(
      parseCliArgs([
        "doctor",
        "--workspace",
        ".",
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        "DEEPSEEK_API_KEY",
        "--timeout-ms",
        "5000",
        "--offline",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "doctor",
      options: {
        workspace: ".",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        credentialEnv: "DEEPSEEK_API_KEY",
        timeoutMs: 5_000,
        online: false,
        jsonl: true,
      },
    });
    expect(parseCliArgs(["doctor", "--help"])).toEqual({ kind: "help" });
    expect(() => parseCliArgs(["doctor"])).toThrow("--workspace is required");
    expect(() =>
      parseCliArgs([
        "doctor",
        "--workspace",
        ".",
        "--credential-env",
        "DEEPSEEK_API_KEY",
      ]),
    ).toThrow("--credential-env requires a live --model");
  });

  it("returns a hash-bound ready report without creating workspace state", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        "DOCTOR_PRIVATE_KEY",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, stderr, {
        DOCTOR_PRIVATE_KEY: "TEST_CREDENTIAL_SENTINEL",
      }),
      doctorDependencies({
        model: passed("model", "credential_available"),
        sandbox: passed("sandbox", "sandbox_ready"),
        search: passed("search", "search_ready"),
        fetch: passed("fetch", "fetch_ready"),
        browser: passed("browser", "browser_ready"),
      }),
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    const report = JSON.parse(stdout.text()) as Record<string, unknown>;
    expect(report).toEqual(
      expect.objectContaining({
        kind: "napier.doctor-report",
        schemaVersion: 2,
        status: "ready",
        online: true,
        checkCount: 15,
        passedCount: 15,
        warningCount: 0,
        failedCount: 0,
        skippedCount: 0,
        remediationCount: 0,
        remediations: [],
      }),
    );
    const { contentSha256, ...withoutHash } = report;
    expect(contentSha256).toBe(sha256(canonicalJson(withoutHash as never)));
    expect(stdout.text()).not.toContain(fixture.workspace);
    expect(stdout.text()).not.toContain("DOCTOR_PRIVATE_KEY");
    expect(stdout.text()).not.toContain("TEST_CREDENTIAL_SENTINEL");
    await expect(
      access(path.join(fixture.workspace, ".napier")),
    ).rejects.toThrow();
  });

  it("uses active model and Browser Use credential references without exposing secrets", async () => {
    const fixture = await createFixture();
    const dataRoot = path.join(fixture.workspace, ".napier");
    const store = new LocalStore({
      workspaceRoot: fixture.workspace,
      dataRoot,
    });
    await store.initialize();
    await store.createCredentialReference({
      providerId: "deepseek",
      label: "Doctor model reference",
      source: {
        type: "environment",
        variable: "NAPIER_DOCTOR_MODEL_KEY",
      },
    });
    await store.createCredentialReference({
      providerId: "browser-use",
      label: "Doctor Browser Use reference",
      source: {
        type: "environment",
        variable: "NAPIER_DOCTOR_BROWSER_KEY",
      },
    });
    store.close();
    const stdout = new CaptureWritable();
    const dependencies = doctorDependencies({});
    delete dependencies.doctor?.model;
    delete dependencies.doctor?.browserUseCloud;

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "deepseek/deepseek-v4-flash",
        "--browser-backend",
        "browser_use_cloud",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable(), {
        NAPIER_DOCTOR_MODEL_KEY: "private-model-key",
        NAPIER_DOCTOR_BROWSER_KEY: "private-browser-key",
      }),
      dependencies,
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as { checks: DoctorCheck[] };
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "model",
          status: "passed",
          code: "credential_reference_available",
          evidence: expect.objectContaining({
            credentialSource: "active_reference",
          }),
        }),
        expect.objectContaining({
          id: "browser_use_cloud",
          status: "passed",
          code: "browser_use_cloud_configured",
          evidence: expect.objectContaining({
            credentialSource: "active_reference",
            readinessBilling: false,
          }),
        }),
      ]),
    );
    expect(stdout.text()).not.toContain("private-model-key");
    expect(stdout.text()).not.toContain("private-browser-key");
    expect(stdout.text()).not.toContain("NAPIER_DOCTOR_MODEL_KEY");
    expect(stdout.text()).not.toContain("NAPIER_DOCTOR_BROWSER_KEY");
  });

  it("reports a missing active reference without initializing workspace state", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const dependencies = doctorDependencies({});
    delete dependencies.doctor?.model;

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "deepseek/deepseek-v4-flash",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      dependencies,
    );

    expect(code).toBe(1);
    expect(JSON.parse(stdout.text())).toMatchObject({
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "model",
          status: "failed",
          code: "credential_reference_missing",
        }),
      ]),
      remediations: expect.arrayContaining([
        expect.objectContaining({
          id: "configure_model_credential_reference",
        }),
      ]),
    });
    await expect(
      access(path.join(fixture.workspace, ".napier")),
    ).rejects.toThrow();
  });

  it("reports offline mode as degraded while skipping network and Browser", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const onlineProbe = vi.fn(async () => passed("search", "search_ready"));

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies(
        {
          model: passed("model", "demo_model_ready"),
          sandbox: warning("sandbox", "sandbox_unavailable"),
        },
        onlineProbe,
      ),
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      skippedCount: number;
      checks: DoctorCheck[];
      remediations: Array<{ id: string; priority: string }>;
    };
    expect(report.status).toBe("degraded");
    expect(report.skippedCount).toBe(3);
    expect(
      report.checks.filter((check) => check.code === "offline_mode"),
    ).toHaveLength(3);
    expect(report.remediations).toEqual([
      expect.objectContaining({
        id: "repair_process_sandbox",
        priority: "optional",
      }),
      expect.objectContaining({
        id: "run_online_checks",
        priority: "optional",
      }),
    ]);
    expect(onlineProbe).not.toHaveBeenCalled();
  });

  it("blocks a selected Browser Use local backend with an exact setup recovery", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--browser-backend",
        "browser_use_local",
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: passed("model", "demo_model_ready"),
        browser_use_local: failed(
          "browser_use_local",
          "browser_use_local_missing",
        ),
      }),
    );
    expect(code).toBe(1);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      checks: DoctorCheck[];
      remediations: Array<{ id: string; verifyCommand: string }>;
    };
    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser_use_local",
          required: true,
          status: "failed",
        }),
      ]),
    );
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "install_browser_use_local",
          verifyCommand: expect.stringContaining(
            "--component browser-use-local",
          ),
        }),
      ]),
    );
  });

  it("reports Cloud credential readiness without creating a billable task", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--browser-backend",
        "browser_use_cloud",
        "--credential-env",
        "BROWSER_USE_API_KEY",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        browser_use_cloud: failed(
          "browser_use_cloud",
          "browser_use_cloud_credential_missing",
        ),
      }),
    );
    expect(code).toBe(1);
    const report = JSON.parse(stdout.text()) as {
      checks: DoctorCheck[];
      remediations: Array<{ id: string; verifyCommand: string }>;
    };
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser_use_cloud",
          required: true,
          status: "failed",
        }),
      ]),
    );
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "configure_browser_use_cloud_credential",
          verifyCommand: expect.stringContaining("--offline"),
        }),
      ]),
    );
  });

  it("returns blocked with fixed recovery codes for credential and network failures", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        "MISSING_DOCTOR_KEY",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: failed("model", "credential_missing"),
        sandbox: passed("sandbox", "sandbox_ready"),
        search: failed("search", "search_unavailable"),
        fetch: passed("fetch", "fetch_ready"),
        browser: failed("browser", "browser_missing"),
      }),
    );

    expect(code).toBe(1);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      failedCount: number;
      checks: DoctorCheck[];
      remediationCount: number;
      remediations: Array<{
        id: string;
        priority: string;
        checkIds: string[];
        codes: string[];
        verifyCommand: string;
        automatic: boolean;
      }>;
    };
    expect(report.status).toBe("blocked");
    expect(report.failedCount).toBe(3);
    expect(report.checks.map((check) => check.code)).toEqual(
      expect.arrayContaining([
        "credential_missing",
        "search_unavailable",
        "browser_missing",
      ]),
    );
    expect(report.remediationCount).toBe(3);
    expect(report.remediations).toEqual([
      expect.objectContaining({
        id: "configure_model_credential",
        priority: "required",
        checkIds: ["model"],
        codes: ["credential_missing"],
        verifyCommand: expect.stringContaining(
          "--credential-env 'CREDENTIAL_ENV_VAR'",
        ),
        automatic: false,
      }),
      expect.objectContaining({
        id: "install_supported_browser",
        priority: "required",
        checkIds: ["browser"],
        codes: ["browser_missing"],
        automatic: false,
      }),
      expect.objectContaining({
        id: "repair_public_network",
        priority: "required",
        checkIds: ["search"],
        codes: ["search_unavailable"],
        verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH'",
        automatic: false,
      }),
    ]);
    expect(stdout.text()).not.toContain("MISSING_DOCTOR_KEY");
  });

  it("renders privacy-safe human remediation without executing it", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        "PRIVATE_DOCTOR_KEY",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: failed("model", "credential_missing"),
        sandbox: passed("sandbox", "sandbox_ready"),
        search: failed("search", "search_unavailable"),
        fetch: failed("fetch", "fetch_unavailable"),
        browser: failed("browser", "browser_unavailable"),
      }),
    );

    expect(code).toBe(1);
    expect(stdout.text()).toContain("Remediation:");
    expect(stdout.text()).toContain("REQUIRED configure_model_credential");
    expect(stdout.text()).toContain("REQUIRED repair_public_network");
    expect(stdout.text()).toContain("--workspace 'WORKSPACE_PATH'");
    expect(stdout.text()).toContain("--credential-env 'CREDENTIAL_ENV_VAR'");
    expect(stdout.text()).not.toContain(fixture.workspace);
    expect(stdout.text()).not.toContain("PRIVATE_DOCTOR_KEY");
    expect(stdout.text().match(/repair_public_network/gu)).toHaveLength(1);
  });

  it("fails closed for missing workspaces and cancellation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-missing-"));
    roots.push(root);
    const missingOutput = new CaptureWritable();
    const missingCode = await runCli(
      [
        "doctor",
        "--workspace",
        path.join(root, "missing"),
        "--offline",
        "--jsonl",
      ],
      cliIo(root, missingOutput, new CaptureWritable()),
    );
    expect(missingCode).toBe(1);
    expect(JSON.parse(missingOutput.text())).toEqual(
      expect.objectContaining({
        status: "blocked",
        checks: [expect.objectContaining({ code: "workspace_unavailable" })],
        remediations: [
          expect.objectContaining({
            id: "select_workspace",
            priority: "required",
            automatic: false,
          }),
        ],
      }),
    );

    const fixture = await createFixture();
    const cancelledOutput = new CaptureWritable();
    const controller = new AbortController();
    controller.abort();
    const cancelledCode = await runCli(
      ["doctor", "--workspace", fixture.workspace, "--offline", "--jsonl"],
      cliIo(fixture.root, cancelledOutput, new CaptureWritable()),
      doctorDependencies({}),
      controller.signal,
    );
    expect(cancelledCode).toBe(1);
    expect(JSON.parse(cancelledOutput.text())).toEqual(
      expect.objectContaining({
        checks: [
          expect.objectContaining({
            id: "runtime",
            code: "doctor_cancelled",
          }),
        ],
        remediations: [
          expect.objectContaining({
            id: "retry_doctor",
            priority: "required",
            automatic: false,
          }),
        ],
      }),
    );
  });
  it("checks local Skills, LSP, DAP, Python, Shell, and service readiness", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: passed("model", "demo_model_ready"),
        sandbox: passed("sandbox", "sandbox_ready"),
        python: warning("python", "python_missing"),
      }),
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      checkCount: number;
      checks: DoctorCheck[];
      remediations: Array<{ id: string; priority: string; checkIds: string[] }>;
    };
    expect(report.checkCount).toBe(15);
    expect(report.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "skills",
        "lsp",
        "dap",
        "python",
        "shell",
        "verification",
        "service",
      ]),
    );
    const python = report.checks.find((check) => check.id === "python");
    expect(python).toEqual(
      expect.objectContaining({ status: "warning", required: false }),
    );
    expect(report.status).toBe("degraded");
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repair_python_runtime",
          priority: "optional",
          checkIds: ["python"],
        }),
      ]),
    );
  });

  it("flags host-direct execution as a no-isolation warning", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: passed("model", "demo_model_ready"),
        sandbox: warning("sandbox", "sandbox_host_direct"),
      }),
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      remediations: Array<{
        id: string;
        priority: string;
        checkIds: string[];
        instruction: string;
      }>;
    };
    expect(report.status).toBe("degraded");
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "prefer_isolated_sandbox",
          priority: "optional",
          checkIds: ["sandbox"],
          instruction: expect.stringContaining(
            "napier setup --workspace 'WORKSPACE_PATH' --component sandbox",
          ),
        }),
      ]),
    );
    expect(report.remediations[0]?.instruction).not.toContain(
      "NAPIER_CONTAINER_SANDBOX_IMAGE",
    );
  });

  it("provides a fixed recovery step when the active sandbox has no Git", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: passed("model", "demo_model_ready"),
        sandbox: warning("sandbox", "sandbox_git_unavailable"),
      }),
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      remediations: Array<{
        id: string;
        priority: string;
        checkIds: string[];
        codes: string[];
      }>;
    };
    expect(report.status).toBe("degraded");
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repair_git_runtime",
          priority: "optional",
          checkIds: ["sandbox"],
          codes: ["sandbox_git_unavailable"],
        }),
      ]),
    );
  });

  it("does not report OCI ready when dynamic resource proof fails", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: passed("model", "demo_model_ready"),
        sandbox: warning("sandbox", "sandbox_resources_unavailable"),
      }),
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      remediations: Array<{
        id: string;
        priority: string;
        checkIds: string[];
        codes: string[];
        instruction: string;
      }>;
    };
    expect(report.status).toBe("degraded");
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repair_sandbox_resources",
          priority: "optional",
          checkIds: ["sandbox"],
          codes: ["sandbox_resources_unavailable"],
          instruction: expect.stringContaining("Rerun Sandbox setup"),
        }),
      ]),
    );
  });

  it("guides container sandbox enablement when a container runtime is available", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: passed("model", "demo_model_ready"),
        sandbox: warning("sandbox", "sandbox_container_available"),
      }),
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      remediations: Array<{ id: string; priority: string; checkIds: string[] }>;
    };
    expect(report.status).toBe("degraded");
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "enable_container_sandbox",
          priority: "optional",
          checkIds: ["sandbox"],
        }),
      ]),
    );
  });

  it("preserves configured OCI intent when the local daemon is unavailable", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      doctorDependencies({
        model: passed("model", "demo_model_ready"),
        sandbox: warning("sandbox", "sandbox_configured_unavailable"),
      }),
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as {
      remediations: Array<{
        id: string;
        instruction: string;
        verifyCommand: string;
      }>;
    };
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repair_configured_sandbox",
          instruction: expect.stringContaining("same local Docker daemon"),
          verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
        }),
      ]),
    );
  });

  it("reports an invalid persisted Sandbox configuration without blaming the workspace", async () => {
    const fixture = await createFixture();
    const dataRoot = path.join(fixture.workspace, ".napier");
    await mkdir(dataRoot);
    await writeFile(path.join(dataRoot, "sandbox.json"), '{"invalid":true}\n');
    const stdout = new CaptureWritable();

    const code = await runCli(
      [
        "doctor",
        "--workspace",
        fixture.workspace,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      cliIo(fixture.root, stdout, new CaptureWritable()),
      { createRuntime: vi.fn() },
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text()) as {
      status: string;
      checks: DoctorCheck[];
      remediations: Array<{ id: string }>;
    };
    expect(report.status).toBe("degraded");
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "sandbox",
        status: "warning",
        required: false,
        code: "sandbox_configured_invalid",
      }),
    ]);
    expect(report.remediations).toEqual([
      expect.objectContaining({ id: "repair_invalid_sandbox" }),
    ]);
  });
});

function doctorDependencies(
  overrides: Partial<Record<DoctorCheck["id"], DoctorCheck>>,
  onlineProbe?: () => Promise<DoctorCheck>,
): RunCliDependencies {
  return {
    createRuntime: vi.fn(),
    doctor: {
      runtime: async () =>
        overrides.runtime ?? passed("runtime", "runtime_ready"),
      model: async () =>
        overrides.model ?? warning("model", "model_not_selected"),
      sandbox: async () =>
        overrides.sandbox ?? passed("sandbox", "sandbox_ready"),
      search:
        onlineProbe ??
        (async () => overrides.search ?? passed("search", "search_ready")),
      fetch: async () => overrides.fetch ?? passed("fetch", "fetch_ready"),
      browser: async () =>
        overrides.browser ?? passed("browser", "browser_ready"),
      browserUseLocal: async () =>
        overrides.browser_use_local ??
        passed("browser_use_local", "browser_use_local_ready"),
      browserUseCloud: async () =>
        overrides.browser_use_cloud ??
        passed("browser_use_cloud", "browser_use_cloud_configured"),
      skills: async () => overrides.skills ?? passed("skills", "skills_ready"),
      lsp: async () => overrides.lsp ?? passed("lsp", "lsp_ready"),
      dap: async () => overrides.dap ?? passed("dap", "dap_ready"),
      python: async () => overrides.python ?? passed("python", "python_ready"),
      shell: async () => overrides.shell ?? passed("shell", "shell_ready"),
      verification: async () =>
        overrides.verification ?? passed("verification", "verification_ready"),
      service: async () =>
        overrides.service ?? passed("service", "service_ready"),
    },
  };
}

function passed(id: DoctorCheck["id"], code: string): DoctorCheck {
  const optional = new Set<DoctorCheck["id"]>([
    "model",
    "sandbox",
    "skills",
    "lsp",
    "dap",
    "python",
    "shell",
    "verification",
    "service",
    "browser_use_local",
    "browser_use_cloud",
  ]);
  return {
    id,
    status: "passed",
    required: !optional.has(id),
    code,
    message: "ready",
    durationMs: 1,
  };
}

function warning(id: DoctorCheck["id"], code: string): DoctorCheck {
  return {
    id,
    status: "warning",
    required: false,
    code,
    message: "degraded",
    durationMs: 1,
  };
}

function failed(id: DoctorCheck["id"], code: string): DoctorCheck {
  return {
    id,
    status: "failed",
    required: true,
    code,
    message: "blocked",
    durationMs: 1,
  };
}

async function createFixture(): Promise<{ root: string; workspace: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-test-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  return { root, workspace };
}

function cliIo(
  cwd: string,
  stdout: Writable,
  stderr: Writable,
  env: Readonly<Record<string, string | undefined>> = {},
): CliIo {
  return { cwd, env, stdout, stderr };
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}
