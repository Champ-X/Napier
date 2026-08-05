import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const TERMINATION_GRACE_MS = 1_000;

export async function runOpenWebComparisonProcess(input) {
  const startedAt = performance.now();
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let firstOutputMs;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stderr = "";
  let pending = "";
  let timedOut = false;
  let outputLimitExceeded = false;
  let parseFailed = false;
  let secretLeakDetected = false;
  let forceKillTimer;
  const secrets = [
    ...(input.secret ? [input.secret] : []),
    ...(Array.isArray(input.secrets) ? input.secrets : []),
  ].filter(Boolean);
  const scanStdoutSecrets = createSecretStreamScanner(secrets);
  const scanStderrSecrets = createSecretStreamScanner(secrets);
  const stop = () => {
    terminate(child, "SIGTERM");
    forceKillTimer ??= setTimeout(
      () => terminate(child, "SIGKILL"),
      TERMINATION_GRACE_MS,
    );
    forceKillTimer.unref();
  };
  const noteOutput = (chunk) => {
    firstOutputMs ??= elapsed(startedAt);
  };
  const parseLine = (line) => {
    if (!line) return;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      outputLimitExceeded = true;
      stop();
      return;
    }
    try {
      input.onStdoutLine(line);
    } catch {
      parseFailed = true;
      stop();
    }
  };
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    noteOutput(text);
    secretLeakDetected ||= scanStdoutSecrets(chunk);
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      outputLimitExceeded = true;
      stop();
      return;
    }
    pending += text;
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      parseLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
    }
    if (Buffer.byteLength(pending, "utf8") > MAX_LINE_BYTES) {
      outputLimitExceeded = true;
      stop();
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    noteOutput(text);
    secretLeakDetected ||= scanStderrSecrets(chunk);
    stderrBytes += chunk.byteLength;
    if (Buffer.byteLength(stderr, "utf8") < MAX_STDERR_BYTES) {
      stderr += text.slice(
        0,
        Math.max(0, MAX_STDERR_BYTES - Buffer.byteLength(stderr, "utf8")),
      );
    }
  });
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, input.timeoutMs);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    clearTimeout(timer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  });
  if (pending) parseLine(pending);
  return {
    ...result,
    durationMs: elapsed(startedAt),
    firstOutputMs: firstOutputMs ?? elapsed(startedAt),
    stdoutBytes,
    stderrBytes,
    stderr,
    timedOut,
    outputLimitExceeded,
    parseFailed,
    secretLeakDetected,
  };
}

export function createNapierComparisonParser() {
  let finalText = "";
  let status;
  let usage;
  let infrastructureSignal = false;
  const toolCounts = emptyToolCounts();
  let toolFailed = 0;
  let frameCount = 0;
  return {
    accept(line) {
      infrastructureSignal ||= infrastructureFailureText(line);
      const frame = parseRecord(line);
      frameCount += 1;
      if (frame.type === "event" && record(frame.event)) {
        const event = frame.event;
        if (event.type === "tool.started" && record(event.payload)) {
          incrementToolFamily(toolCounts, event.payload.toolName);
        } else if (event.type === "tool.failed") {
          toolFailed += 1;
        } else if (
          event.type === "message.assistant" &&
          record(event.payload) &&
          typeof event.payload.text === "string"
        ) {
          finalText = event.payload.text;
        }
      }
      if (frame.type === "snapshot" && record(frame.detail)) {
        const runs = Array.isArray(frame.detail.runs) ? frame.detail.runs : [];
        const run = runs.at(-1);
        if (record(run)) {
          status = typeof run.status === "string" ? run.status : status;
          usage = normalizedUsage(run.usage) ?? usage;
        }
        const events = Array.isArray(frame.detail.events)
          ? frame.detail.events
          : [];
        for (const event of events) {
          if (
            record(event) &&
            event.type === "message.assistant" &&
            record(event.payload) &&
            typeof event.payload.text === "string"
          ) {
            finalText = event.payload.text;
          }
        }
      }
      if (frame.type === "done" && typeof frame.status === "string") {
        status = frame.status;
      }
    },
    result() {
      return {
        finalText,
        status,
        usage: usage ?? zeroUsage(),
        toolCounts,
        toolFailed,
        frameCount,
        infrastructureSignal,
      };
    },
  };
}

