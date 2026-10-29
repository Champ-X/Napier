import { isIP } from "node:net";
import path from "node:path";

const ALLOWED_MODEL_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "browser-use",
  "deepseek",
  "openrouter",
]);

export function validateBrowserUseLocalTaskRequest(request: {
  task: string;
  startUrl?: string;
  model: { provider: string };
  allowedDomains: string[];
  maxSteps: number;
}): void {
  if (request.task.trim().length < 1 || request.task.length > 8_000) {
    throw new Error("Browser Use local task must be 1-8000 characters");
  }
  if (!ALLOWED_MODEL_PROVIDERS.has(request.model.provider)) {
    throw new Error(
      "Browser Use local supports openai, anthropic, google, browser-use, deepseek, or openrouter models",
    );
  }
  if (
    !Number.isSafeInteger(request.maxSteps) ||
    request.maxSteps < 1 ||
    request.maxSteps > 100
  ) {
    throw new Error("Browser Use local max steps must be 1-100");
  }
  if (request.allowedDomains.length < 1 || request.allowedDomains.length > 20) {
    throw new Error("Browser Use local requires 1-20 allowed domains");
  }
  for (const domain of request.allowedDomains) {
    if (
      !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(domain) ||
      domain.includes("..") ||
      !publicDomain(domain)
    ) {
      throw new Error("Browser Use local allowed domain is invalid");
    }
  }
  if (!request.startUrl) return;
  let url: URL;
  try {
    url = new URL(request.startUrl);
  } catch {
    throw new Error("Browser Use local start URL is invalid");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    !publicDomain(url.hostname.toLowerCase()) ||
    !domainAllowed(url.hostname.toLowerCase(), request.allowedDomains)
  ) {
    throw new Error(
      "Browser Use local start URL must match the public domain allowlist",
    );
  }
}

function publicDomain(value: string): boolean {
  const domain = value.startsWith("*.") ? value.slice(2) : value;
  return (
    isIP(domain.replace(/^\[|\]$/gu, "")) === 0 &&
    domain !== "localhost" &&
    !domain.endsWith(".localhost")
  );
}

function domainAllowed(hostname: string, domains: string[]): boolean {
  return domains.some((domain) =>
    domain.startsWith("*.")
      ? hostname === domain.slice(2) || hostname.endsWith(domain.slice(1))
      : hostname === domain,
  );
}

export function browserUseLocalBridgeEnvironment(
  input: Readonly<Record<string, string | undefined>>,
  runtimeRoot: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: input["PATH"],
    SYSTEMROOT: input["SYSTEMROOT"],
    TMPDIR: runtimeRoot,
    TEMP: runtimeRoot,
    TMP: runtimeRoot,
    // Browser Use's macOS CDP core requires the real host HOME to route
    // browser responses. Chrome still receives an explicit fresh profile
    // rooted in the task artifact directory below.
    HOME: input["HOME"] ?? process.env["HOME"] ?? runtimeRoot,
    XDG_CACHE_HOME: path.join(runtimeRoot, "cache"),
    XDG_CONFIG_HOME: path.join(runtimeRoot, "config"),
    BROWSER_USE_CONFIG_DIR: path.join(runtimeRoot, "config", "browseruse"),
    BROWSER_USE_SETUP_LOGGING: "false",
    BROWSER_USE_LOGGING_LEVEL: "critical",
    BROWSER_USE_VERSION_CHECK: "false",
    BROWSER_USE_CLOUD_SYNC: "false",
    ANONYMIZED_TELEMETRY: "false",
    NAPIER_BROWSER_USE_CREDENTIAL: input["NAPIER_BROWSER_USE_CREDENTIAL"],
  };
  for (const name of [
    "ALL_PROXY",
    "APPDATA",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "LOGNAME",
    "NO_PROXY",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "USER",
    "USERPROFILE",
  ]) {
    if (input[name]) env[name] = input[name];
  }
  return env;
}
