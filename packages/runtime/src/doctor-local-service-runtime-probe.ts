import {
  assertCommandRuntimeStable,
  prepareCommandExecution,
  type PreparedCommandExecution,
} from "./command-execution.js";
import type { OsSandboxAdapter, SandboxedProcess } from "./sandbox.js";
import { createPlatformSandboxAdapter } from "./sandbox.js";
import { waitForLoopbackHttpServiceClosed } from "./sandbox-local-service-health.js";
import { bindWorkspaceProcessIo } from "./workspace-process-terminal.js";

const MARKER = "napier_local_service_probe_v1";
const PORT = 31_879;
const HEALTH_PATH = "/__napier_ready";
const TIMEOUT_MS = 5_000;

/** Starts, projects, probes, and cleans up the production OCI local-service path. */
export async function probeLocalServiceRuntime(
  workspaceRoot: string,
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
) {
  let prepared: PreparedCommandExecution | undefined;
  let child: SandboxedProcess | undefined;
  try {
    prepared = await prepareCommandExecution(
      { workspaceRoot, sandbox },
      {
        runtime: "node",
        args: ["-e", serviceSource()],
        timeoutMs: TIMEOUT_MS,
      },
    );
    const io = bindWorkspaceProcessIo(prepared, undefined, {
      protocol: "http",
      containerPort: PORT,
      healthPath: HEALTH_PATH,
    });
    child = await sandbox.launch({
      ...io.launch,
      ...(signal ? { signal } : {}),
    });
    const service = child.localService;
    if (!service) throw new Error("Local service projection was not returned");
    await child.terminate();
    child = undefined;
    await waitForLoopbackHttpServiceClosed(service.hostPort);
    await assertCommandRuntimeStable(prepared);
    return {
      status: "ready" as const,
      code: "service_ready",
      message: `The active ${sandbox.id} provider projected and cleaned up a bounded HTTP service on an ephemeral loopback port with outbound network denied`,
      evidence: {
        adapter: sandbox.id,
        productionCall: true,
        protocol: service.protocol,
        containerPort: service.containerPort,
        host: service.host,
        hostPort: service.hostPort,
        localServiceIdentitySha256: service.identitySha256,
        healthPathSha256: service.healthPathSha256,
        outboundNetworkDenied: true,
        cleanupVerified: true,
        commandSha256: io.commandSha256,
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      status: "unavailable" as const,
      code: "service_provider_unavailable",
      message:
        "The active provider could not project and clean up an egress-denied loopback HTTP service; local-service tasks fail closed",
    };
  } finally {
    await child?.terminate().catch(() => undefined);
  }
}

function serviceSource(): string {
  return `const http=require("node:http");const server=http.createServer((request,response)=>{response.statusCode=request.url===${JSON.stringify(HEALTH_PATH)}?200:404;response.end(${JSON.stringify(MARKER)});});server.listen(${String(PORT)},"0.0.0.0");`;
}
