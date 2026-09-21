import type { AgentTool } from "@earendil-works/pi-agent-core";
import { realpath } from "node:fs/promises";
import { Type, type TSchema } from "typebox";
import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import { createWorkspacePathSnapshot } from "./workspace-snapshot.js";
import { toolchainDiagnostics } from "./toolchain-diagnostics.js";
import { verifyAffectedTests } from "./affected-test-verification.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { withToolchainProcessProvider } from "./toolchain-process-provider.js";
import { withToolchainDebuggerProvider } from "./toolchain-debugger-provider.js";
import {
  runPythonToolchainCommand,
  normalizeToolchainCommand,
  toolchainPath,
  verifyPythonToolchain,
  type ToolchainVerificationRequest,
  type ToolchainCommandRequest,
  type ToolchainOptions,
} from "./python-toolchain.js";

export type { ToolchainOptions } from "./python-toolchain.js";

export interface ToolchainDetection {
  runtimes: Array<"node" | "python">;
  manifests: string[];
  complete: boolean;
  snapshotSha256: string;
}

export interface ToolchainProvider {
  readonly id: "node" | "python";
  execute(
    callId: string,
    input: ReturnType<typeof normalizeToolchainCommand>,
    signal?: AbortSignal,
  ): ReturnType<AgentTool["execute"]>;
  verify(
    callId: string,
    input: ToolchainVerificationRequest,
    signal?: AbortSignal,
  ): ReturnType<AgentTool["execute"]>;
}

/** Run-scoped adapters delegate to the same governed execution surface. They
 * cannot add a missing tool or grant process access to a read-only profile. */
export function withToolchainProviders(
  tools: AgentTool[],
  options: ToolchainOptions,
): AgentTool[] {
  const command = tools.find((tool) => tool.name === "run_command");
  const verify = tools.find((tool) => tool.name === "verify_workspace");
  const providers = new Map<ToolchainProvider["id"], ToolchainProvider>([
    [
      "node",
      {
        id: "node",
        execute: (id, input, signal) =>
          requireTool(command).execute(id, input, signal),
        verify: (id, input, signal) => {
          if (input.kind === "syntax" || input.verifier !== undefined)
            throw new Error(
              "Node supports typecheck/test/format with its pinned toolchain",
            );
          const { runtime: _runtime, ...legacy } = input;
          return requireTool(verify).execute(id, legacy, signal);
        },
      },
    ],
    [
      "python",
      {
        id: "python",
        execute: async (_id, input, signal) => {
          requireTool(command);
          const result = await runPythonToolchainCommand(
            options,
            input,
            signal,
          );
          return {
            content: [
              {
                type: "text",
                text: [
                  `Command ${result.details.status.toUpperCase()}: python`,
                  `Sandbox: ${result.details.sandbox}`,
                  ...(result.details.sandbox === "host-direct"
                    ? ["Isolation: none (host-direct)"]
                    : []),
                  `Runtime executable SHA-256: ${result.details.executableSha256}`,
                  "STDOUT",
                  result.stdout || "(empty)",
                  "STDERR",
                  result.stderr || "(empty)",
                ].join("\n"),
              },
            ],
            details: result.details,
          };
        },
        verify: (_id, input, signal) => {
          requireTool(verify);
          return verifyPythonToolchain(options, input, signal);
        },
      },
    ],
  ]);
  return tools.map((tool) => {
    if (tool.name === "node_debugger")
      return withToolchainDebuggerProvider(tool, options);
    if (tool.name === "workspace_process")
      return withToolchainProcessProvider(tool);
    if (tool.name === "run_command")
      return preserveAgentToolIdentity(tool, {
        ...tool,
        parameters: commandToolchainSchema(tool.parameters),
        description: `${tool.description} Also supports runtime=python through the same provider and bounds. For multiline Python use code (script text, up to 8192 UTF-8 bytes) instead of args; it executes inline without creating a helper file. A .venv in cwd is selected explicitly; a broken environment is an error.`,
        execute: async (id, args, signal) => {
          const input = normalizeToolchainCommand(
            args as ToolchainCommandRequest,
          );
          const provider = providers.get(
            input.runtime as ToolchainProvider["id"],
          );
          if (!provider)
            throw new Error("Unsupported command toolchain runtime");
          return provider.execute(id, input, signal);
        },
      });
    if (tool.name !== "verify_workspace") return tool;
    return preserveAgentToolIdentity(tool, {
      ...tool,
      parameters: extendSchema(tool.parameters, {
        runtime: Type.Optional(runtimeSchema),
        kind: Type.Union(
          ["typecheck", "test", "format", "syntax"].map((kind) =>
            Type.Literal(kind),
          ),
        ),
        verifier: Type.Optional(
          Type.Union(
            ["unittest", "pytest", "mypy", "ruff"].map((name) =>
              Type.Literal(name),
            ),
          ),
        ),
        affectedBy: Type.Optional(
          Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
            minItems: 1,
            maxItems: 16,
            uniqueItems: true,
          }),
        ),
      }),
      description: `${tool.description} runtime=python selects .venv in cwd or the pinned system/provider interpreter: test uses unittest by default (verifier=pytest selects pytest), typecheck uses mypy, format uses ruff --check, syntax only compiles source. Third-party verifiers must already be installed; unavailable verifiers never count as success. Mixed projects should specify runtime. For kind=test, affectedBy=[changed paths relative to cwd] selects reverse-dependent Node or Python tests; omit target. Unknown, capped, or empty selection falls back to full tests. Do not create new verification files when the user restricts changed paths.`,
      execute: async (id, args, signal) => {
        const input = args as ToolchainVerificationRequest;
        validateVerification(input);
        const runtime =
          input.runtime ??
          (await detectVerificationRuntime(options.workspaceRoot, input));
        if (runtime === "python" && input.testRunner !== undefined)
          throw new Error(
            "testRunner only applies to Node tests; Python uses verifier",
          );
        const execute = (request: ToolchainVerificationRequest) =>
          providers.get(runtime)!.verify(id, request, signal);
        const result = input.affectedBy
          ? await verifyAffectedTests(
              options,
              { ...input, runtime, affectedBy: input.affectedBy },
              execute,
              signal,
            )
          : await execute(input);
        const text = result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const { resultSha256: executionResultSha256, ...original } =
          result.details;
        const details = {
          ...original,
          executionResultSha256,
          ...toolchainDiagnostics(options.workspaceRoot, text),
        };
        return {
          ...result,
          details: { ...details, resultSha256: sha256(canonicalJson(details)) },
        };
      },
    });
  });
}

