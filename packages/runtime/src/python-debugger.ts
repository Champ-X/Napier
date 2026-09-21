import { boundPythonDebugData } from "./python-debugger-data.js";
import path from "node:path";
import type { WorkspaceProcessSession } from "@napier/contracts";
import {
  DapProcessSession,
  type DapProcesses,
  type DapOwner,
} from "./dap-process-session.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  validateActionTimeout,
  validateArguments,
  validateBreakpointLines,
  validateBreakpoints,
  validateSessionTimeout,
  type NodeDebugBreakpoint,
} from "./node-debugger-model.js";
import {
  assertPythonDebuggerRuntimeCurrent,
  resolvePythonDebuggerRuntime,
  type PythonDebuggerRuntime,
} from "./python-debugger-runtime.js";
import type { ToolchainOptions } from "./python-toolchain.js";
import {
  loadWorkspaceSourceFile,
  type WorkspaceSourceFile,
} from "./workspace-source.js";

export type PythonDebugAction =
  | "stack_trace"
  | "scopes"
  | "variables"
  | "evaluate"
  | "continue"
  | "next"
  | "step_in"
  | "step_out"
  | "cancel";
export interface PythonDebuggerLaunchRequest extends DapOwner {
  path: string;
  breakpoints: NodeDebugBreakpoint[];
  args?: string[];
  sessionTimeoutMs?: number;
  actionTimeoutMs?: number;
  signal?: AbortSignal;
}

interface Registration {
  owner: DapOwner;
  source: WorkspaceSourceFile;
  runtime: PythonDebuggerRuntime;
  protocol: DapProcessSession;
  session: WorkspaceProcessSession;
  busy: boolean;
  lifetime: AbortController;
  frames: Set<number>;
  references: Set<number>;
}

/** Run-owned debugpy sessions over existing private Process I/O. No durable
 * replay of debugger commands, expression evaluation or program execution. */
export class PythonDebuggerManager {
  private readonly registrations = new Map<string, Registration>();
  private readonly pending = new Map<
    AbortController,
    { owner: DapOwner; done: Promise<unknown> }
  >();
  constructor(
    private readonly processes: DapProcesses,
    private readonly options: ToolchainOptions,
  ) {}

  launch(request: PythonDebuggerLaunchRequest) {
    const lifetime = new AbortController();
    const signal = request.signal
      ? AbortSignal.any([request.signal, lifetime.signal])
      : lifetime.signal;
    const done = this.launchSession({ ...request, signal }, lifetime);
    this.pending.set(lifetime, { owner: request, done });
    return done.finally(() => this.pending.delete(lifetime));
  }

