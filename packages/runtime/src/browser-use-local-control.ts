import { createHash } from "node:crypto";

export type BrowserUseLocalControlState = "running" | "paused" | "takeover";

export interface BrowserUseLocalControlObservation {
  type: "control";
  backend: "browser_use_local";
  state: BrowserUseLocalControlState;
  pauseAvailable: boolean;
  takeoverAvailable: boolean;
  browserVisibility: "visible";
  message: string;
}

export interface BrowserUseLocalControlDependencies {
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  schedule?: (operation: () => void, delayMs: number) => void;
}

export class BrowserUseLocalError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly diagnosticSha256: string,
    readonly recovery: string,
  ) {
    super(message);
    this.name = "BrowserUseLocalError";
  }
}

export class BrowserUseLocalProcessControl {
  readonly #platform: NodeJS.Platform;
  readonly #kill: (pid: number, signal: NodeJS.Signals) => void;
  readonly #schedule: (operation: () => void, delayMs: number) => void;
  #active: { pid: number; state: BrowserUseLocalControlState } | undefined;
  #terminating = false;

  constructor(dependencies: BrowserUseLocalControlDependencies = {}) {
    this.#platform = dependencies.platform ?? process.platform;
    this.#kill = dependencies.kill ?? process.kill;
    this.#schedule =
      dependencies.schedule ??
      ((operation, delayMs) => {
        setTimeout(operation, delayMs);
      });
  }

  get available(): boolean {
    return this.#platform !== "win32";
  }

  get active(): boolean {
    return this.#active !== undefined;
  }

  attach(pid: number): void {
    if (this.#active) {
      throw controlError(
        "A Browser Use local process is already active",
        "browser_task_busy",
        "Stop the active local browser task before starting another",
      );
    }
    this.#active = { pid, state: "running" };
    this.#terminating = false;
  }

  detach(pid: number): void {
    if (this.#active?.pid === pid) this.#active = undefined;
  }

  pause(): BrowserUseLocalControlObservation {
    const active = this.#controllable();
    if (active.state === "running") this.#signal(active.pid, "SIGSTOP");
    active.state = "paused";
    return this.#observation(
      "paused",
      "Agent paused immediately; the visible local browser remains open.",
    );
  }

  takeover(): BrowserUseLocalControlObservation {
    const active = this.#controllable();
    if (active.state === "running") this.#signal(active.pid, "SIGSTOP");
    active.state = "takeover";
    return this.#observation(
      "takeover",
      "Agent paused; use the visible local browser, then Resume agent.",
    );
  }

  resume(): BrowserUseLocalControlObservation {
    const active = this.#controllable();
    if (active.state !== "running") this.#signal(active.pid, "SIGCONT");
    active.state = "running";
    return this.#observation(
      "running",
      "Agent resumed and will re-observe the current browser page.",
    );
  }

  terminate(): void {
    const active = this.#active;
    if (!active || this.#terminating) return;
    this.#terminating = true;
    if (this.available && active.state !== "running") {
      try {
        this.#kill(active.pid, "SIGCONT");
      } catch {
        // The process may already have exited.
      }
    }
    const target = this.#platform === "win32" ? active.pid : -active.pid;
    try {
      this.#kill(target, "SIGTERM");
    } catch {
      // The isolated process group may already have exited.
    }
    this.#schedule(() => {
      try {
        this.#kill(target, "SIGKILL");
      } catch {
        // Graceful termination already cleaned up the process group.
      }
    }, 1_000);
  }

  #controllable(): { pid: number; state: BrowserUseLocalControlState } {
    if (!this.available) {
      throw controlError(
        "Browser Use local Pause and Take over are unavailable on this host",
        "browser_control_unavailable",
        "Use Stop, or run the local backend on macOS or Linux",
      );
    }
    if (!this.#active) {
      throw controlError(
        "Browser Use local task is not running",
        "browser_task_not_running",
        "Start a fresh local browser task",
      );
    }
    return this.#active;
  }

  #signal(pid: number, signal: NodeJS.Signals): void {
    try {
      this.#kill(pid, signal);
    } catch {
      throw controlError(
        "Browser Use local control could not reach the agent process",
        "browser_control_failed",
        "Stop the task, run Doctor, then start a fresh local task",
      );
    }
  }

  #observation(
    state: BrowserUseLocalControlState,
    message: string,
  ): BrowserUseLocalControlObservation {
    return {
      type: "control",
      backend: "browser_use_local",
      state,
      pauseAvailable: this.available,
      takeoverAvailable: this.available,
      browserVisibility: "visible",
      message,
    };
  }
}

function controlError(
  message: string,
  code: string,
  recovery: string,
): BrowserUseLocalError {
  return new BrowserUseLocalError(
    message,
    code,
    createHash("sha256").update(message).digest("hex"),
    recovery,
  );
}
