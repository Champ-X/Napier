import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
  type LocalAgentRuntimeOptions,
  type OsSandboxAdapter,
} from "@napier/runtime";

import type { CodingBenchmarkDependencies } from "../src/coding-benchmark.js";

export const MULTIFILE_CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/coding/pricing-options-migration-v1",
);
const PRICING_SHA256 =
  "043ccba543ff00864f7c434bd84052376fc01eb4e6fdadc1ea4f70416e7ac54a";
const CHECKOUT_SHA256 =
  "58968a89306ba4411e7189a9ddb3dd6a68dca1f4045168917918ae82c20137a7";
const QUOTE_SHA256 =
  "6675ffc46fac14653e7549087c446eb5d7d4fbc2d3e2ffe85bbcddd22dc6a44c";

export const EXPECTED_PRICING = `export function discountedTotalCents({
  subtotalCents,
  discountPercent = 0,
}) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError("subtotalCents must be a non-negative integer");
  }
  if (
    !Number.isInteger(discountPercent) ||
    discountPercent < 0 ||
    discountPercent > 100
  ) {
    throw new TypeError("discountPercent must be an integer from 0 to 100");
  }
  return Math.round((subtotalCents * (100 - discountPercent)) / 100);
}
`;
export const EXPECTED_CHECKOUT = `import { discountedTotalCents } from "./pricing.js";

export function checkoutTotalCents(order) {
  return discountedTotalCents({
    subtotalCents: order.subtotalCents,
    discountPercent: order.discountPercent,
  });
}
`;
export const EXPECTED_QUOTE = `import { discountedTotalCents } from "./pricing.js";

export function quoteTotalCents(subtotalCents, discountPercent = 0) {
  return discountedTotalCents({ subtotalCents, discountPercent });
}
`;

export function createMultifileProvider(): ReturnType<typeof fauxProvider> {
  const provider = fauxProvider({ provider: "faux-coding-multifile" });
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("list_files", { path: ".", depth: 2 }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("read_file", { path: "src/pricing.js" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("lsp_references", {
        path: "src/pricing.js",
        line: 1,
        character: 17,
        includeDeclaration: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("read_file", { path: "src/checkout.js" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("read_file", { path: "src/quote.js" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("apply_patch", {
        operation: "replace",
        path: "src/pricing.js",
        expectedSha256: PRICING_SHA256,
        edits: [
          {
            oldText:
              "export function discountedTotalCents(subtotalCents, discountPercent) {",
            newText:
              "export function discountedTotalCents({\n  subtotalCents,\n  discountPercent = 0,\n}) {",
          },
        ],
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("apply_patch", {
        operation: "replace",
        path: "src/checkout.js",
        expectedSha256: CHECKOUT_SHA256,
        edits: [
          {
            oldText:
              "  return discountedTotalCents(\n    order.subtotalCents,\n    order.discountPercent,\n  );",
            newText:
              "  return discountedTotalCents({\n    subtotalCents: order.subtotalCents,\n    discountPercent: order.discountPercent,\n  });",
          },
        ],
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("apply_patch", {
        operation: "replace",
        path: "src/quote.js",
        expectedSha256: QUOTE_SHA256,
        edits: [
          {
            oldText:
              "  return discountedTotalCents(subtotalCents, discountPercent);",
            newText:
              "  return discountedTotalCents({ subtotalCents, discountPercent });",
          },
        ],
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Migrated the pricing API and both call sites."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  return provider;
}

export function multifileDependencies(
  provider: ReturnType<typeof fauxProvider>,
): CodingBenchmarkDependencies {
  return {
    now: () => new Date("2026-07-30T01:00:00.000Z"),
    async runOutcomeTest(input) {
      const expectedFiles = [
        ["src/pricing.js", EXPECTED_PRICING],
        ["src/checkout.js", EXPECTED_CHECKOUT],
        ["src/quote.js", EXPECTED_QUOTE],
      ] as const;
      const observed = await Promise.all(
        expectedFiles.map(async ([relativePath, expected]) => ({
          expected,
          actual: await readFile(
            path.join(input.workspaceRoot, relativePath),
            "utf8",
          ),
        })),
      );
      const passed =
        !input.signal?.aborted &&
        observed.every(({ actual, expected }) => actual === expected);
      const status = input.signal?.aborted
        ? ("cancelled" as const)
        : passed
          ? ("succeeded" as const)
          : ("failed" as const);
      return {
        testSha256: input.testSha256,
        status,
        sandboxId: "coding-multifile-test",
        resultSha256: sha256(
          canonicalJson({ testSha256: input.testSha256, status }),
        ),
        durationMs: 0,
        exitCode: status === "succeeded" ? 0 : status === "failed" ? 1 : null,
        stdoutSha256: sha256(""),
        stderrSha256: sha256(""),
        passed,
      };
    },
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: directSandbox(),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

export function directSandbox(inheritEnvironment = true): OsSandboxAdapter {
  return {
    id: "direct-coding-multifile-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: inheritEnvironment
          ? { ...process.env, ...request.env }
          : request.env,
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (
            child.exitCode === null &&
            child.signalCode === null &&
            child.pid !== undefined
          ) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }
          }
          await exit;
        },
      };
    },
  };
}