export function createOmpComparisonParser() {
  let finalText = "";
  let status;
  let infrastructureSignal = false;
  const usage = zeroUsage();
  const toolCounts = emptyToolCounts();
  let toolFailed = 0;
  let frameCount = 0;
  return {
    accept(line) {
      infrastructureSignal ||= infrastructureFailureText(line);
      const event = parseRecord(line);
      frameCount += 1;
      if (event.type === "tool_execution_start") {
        incrementOmpToolFamily(toolCounts, event.toolName, event.args);
      } else if (
        event.type === "tool_execution_end" &&
        event.isError === true
      ) {
        toolFailed += 1;
      } else if (
        event.type === "message_end" &&
        record(event.message) &&
        event.message.role === "assistant"
      ) {
        const text = assistantText(event.message.content);
        if (text) finalText = text;
        addOmpUsage(usage, event.message.usage);
        if (typeof event.message.stopReason === "string") {
          status =
            event.message.stopReason === "error" ? "failed" : "completed";
        }
      }
    },
    result() {
      return {
        finalText,
        status,
        usage,
        toolCounts,
        toolFailed,
        frameCount,
        infrastructureSignal,
      };
    },
  };
}

export function infrastructureFailureText(value) {
  return /(?:http(?: status)? 429|http(?: status)? 503|rate.?limit|too many requests|econn(?:refused|reset)|enotfound|eai_again|network is unreachable|temporary failure|cannot find module|browser executable.*(?:missing|not found)|browser.*unavailable|chrome.*(?:missing|not found)|failed to (?:attach|connect|launch).*browser|provider unavailable)/iu.test(
    String(value),
  );
}

function incrementToolFamily(counts, toolName) {
  if (toolName === "web_search") counts.search += 1;
  else if (toolName === "web_fetch") counts.fetch += 1;
  else if (toolName === "browser") counts.browser += 1;
}

function incrementOmpToolFamily(counts, toolName, args) {
  if (toolName === "web_search") {
    counts.search += 1;
    return;
  }
  if (toolName === "browser") {
    counts.browser += 1;
    return;
  }
  if (
    toolName === "read" &&
    record(args) &&
    typeof args.path === "string" &&
    /^https?:\/\//u.test(args.path)
  ) {
    counts.fetch += 1;
  }
}

function assistantText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (entry) =>
        record(entry) &&
        entry.type === "text" &&
        typeof entry.text === "string",
    )
    .map((entry) => entry.text)
    .join("");
}

function addOmpUsage(target, value) {
  if (!record(value)) return;
  target.inputTokens += nonNegative(value.input);
  target.outputTokens += nonNegative(value.output);
  target.cacheReadTokens += nonNegative(value.cacheRead);
  target.cacheWriteTokens += nonNegative(value.cacheWrite);
  target.costUsd += record(value.cost) ? nonNegative(value.cost.total) : 0;
}

function normalizedUsage(value) {
  if (!record(value)) return undefined;
  const usage = {
    inputTokens: nonNegative(value.inputTokens),
    outputTokens: nonNegative(value.outputTokens),
    cacheReadTokens: nonNegative(value.cacheReadTokens),
    cacheWriteTokens: nonNegative(value.cacheWriteTokens),
    costUsd: nonNegative(value.costUsd),
  };
  return Object.values(usage).every(Number.isFinite) ? usage : undefined;
}

function parseRecord(line) {
  const value = JSON.parse(line);
  if (!record(value)) throw new Error("Comparison JSONL frame is invalid");
  return value;
}

function emptyToolCounts() {
  return { search: 0, fetch: 0, browser: 0 };
}

function zeroUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

function nonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function elapsed(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function createSecretStreamScanner(secrets) {
  const needles = secrets.map((secret) => Buffer.from(secret));
  const maximumNeedleBytes = Math.max(
    1,
    ...needles.map((needle) => needle.length),
  );
  let tail = Buffer.alloc(0);
  return (chunk) => {
    const body = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk;
    const detected = needles.some((needle) => body.includes(needle));
    tail = body.subarray(Math.max(0, body.length - maximumNeedleBytes + 1));
    return detected;
  };
}

function terminate(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
