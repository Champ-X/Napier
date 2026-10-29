import os from "node:os";
import path from "node:path";

import type { WorkspaceSummary } from "@napier/contracts";
import { createApp, createServices } from "./app.js";
import type { ServerServiceOptions } from "./server-service-options.js";
import { recordRecentWorkspace } from "./recent-workspaces.js";
import { setBodyContentSha256Header } from "./http-response-evidence.js";
import { resolveRebindWorkspaceRoot } from "./workspace-rebind.js";
import { WorkspaceRuntimeCatalog } from "./workspace-runtime-catalog.js";
import { createWorkspaceRuntimeFetch } from "./workspace-runtime-http.js";
import { resolveWorkspaceRuntimeIdentity } from "./workspace-runtime-identity.js";
import { WorkspaceRuntimeRegistry } from "./workspace-runtime-registry.js";
import { disposeWorkspaceRuntimeServices, workspaceRuntimeCanDispose } from "./workspace-runtime-services.js";
import { WorkspaceModelAdmission } from "./workspace-model-admission.js";
import { reconcileWorkspaceModelUsage } from "./workspace-model-usage-recovery.js";
import type { WorkspaceModelBudgetOptions } from "./workspace-model-budget.js";
import { WorkspaceResourceAdmission } from "./workspace-resource-admission.js";
import type { WorkspaceResourceLimits } from "./workspace-resource-policy.js";

interface WorkspaceRuntimeHostOptions {
  workspaceRoot: string;
  dataRoot?: string;
  stateHome?: string;
  services?: Omit<ServerServiceOptions, "workspaceRoot" | "dataRoot" | "startAutomation" | "modelCallAdmission" | "resourceAdmission">;
  modelBudget?: WorkspaceModelBudgetOptions;
  resourceLimits?: Partial<WorkspaceResourceLimits>;
  maxResident?: number;
  maxIdle?: number;
  idleMs?: number;
  maintenanceMs?: number;
  onWarning?: (workspaceId: string, error: string) => void;
}

