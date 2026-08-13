import { isIP } from "node:net";

import type { ModelRef } from "@napier/contracts";

import { parseCredentialEnvironment } from "./cli-credential-options.js";
import { parsePositiveInteger } from "./cli-option-parser.js";
import {
  optionalModelRef,
  parseTimeout,
  requiredValue,
} from "./cli-option-values.js";

const DEFAULT_MAX_STEPS = 25;
const MAX_ALLOWED_DOMAINS = 20;

export interface CliBrowserTaskOptions {
  workspace: string;
  dataRoot?: string;
  backend: "browser_use_local" | "browser_use_cloud";
  task: string;
  startUrl?: string;
  model: ModelRef;
  credentialEnv?: string;
  allowedDomains: string[];
  maxSteps: number;
  maxCostUsd: number;
  timeoutMs: number;
  jsonl: boolean;
}

export const BROWSER_TASK_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--backend",
  "--task",
  "--start-url",
  "--model",
  "--credential-env",
  "--allowed-domains",
  "--max-steps",
  "--max-cost-usd",
  "--timeout-ms",
]);

export function parseBrowserTaskOptions(
  values: Map<string, string>,
  jsonl: boolean,
): { kind: "browser-task"; options: CliBrowserTaskOptions } {
  const backend = requiredValue(values, "--backend");
  if (backend !== "browser_use_local" && backend !== "browser_use_cloud") {
    throw new Error(
      "browser-task requires --backend browser_use_local or browser_use_cloud; native_playwright remains the default napier run backend",
    );
  }
  const model = optionalModelRef(values);
  if (!model) throw new Error("browser-task requires an explicit --model");
  if (backend === "browser_use_cloud" && model.provider !== "browser-use") {
    throw new Error(
      "browser_use_cloud requires a browser-use/<model-id> model reference",
    );
  }
  const credentialEnv = parseCredentialEnvironment(values, model);
  const task = requiredValue(values, "--task");
  if (task.length > 8_000) {
    throw new Error("--task must be 1-8000 characters");
  }
  const domains = allowedDomains(requiredValue(values, "--allowed-domains"));
  const startUrl = values.has("--start-url")
    ? validatedStartUrl(requiredValue(values, "--start-url"), domains)
    : undefined;
  if (backend === "browser_use_cloud" && !startUrl) {
    throw new Error("browser_use_cloud requires --start-url");
  }
  const maxCostUsd = values.has("--max-cost-usd")
    ? parseMaxCostUsd(requiredValue(values, "--max-cost-usd"))
    : backend === "browser_use_cloud"
      ? undefined
      : 1;
  if (maxCostUsd === undefined) {
    throw new Error(
      "browser_use_cloud requires an explicit --max-cost-usd cost ceiling",
    );
  }
  return {
    kind: "browser-task",
    options: {
      workspace: requiredValue(values, "--workspace"),
      backend,
      task,
      model,
      ...(credentialEnv ? { credentialEnv } : {}),
      allowedDomains: domains,
      maxSteps: values.has("--max-steps")
        ? parseMaxSteps(requiredValue(values, "--max-steps"))
        : DEFAULT_MAX_STEPS,
      maxCostUsd,
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      ...(startUrl ? { startUrl } : {}),
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
    },
  };
}

function parseMaxCostUsd(value: string): number {
  if (!/^(?:\d+|\d*\.\d+)$/u.test(value)) {
    throw new Error("--max-cost-usd must be a decimal amount");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 100) {
    throw new Error("--max-cost-usd must be 0.01-100");
  }
  return amount;
}

function validatedStartUrl(value: string, domains: string[]): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--start-url must be an absolute public HTTP(S) URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    !publicDomain(url.hostname.toLowerCase()) ||
    !domainAllowed(url.hostname.toLowerCase(), domains)
  ) {
    throw new Error(
      "--start-url must be public HTTP(S), contain no credentials, and match --allowed-domains",
    );
  }
  return url.href;
}

function domainAllowed(hostname: string, domains: string[]): boolean {
  return domains.some((domain) =>
    domain.startsWith("*.")
      ? hostname === domain.slice(2) || hostname.endsWith(domain.slice(1))
      : hostname === domain,
  );
}

function parseMaxSteps(value: string): number {
  const steps = parsePositiveInteger(value, "--max-steps");
  if (steps > 100) throw new Error("--max-steps must be 1-100");
  return steps;
}

function allowedDomains(value: string): string[] {
  const domains = [
    ...new Set(
      value
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (domains.length < 1 || domains.length > MAX_ALLOWED_DOMAINS) {
    throw new Error(
      "--allowed-domains must contain 1-20 comma-separated hosts",
    );
  }
  for (const domain of domains) {
    if (
      !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(domain) ||
      domain.includes("..") ||
      !publicDomain(domain)
    ) {
      throw new Error("--allowed-domains contains an invalid host");
    }
  }
  return domains;
}

function publicDomain(value: string): boolean {
  const domain = value.startsWith("*.") ? value.slice(2) : value;
  return (
    isIP(domain.replace(/^\[|\]$/gu, "")) === 0 &&
    domain !== "localhost" &&
    !domain.endsWith(".localhost")
  );
}
