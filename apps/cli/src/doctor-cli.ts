import path from "node:path";

import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliDoctorOptions } from "./cli-doctor-options.js";
import type { CliIo } from "./cli-runtime.js";
import {
  createDoctorReport,
  formatDoctorReport,
  type DoctorReport,
} from "./doctor-report.js";
import {
  runDoctorProbes,
  type DoctorProbeDependencies,
} from "./doctor-probes.js";
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
  try {
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    signal.throwIfAborted();
    const checks = await withinSignal(
      runDoctorProbes({
        options,
        workspaceRoot,
        env: io.env,
        signal,
        dependencies,
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
          id: signal.aborted ? "runtime" : "workspace",
          status: "failed",
          required: true,
          code: signal.aborted ? "doctor_cancelled" : "workspace_unavailable",
          message: signal.aborted
            ? "Doctor was cancelled or exceeded its time budget"
            : "Workspace is missing, inaccessible, or not a directory",
          durationMs: 0,
        },
      ],
    });
    await writeDoctorReport(report, options.jsonl, io);
    return 1;
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