export async function createWorkspaceRuntimeHost(
  options: WorkspaceRuntimeHostOptions,
  prepareServices: typeof createServices = createServices,
) {
  const stateHome = options.stateHome ?? process.env["NAPIER_STATE_HOME"] ?? path.join(os.homedir(), ".napier");
  const interval = options.maintenanceMs ?? 30_000;
  if (!Number.isSafeInteger(interval) || interval < 100) throw new Error("Invalid workspace maintenance interval");
  const catalog = await WorkspaceRuntimeCatalog.open(stateHome);
  const modelAdmission = await WorkspaceModelAdmission.open(stateHome, options.modelBudget)
    .catch((error) => { catalog.close(); throw error; });
  const resourceAdmission = await WorkspaceResourceAdmission.open(stateHome, options.resourceLimits)
    .catch((error) => { modelAdmission.close(); catalog.close(); throw error; });
  const failures = new Map<string, string>();
  const usageFailures = new Map<string, string>();
  const usageProjections = new Map<string, Promise<void>>();
  const registry = createRegistry();

  function reconcileUsage(workspaceId: string): Promise<void> {
    const pending = usageProjections.get(workspaceId);
    if (pending) return pending;
    const projection = reconcileWorkspaceModelUsage(catalog.get(workspaceId), modelAdmission)
      .then(() => { usageFailures.delete(workspaceId); })
      .catch((error: unknown) => { usageFailures.set(workspaceId, String(error)); throw error; })
      .finally(() => { usageProjections.delete(workspaceId); });
    usageProjections.set(workspaceId, projection);
    return projection;
  }

  function createRegistry() {
    try {
      return new WorkspaceRuntimeRegistry({
        catalog,
        ...(options.maxResident !== undefined ? { maxResident: options.maxResident } : {}),
        ...(options.maxIdle !== undefined ? { maxIdle: options.maxIdle } : {}),
        ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
        prepare: async (identity) => {
          // Reconcile an old outbox before starting any execution/recovery workers.
          await reconcileUsage(identity.workspaceId);
          const services = await prepareServices({
            ...options.services, workspaceRoot: identity.root, dataRoot: identity.dataRoot, startAutomation: true,
            modelCallAdmission: modelAdmission.forWorkspace(identity.workspaceId),
            resourceAdmission: resourceAdmission.forWorkspace(identity.workspaceId),
          });
          try {
            const app = createApp(services, {
              rebindWorkspace: openWorkspace, listWorkspaceThreads, independentWorkspaces: true,
              recentWorkspaceStateHome: stateHome,
            });
            app.get("/api/workspace/runtimes", (context) => {
              const response = catalog.list().map((entry) => ({ ...entry, error: failures.get(entry.workspaceId) ?? null,
                usageError: usageFailures.get(entry.workspaceId) ?? null }));
              setBodyContentSha256Header(context, response);
              return context.json(response);
            });
            app.get("/api/workspace/resources", (context) => {
              const response = { ...modelAdmission.snapshot(), executionResources: resourceAdmission.snapshot() };
              setBodyContentSha256Header(context, response);
              return context.json(response);
            });
            return { services, app, workspaceId: identity.workspaceId };
          } catch (error) {
            await disposeGraph(services, identity.workspaceId);
            throw error;
          }
        },
        dispose: ({ services, workspaceId }) => disposeGraph(services, workspaceId),
        canDispose: ({ services, workspaceId }) => !modelAdmission.hasPending(workspaceId) && !resourceAdmission.hasPending(workspaceId) && workspaceRuntimeCanDispose(services),
      });
    } catch (error) { resourceAdmission.close(); modelAdmission.close(); catalog.close(); throw error; }
  }

  async function disposeGraph(services: Awaited<ReturnType<typeof createServices>>, workspaceId: string): Promise<void> {
    // Physical sessions close inside local shutdown; draining their leases before
    // initiating close would deadlock an otherwise idle persistent session.
    await disposeWorkspaceRuntimeServices(services, async () => {
      await modelAdmission.drainWorkspace(workspaceId);
      await reconcileUsage(workspaceId);
    });
    await resourceAdmission.drainWorkspace(workspaceId);
  }

  async function identityFor(root: string, dataRoot?: string) {
    const canonical = await resolveRebindWorkspaceRoot(root);
    const existing = catalog.findRoot(canonical);
    if (existing && dataRoot === undefined) return existing;
    return catalog.register(await resolveWorkspaceRuntimeIdentity(canonical, dataRoot));
  }

  async function openWorkspace(root: string): Promise<WorkspaceSummary> {
    const identity = await identityFor(root);
    const lease = await registry.acquire(identity.workspaceId);
    try {
      await recordRecentWorkspace(identity.root, stateHome);
      failures.delete(identity.workspaceId);
      return { ...lease.runtime.services.store.getWorkspaceSummary(), workspaceId: identity.workspaceId };
    } finally { lease.release(); }
  }

  async function listWorkspaceThreads(root: string) {
    const identity = await identityFor(root);
    return registry.withRuntime(identity.workspaceId, async ({ services }) => services.store.listVisibleThreads());
  }

  let initial;
  try {
    initial = await identityFor(options.workspaceRoot, options.dataRoot);
    const lease = await registry.acquire(initial.workspaceId);
    lease.release();
    await recordRecentWorkspace(initial.root, stateHome);
    for (const failure of await registry.restore()) {
      failures.set(failure.workspaceId, failure.error);
      options.onWarning?.(failure.workspaceId, failure.error);
    }
  } catch (error) {
    await registry.shutdown(); resourceAdmission.close(); modelAdmission.close(); catalog.close(); throw error;
  }

  let maintenance: Promise<void> | undefined;
  const maintain = async () => {
    for (const identity of catalog.list()) {
      if (!modelAdmission.hasPendingUsage(identity.workspaceId)) continue;
      try { await reconcileUsage(identity.workspaceId); }
      catch (error) { options.onWarning?.(identity.workspaceId, String(error)); }
    }
    await registry.reclaimIdle();
    for (const workspaceId of [...failures.keys()]) {
      try { const lease = await registry.acquire(workspaceId); lease.release(); failures.delete(workspaceId); }
      catch (error) { failures.set(workspaceId, String(error)); }
    }
  };
  const timer = setInterval(() => {
    maintenance ??= maintain().catch((error) => options.onWarning?.("registry", String(error)))
      .finally(() => { maintenance = undefined; });
  }, interval);
  timer.unref();
  let shutdown: Promise<void> | undefined;
  return {
    initial,
    openWorkspace,
    reclaimIdle: () => registry.reclaimIdle(),
    fetch: createWorkspaceRuntimeFetch({
      registry, defaultWorkspaceId: initial.workspaceId,
      fetch: (graph, request) => graph.app.fetch(request),
    }),
    shutdown() {
      clearInterval(timer);
      shutdown ??= (async () => {
        await maintenance;
        await registry.shutdown();
        resourceAdmission.close();
        modelAdmission.close();
        catalog.close();
      })();
      return shutdown;
    },
  };
}