  private async launchSession(
    request: PythonDebuggerLaunchRequest,
    lifetime: AbortController,
  ) {
    const actionTimeout = request.actionTimeoutMs ?? 10000;
    const sessionTimeout = request.sessionTimeoutMs ?? 120000;
    validateActionTimeout(actionTimeout);
    validateSessionTimeout(sessionTimeout);
    validateBreakpoints(request.breakpoints);
    validateArguments(request.args ?? []);
    this.evictTerminated();
    if (this.registrations.size + this.pending.size >= 64)
      throw new Error("Python debugger session limit reached");
    const source = await this.source(request.path);
    validateBreakpointLines(request.breakpoints, source.source);
    const runtime = await resolvePythonDebuggerRuntime(
      this.options,
      request.signal,
    );
    await assertPythonDebuggerRuntimeCurrent(runtime, this.options);
    const session = await this.processes.startPrivateProtocol({
      threadId: request.threadId,
      runId: request.runId,
      ...(runtime.location === "host"
        ? { toolchainEnvironment: "workspace" as const }
        : {}),
      command: {
        runtime: "python",
        args: ["-I", "-B", "-m", "debugpy.adapter"],
        cwd: ".",
        timeoutMs: sessionTimeout,
      },
      interactive: true,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const registration: Registration = {
      owner: { threadId: request.threadId, runId: request.runId },
      source,
      runtime,
      session,
      protocol: new DapProcessSession(this.processes, request, session.id),
      busy: true,
      lifetime,
      frames: new Set(),
      references: new Set(),
    };
    this.registrations.set(session.id, registration);
    try {
      if (
        session.executableSha256 !== runtime.executableSha256 ||
        session.sandbox !== this.options.sandbox.id
      )
        throw new Error(
          "Python debugger launch identity differs from its probe",
        );
      await this.source(source.path, source.fileSha256);
      const p = registration.protocol;
      const protocolRoot =
        runtime.protocolWorkspaceRoot ?? source.workspaceRoot;
      const program = runtime.protocolWorkspaceRoot
        ? path.posix.join(protocolRoot, ...source.path.split(path.sep))
        : source.target;
      const deadline = Date.now() + actionTimeout;
      await p.request(
        "initialize",
        {
          clientID: "napier",
          adapterID: "python",
          pathFormat: "path",
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsRunInTerminalRequest: false,
        },
        deadline,
        request.signal,
      );
      const launch = await p.send(
        "launch",
        {
          type: "python",
          request: "launch",
          program,
          cwd: protocolRoot,
          python: [runtime.executable, "-B"],
          args: request.args ?? [],
          console: "internalConsole",
          justMyCode: true,
        },
        request.signal,
      );
      await p.event("initialized", deadline, request.signal);
      const bound = await p.request(
        "setBreakpoints",
        { source: { path: program }, breakpoints: request.breakpoints },
        deadline,
        request.signal,
      );
      if (
        !Array.isArray(bound.breakpoints) ||
        bound.breakpoints.length !== request.breakpoints.length ||
        bound.breakpoints.some(
          (b, i) =>
            !record(b) ||
            b.verified !== true ||
            b.line !== request.breakpoints[i]!.line,
        )
      )
        throw new Error(
          "Python debugger could not bind the requested source breakpoints",
        );
      await p.request("configurationDone", {}, deadline, request.signal);
      await p.response(launch, deadline, request.signal);
      await p.event("stopped", deadline, request.signal);
      return await this.result(registration, "launch", {
        breakpointCount: request.breakpoints.length,
      });
    } catch (error) {
      await this.stop(registration);
      throw error;
    } finally {
      registration.busy = false;
    }
  }

  async execute(
    request: DapOwner & {
      processId: string;
      action: PythonDebugAction;
      frameId?: number;
      variablesReference?: number;
      expression?: string;
      actionTimeoutMs?: number;
      signal?: AbortSignal;
    },
  ) {
    const r = this.owned(request);
    request = {
      ...request,
      signal: request.signal
        ? AbortSignal.any([request.signal, r.lifetime.signal])
        : r.lifetime.signal,
    };
    const timeout = request.actionTimeoutMs ?? 10000;
    validateActionTimeout(timeout);
    if (request.action === "cancel") {
      if (r.busy) {
        await this.stop(r);
        return this.result(r, "cancel", {});
      }
      r.busy = true;
      try {
        if (r.protocol.state !== "terminated") {
          await r.protocol
            .request(
              "disconnect",
              { terminateDebuggee: true },
              Date.now() + timeout,
              request.signal,
            )
            .catch(() => undefined);
          await r.protocol.closeInput().catch(() => undefined);
        }
        await this.stop(r);
        return this.result(r, "cancel", {});
      } finally {
        r.busy = false;
      }
    }
    if (r.busy) throw new Error("Python debugger has an operation in progress");
    if (r.protocol.state !== "paused")
      throw new Error("Python debugger is not paused");
    this.validateReference(r, request);
    r.busy = true;
    try {
      if (request.signal?.aborted)
        throw new Error("Python debugger operation was cancelled");
      await this.source(r.source.path, r.source.fileSha256);
      await assertPythonDebuggerRuntimeCurrent(r.runtime, this.options);
      const deadline = Date.now() + timeout;
      const p = r.protocol;
      let data: Record<string, unknown>;
      if (request.action === "stack_trace") {
        data = await p.request(
          "stackTrace",
          { threadId: p.threadId, startFrame: 0, levels: 32 },
          deadline,
          request.signal,
        );
        this.remember(r.frames, data.stackFrames, "id");
      } else if (request.action === "scopes") {
        data = await p.request(
          "scopes",
          { frameId: request.frameId },
          deadline,
          request.signal,
        );
        this.remember(r.references, data.scopes, "variablesReference");
      } else if (request.action === "variables") {
        data = await p.request(
          "variables",
          {
            variablesReference: request.variablesReference,
            start: 0,
            count: 32,
          },
          deadline,
          request.signal,
        );
        this.remember(r.references, data.variables, "variablesReference");
      } else if (request.action === "evaluate") {
        // Python evaluation is execution. The tool surface does not
        // inherit the Node inspector's throwOnSideEffect/read-only semantics.
        data = await p.request(
          "evaluate",
          {
            expression: request.expression,
            frameId: request.frameId,
            context: "watch",
          },
          deadline,
          request.signal,
        );
        this.remember(r.references, [data], "variablesReference");
      } else {
        const command = {
          continue: "continue",
          next: "next",
          step_in: "stepIn",
          step_out: "stepOut",
        }[request.action];
        if (!command) throw new Error("Unknown Python debugger action");
        r.frames.clear();
        r.references.clear();
        p.discardEvents("stopped");
        data = await p.request(
          command,
          { threadId: p.threadId },
          deadline,
          request.signal,
        );
        await p.settled(deadline, request.signal);
        if (p.state === "terminated") {
          await p.closeInput().catch(() => undefined);
          await this.stop(r);
        }
      }
      return this.result(r, request.action, data);
    } catch (error) {
      await this.stop(r);
      throw error;
    } finally {
      r.busy = false;
    }
  }

  async cancelRun(owner: DapOwner): Promise<void> {
    const pending = [...this.pending].filter(
      ([, p]) =>
        p.owner.threadId === owner.threadId && p.owner.runId === owner.runId,
    );
    for (const [controller] of pending) controller.abort();
    await Promise.allSettled(pending.map(([, p]) => p.done));
    const results = await Promise.allSettled(
      [...this.registrations.values()]
        .filter(
          (r) =>
            r.owner.threadId === owner.threadId &&
            r.owner.runId === owner.runId,
        )
        .map((r) => this.stop(r)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  private source(path: string, expectedSha256?: string) {
    return loadWorkspaceSourceFile(this.options.workspaceRoot, path, {
      label: "Python debugger",
      extensions: new Set([".py"]),
      maxBytes: 1024 * 1024,
      extensionError: "Python debugger requires a Python source file",
      ...(expectedSha256 ? { expectedSha256 } : {}),
    });
  }

  private owned(owner: DapOwner & { processId: string }) {
    const r = this.registrations.get(owner.processId);
    if (
      !r ||
      r.owner.runId !== owner.runId ||
      r.owner.threadId !== owner.threadId
    )
      throw new Error("Python debugger session is not owned by this Run");
    return r;
  }

  private async stop(r: Registration) {
    r.lifetime.abort();
    await r.protocol.closeInput().catch(() => undefined);
    r.session = await this.processes.cancel(r.owner.threadId, r.session.id);
    r.protocol.state = "terminated";
    r.frames.clear();
    r.references.clear();
  }

  private evictTerminated() {
    for (const [id, r] of this.registrations)
      if (r.protocol.state === "terminated") this.registrations.delete(id);
  }

  private validateReference(
    r: Registration,
    request: {
      action: PythonDebugAction;
      frameId?: number;
      variablesReference?: number;
      expression?: string;
    },
  ) {
    if (request.action === "scopes" || request.action === "evaluate") {
      if (!r.frames.has(request.frameId!))
        throw new Error("Python debugger frame is stale or unobserved");
    } else if (request.frameId !== undefined)
      throw new Error("Unexpected Python debugger frame");
    if (request.action === "variables") {
      if (!r.references.has(request.variablesReference!))
        throw new Error(
          "Python debugger variable reference is stale or unobserved",
        );
    } else if (request.variablesReference !== undefined)
      throw new Error("Unexpected Python debugger variable reference");
    if (request.action === "evaluate") {
      if (!request.expression?.trim() || request.expression.length > 500)
        throw new Error("Python debugger expression is invalid");
    } else if (request.expression !== undefined)
      throw new Error("Unexpected Python debugger expression");
  }

  private remember(target: Set<number>, values: unknown, key: string) {
    if (!Array.isArray(values))
      throw new Error("Python debugger response list is invalid");
    for (const value of values.slice(0, 32)) {
      if (
        !record(value) ||
        !Number.isSafeInteger(value[key]) ||
        Number(value[key]) < 0
      )
        throw new Error("Python debugger reference is invalid");
      if (Number(value[key]) > 0) target.add(Number(value[key]));
      if (target.size > 128)
        throw new Error("Python debugger reference limit exceeded");
    }
  }

  private async result(
    r: Registration,
    action: PythonDebugAction | "launch",
    data: Record<string, unknown>,
  ) {
    const current = (await this.processes.list(r.owner.threadId)).find(
      (s) => s.id === r.session.id,
    );
    if (!current || current.runId !== r.owner.runId)
      throw new Error("Python debugger Process evidence is missing");
    const bounded = boundPythonDebugData(data);
    const content = {
      kind: "napier.python-debugger" as const,
      schemaVersion: 1,
      action,
      processId: r.session.id,
      state: r.protocol.state,
      processStatus: current.status,
      sandbox: current.sandbox,
      isolation: r.runtime.isolation,
      sourcePath: r.source.path,
      sourceSha256: r.source.fileSha256,
      runtimeIdentitySha256: r.runtime.identitySha256,
      pythonVersion: r.runtime.pythonVersion,
      ...(r.protocol.exitCode !== undefined
        ? { debuggeeExitCode: r.protocol.exitCode }
        : {}),
      debugpyVersion: r.runtime.debugpyVersion,
      protocol: r.protocol.evidence(),
      data: bounded.value,
      dataTruncated: bounded.truncated,
      output: r.protocol.output,
      outputTruncated: r.protocol.outputTruncated,
    };
    return { ...content, resultSha256: sha256(canonicalJson(content)) };
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
