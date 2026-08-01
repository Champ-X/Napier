import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";

import type { CodingBenchmarkDependencies } from "../src/coding-benchmark.js";
import { directSandbox } from "./coding-benchmark-multifile-fixture.js";

export const DEBUG_CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/coding/loyalty-discount-debug-v1",
);

const TARGET_SHA256 =
  "268ccb870cb1372359bee5cd4b1da63016b3f040a4df0703847a90d614fcdafa";

export function createDebugBenchmarkProvider(options?: {
  skipDebugger?: boolean;
}): ReturnType<typeof fauxProvider> {
  const provider = fauxProvider({
    provider: options?.skipDebugger
      ? "faux-coding-debug-skip"
      : "faux-coding-debug",
  });
  const patch = fauxAssistantMessage(
    fauxToolCall("apply_patch", {
      operation: "replace",
      path: "src/loyalty.js",
      expectedSha256: TARGET_SHA256,
      edits: [
        {
          oldText: "  const discountCents = Math.round(discountPercent);",
          newText:
            "  const discountCents = Math.round((subtotalCents * discountPercent) / 100);",
        },
      ],
    }),
    { stopReason: "toolUse" },
  );
  if (options?.skipDebugger) {
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "src/loyalty.js" }),
        { stopReason: "toolUse" },
      ),
      patch,
      fauxAssistantMessage("Repaired the loyalty discount calculation."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    return provider;
  }
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("read_file", { path: "src/loyalty.js" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("node_debugger", {
        action: "launch",
        path: "src/loyalty.js",
        breakpoints: [{ line: 10 }],
        timeoutMs: 5_000,
        sessionTimeoutMs: 30_000,
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const messages = JSON.stringify(context.messages);
      const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
      const frameId = messages.match(/#(\d+) loyaltyTotalCents/u)?.[1];
      if (!processId || !frameId) {
        throw new Error("Debug benchmark launch evidence is unavailable");
      }
      return fauxAssistantMessage(
        fauxToolCall("node_debugger", {
          action: "scopes",
          processId,
          frameId: Number(frameId),
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const messages = JSON.stringify(context.messages);
      const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
      const variablesReference = messages.match(
        /loyaltyTotalCents -> variablesReference (\d+)/u,
      )?.[1];
      if (!processId || !variablesReference) {
        throw new Error("Debug benchmark scope evidence is unavailable");
      }
      return fauxAssistantMessage(
        fauxToolCall("node_debugger", {
          action: "variables",
          processId,
          variablesReference: Number(variablesReference),
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const messages = JSON.stringify(context.messages);
      const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
      if (
        !processId ||
        !messages.includes("subtotalCents: 2000") ||
        !messages.includes("discountPercent: 15") ||
        !messages.includes("discountCents: 15")
      ) {
        throw new Error("Debug benchmark variable evidence is unavailable");
      }
      return fauxAssistantMessage(
        fauxToolCall("node_debugger", {
          action: "continue",
          processId,
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      if (!JSON.stringify(context.messages).includes("Target exit code: 0")) {
        throw new Error("Debug benchmark completion evidence is unavailable");
      }
      return patch;
    },
    fauxAssistantMessage("Debugged and repaired the loyalty discount."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  return provider;
}

export function debugBenchmarkDependencies(
  provider: ReturnType<typeof fauxProvider>,
): CodingBenchmarkDependencies {
  return {
    now: () => new Date("2026-08-01T16:00:00.000Z"),
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: directSandbox(false),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}