const runtimeSchema = Type.Union([
  Type.Literal("node"),
  Type.Literal("python"),
]);

export async function detectToolchains(
  workspaceRoot: string,
  cwd = ".",
): Promise<ToolchainDetection> {
  const root = await realpath(workspaceRoot);
  const target = await toolchainPath(root, root, cwd);
  const snapshot = await createWorkspacePathSnapshot(root, target);
  const paths = snapshot.entries
    .map((entry) => entry.path)
    .filter((file) => !file.split("/").includes(".venv"));
  const node = paths.some((file) =>
    /(?:\.[cm]?[jt]sx?|(?:^|\/)package\.json)$/u.test(file),
  );
  const python = paths.some((file) =>
    /(?:\.py|(?:^|\/)(?:pyproject\.toml|requirements[^/]*\.txt|setup\.cfg))$/u.test(
      file,
    ),
  );
  return {
    runtimes: [
      ...(node ? ["node" as const] : []),
      ...(python ? ["python" as const] : []),
    ],
    manifests: paths.filter((file) =>
      /(?:^|\/)(?:package\.json|pyproject\.toml|requirements[^/]*\.txt|setup\.cfg)$/u.test(
        file,
      ),
    ),
    complete: !snapshot.truncated,
    snapshotSha256: snapshot.sha256,
  };
}

async function detectVerificationRuntime(
  root: string,
  input: ToolchainVerificationRequest,
) {
  if (
    input.target?.endsWith(".py") ||
    input.kind === "syntax" ||
    input.verifier
  )
    return "python";
  const detection = await detectToolchains(root, input.cwd);
  if (detection.runtimes.length > 1 || !detection.complete)
    throw new Error(
      "Mixed or incomplete toolchain detection: specify runtime=node or runtime=python",
    );
  return detection.runtimes[0] ?? "node";
}

function commandToolchainSchema(schema: TSchema) {
  const copy = extendSchema(schema, {
    runtime: runtimeSchema,
    code: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
  }) as TSchema & { required: string[] };
  copy.required = copy.required.filter((key) => key !== "args");
  return copy;
}

function extendSchema(
  schema: TSchema,
  properties: Record<string, TSchema>,
): TSchema {
  const copy = structuredClone(schema) as TSchema & {
    properties: Record<string, TSchema>;
  };
  Object.assign(copy.properties, properties);
  return copy;
}

function requireTool(tool?: AgentTool) {
  if (!tool) throw new Error("Toolchain capability is unavailable");
  return tool;
}

function validateVerification(input: ToolchainVerificationRequest) {
  if (
    input.runtime !== undefined &&
    !["node", "python"].includes(input.runtime)
  )
    throw new Error("Unsupported verification runtime");
  if (
    input.timeoutMs !== undefined &&
    (!Number.isInteger(input.timeoutMs) ||
      input.timeoutMs < 1_000 ||
      input.timeoutMs > 120_000)
  )
    throw new Error("Verification timeout must be 1000-120000 ms");
}
