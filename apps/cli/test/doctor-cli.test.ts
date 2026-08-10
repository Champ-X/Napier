import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { canonicalJson, sha256 } from "@napier/runtime";
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
        checkCount: 13,
        passedCount: 13,
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
    expect(report.checkCount).toBe(13);
    expect(report.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "skills",
        "lsp",
        "dap",
        "python",
        "shell",
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
      remediations: Array<{ id: string; priority: string; checkIds: string[] }>;
    };
    expect(report.status).toBe("degraded");
    expect(report.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "prefer_isolated_sandbox",
          priority: "optional",
          checkIds: ["sandbox"],
        }),
      ]),
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
      skills: async () => overrides.skills ?? passed("skills", "skills_ready"),
      lsp: async () => overrides.lsp ?? passed("lsp", "lsp_ready"),
      dap: async () => overrides.dap ?? passed("dap", "dap_ready"),
      python: async () => overrides.python ?? passed("python", "python_ready"),
      shell: async () => overrides.shell ?? passed("shell", "shell_ready"),
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
    "service",
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
