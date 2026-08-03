import { spawn } from "node:child_process";

const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;

export function normalizeOmpUsage(output) {
  const parsed = parseMachineJson(output);
  if (parsed === undefined) return undefined;
  const candidates = [];
  collectUsageCandidates(parsed, candidates, 0);
  return candidates.find(
    (candidate) =>
      candidate.inputTokens !== undefined ||
      candidate.outputTokens !== undefined,
  );
}

export function directComparisonSandbox() {
  return {
    id: "trusted-outer-direct-comparison",
    async launch(request) {
      return spawnSandboxProcess(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
      });
    },
  };
}

export async function runComparisonProcess(input) {
  const startedAt = performance.now();
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  const append = (field, chunk) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) terminateChild(child);
    if (field === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk) => append("stdout", chunk));
  child.stderr.on("data", (chunk) => append("stderr", chunk));
  const timer = setTimeout(() => terminateChild(child), input.timeoutMs);
  const { code } = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) =>
      resolve({ code: exitCode, signal }),
    );
  }).finally(() => clearTimeout(timer));
  return {
    code,
    stdout,
    stderr,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export function zeroComparisonUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

function collectUsageCandidates(value, candidates, depth) {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUsageCandidates(entry, candidates, depth + 1);
    }
    return;
  }
  const candidate = normalizeUsageObject(value);
  if (candidate) candidates.push(candidate);
  for (const nested of Object.values(value)) {
    collectUsageCandidates(nested, candidates, depth + 1);
  }
}

function normalizeUsageObject(value) {
  const inputTokens = firstNumber(value, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
  ]);
  const outputTokens = firstNumber(value, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
  ]);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const costUsd = firstNumber(value, ["costUsd", "cost_usd", "cost"]);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

function firstNumber(value, keys) {
  for (const key of keys) {
    const candidate = value[key];
    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 0
    ) {
      return candidate;
    }
  }
  return undefined;
}

function parseMachineJson(output) {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/u);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // Continue through non-JSON log lines.
      }
    }
    return undefined;
  }
}

function spawnSandboxProcess(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exit = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exit,
    async terminate() {
      terminateChild(child);
      await exit;
    },
  };
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
