import { access } from "node:fs/promises";
import path from "node:path";

import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliDoctorOptions } from "./cli-doctor-options.js";
import type { CliIo } from "./cli-runtime.js";
import {
  createPlatformSandboxAdapter,
} from "@napier/runtime/code";
import {
  CredentialReferenceStore,
} from "@napier/runtime/governance";
import {
  LocalStore,
} from "@napier/runtime/store";
import { createConfiguredSandboxAdapter } from "@napier/runtime/sandbox-installation";
import {
  createDoctorReport,
  formatDoctorReport,
  type DoctorReport,
} from "./doctor-report.js";
import {
  runDoctorProbes,
  type DoctorProbeDependencies,
} from "./doctor-probes.js";
import type { DoctorCredentialReferenceStatus } from "./doctor-check-model.js";
import { canonicalWorkspace } from "./workspace-path.js";

export async function executeDoctor(
  options: CliDoctorOptions,
  io: CliIo,
  dependencies: DoctorProbeDependencies = {},
  parentSignal?: AbortSignal,
): Promise<number> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
  let workspaceReady = false;
  let loadingSandbox = false;
  let store: LocalStore | undefined;
  try {
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    workspaceReady = true;
    const dataRoot = path.resolve(
      io.cwd,
      options.dataRoot ?? path.join(workspaceRoot, ".napier"),
    );
    const credentialInspection = await inspectCredentialReferences(
      options,
      workspaceRoot,
      dataRoot,
      io.env,
    );
    store = credentialInspection.store;
    loadingSandbox = true;
    const sandbox =
      (await createConfiguredSandboxAdapter({
        dataRoot,
        env: io.env,
      })) ?? createPlatformSandboxAdapter();
    loadingSandbox = false;
    signal.throwIfAborted();
    const checks = await withinSignal(
      runDoctorProbes({
        options,
        workspaceRoot,
        dataRoot,
        env: io.env,
        signal,
        dependencies,
        credentialReferences: credentialInspection.statuses,
        sandbox,
      }),
      signal,
    );
    const report = createDoctorReport({
      online: options.online,
      workspace: workspaceRoot,
      ...(options.model ? { model: options.model } : {}),
      checks,
    });
    await writeDoctorReport(report, options.jsonl, io);
    return report.status === "blocked" ? 1 : 0;
  } catch (error) {
    const report = createDoctorReport({
      online: options.online,
      workspace: path.resolve(io.cwd, options.workspace),
      ...(options.model ? { model: options.model } : {}),
      checks: [
        {
          id: signal.aborted
            ? "runtime"
            : workspaceReady && loadingSandbox
              ? "sandbox"
              : "workspace",
          status: workspaceReady && loadingSandbox ? "warning" : "failed",
          required: !(workspaceReady && loadingSandbox),
          code: signal.aborted
            ? "doctor_cancelled"
            : workspaceReady && loadingSandbox
              ? "sandbox_configured_invalid"
              : "workspace_unavailable",
          message: signal.aborted
            ? "Doctor was cancelled or exceeded its time budget"
            : workspaceReady && loadingSandbox
              ? "The persisted Sandbox configuration is invalid or unreadable; process tasks fail closed until exact-preview Sandbox setup repairs it"
              : "Workspace is missing, inaccessible, or not a directory",
          durationMs: 0,
        },
      ],
    });
    await writeDoctorReport(report, options.jsonl, io);
    return report.status === "blocked" ? 1 : 0;
  } finally {
    store?.close();
  }
}

async function inspectCredentialReferences(
  options: CliDoctorOptions,
  workspaceRoot: string,
  dataRoot: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<{
  store?: LocalStore;
  statuses: ReadonlyMap<string, DoctorCredentialReferenceStatus>;
}> {
  const providers = new Set<string>();
  if (
    options.model &&
    options.model.provider !== "napier" &&
    !options.credentialEnv
  ) {
    providers.add(options.model.provider);
  }
  if (
    options.browserBackend === "browser_use_cloud" &&
    !options.credentialEnv
  ) {
    providers.add("browser-use");
  }
  if (providers.size === 0) return { statuses: new Map() };
  if (!(await hasPersistedWorkspace(dataRoot))) {
    return {
      statuses: new Map(
        [...providers].map((provider) => [provider, "missing"] as const),
      ),
    };
  }
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const credentials = new CredentialReferenceStore({ store, env });
  const statuses = new Map<string, DoctorCredentialReferenceStatus>();
  for (const provider of providers) {
    try {
      const credential = await credentials.read(provider);
      statuses.set(
        provider,
        credential?.type === "api_key" && credential.key?.trim()
          ? "available"
          : "missing",
      );
    } catch {
      statuses.set(provider, "error");
    }
  }
  return { store, statuses };
}

async function hasPersistedWorkspace(dataRoot: string): Promise<boolean> {
  try {
    await Promise.any([
      access(path.join(dataRoot, "ledger.sqlite")),
      access(path.join(dataRoot, "workspace.json")),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function writeDoctorReport(
  report: DoctorReport,
  jsonl: boolean,
  io: CliIo,
): Promise<void> {
  if (jsonl) {
    await writeJsonLine(io.stdout, report);
    return;
  }
  await writeLine(io.stdout, formatDoctorReport(report));
}

async function withinSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Doctor was cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
    void operation.catch(() => undefined);
  }
}
