import { spawn } from "node:child_process";

import { canonicalJson } from "./skill-load-fast-core-evidence-lib.mjs";

export function allowedCredentialEnvironment(credentialName, credentialValue) {
  const inherited = [
    "PATH",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ];
  return {
    ...Object.fromEntries(
      inherited.flatMap((key) =>
        process.env[key] ? [[key, process.env[key]]] : [],
      ),
    ),
    [credentialName]: credentialValue,
  };
}

export function runBoundedChild(command, args, env, options) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    const collect = (target) => (chunk) => {
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (
        Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >
        options.maxOutputBytes
      ) {
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `${options.label} timed out: ${canonicalJson(streamDiagnostic(stdout))}`,
          ),
        );
      } else {
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      }
    });
  });
}

function streamDiagnostic(stdout) {
  const frames = stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  return {
    frameCount: frames.length,
    tail: frames.slice(-12).map((frame) => ({
      frameType: frame.type,
      eventType: frame.event?.type,
      toolName: frame.event?.payload?.toolName,
      resultStatus: frame.event?.payload?.details?.status,
    })),
  };
}
