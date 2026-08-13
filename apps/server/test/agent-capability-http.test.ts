import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  EffectiveAgentCapabilityProjectionV1,
  RestoreRecommendedCapabilitiesResultV1,
} from "@napier/contracts/agent-capability-contract";
import { SqliteLedger } from "@napier/runtime";
import { CapabilityRestoreValidationError } from "@napier/runtime/agent-capability-store-mutations";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent capability HTTP", () => {
  it("projects effective capabilities and restores through exact CAS", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-capability-http-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
    });
    openServices.push(services);
    const app = createApp(services);
    const seeded = services.store.listAgents()[0]!;
    const drifted = await services.store.updateAgent(seeded.id, {
      enabledTools: ["browser", "future_tool"],
      enabledSkills: [],
      enabledSubagents: [],
    });

    const getResponse = await app.request(
      `/api/agents/${drifted.id}/capabilities`,
    );
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("cache-control")).toBe("no-store");
    expect(getResponse.headers.get("x-napier-content-sha256-mode")).toBe(
      "body",
    );
    const projection =
      (await getResponse.json()) as EffectiveAgentCapabilityProjectionV1;
    expect(getResponse.headers.get("x-napier-content-sha256")).toBe(
      sha256Json(projection),
    );
    expect(
      getResponse.headers.get("x-napier-agent-capability-projection-sha256"),
    ).toBe(projection.projectionSha256);
    expect(projection).toEqual(
      expect.objectContaining({
        agentRevision: 2,
        driftState: "current",
        ownership: "explicit_overrides",
        configuredTools: ["browser", "future_tool"],
      }),
    );

    const conflictResponse = await app.request(
      `/api/agents/${drifted.id}/capabilities/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: 2,
          diffSha256: "0".repeat(64),
        }),
      },
    );
    expect(conflictResponse.status).toBe(409);
    expect(services.store.getAgent(drifted.id).revision).toBe(2);

    const restoreResponse = await app.request(
      `/api/agents/${drifted.id}/capabilities/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: projection.agentRevision,
          diffSha256: projection.restorePreview.diffSha256,
        }),
      },
    );
    expect(restoreResponse.status).toBe(200);
    const restored =
      (await restoreResponse.json()) as RestoreRecommendedCapabilitiesResultV1;
    expect(restoreResponse.headers.get("x-napier-content-sha256")).toBe(
      sha256Json(restored),
    );
    expect(restored).toEqual(
      expect.objectContaining({
        previousRevision: 2,
        projection: expect.objectContaining({
          agentRevision: 3,
          driftState: "current",
          ownership: "recommended",
        }),
      }),
    );
  });

  it("rejects malformed restore bodies and missing Agents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-capability-http-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
    });
    openServices.push(services);
    const app = createApp(services);
    const invalid = await app.request(
      "/api/agents/agent_napier/capabilities/restore",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, unexpected: true }),
      },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual(
      expect.objectContaining({
        error: "Capability restore request is invalid",
      }),
    );
    await expectCapabilityError(
      await app.request("/api/agents/agent_missing/capabilities"),
      404,
      "not_found",
      "Agent not found: agent_missing",
    );
  });

  it("applies a safe upgrade through its distinct exact-CAS endpoint", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-capability-http-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
    });
    openServices.push(services);
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const projection = await services.agentCapabilities.project(agent.id);
    const upgradePreview = {
      schemaVersion: 1 as const,
      contractId: "napier.default-agent.capabilities" as const,
      sourceContractVersion: 2,
      targetContractVersion: 3,
      sourceRecommendationSha256: "a".repeat(64),
      targetRecommendationSha256: projection.recommendationSha256,
      agentId: agent.id,
      agentRevision: agent.revision,
      explicitOverrideFields: [],
      currentManagedStateSha256: "b".repeat(64),
      targetManagedStateSha256: "c".repeat(64),
      operations: [],
      diffSha256: "d".repeat(64),
    };
    const upgradedProjection = {
      ...projection,
      agentRevision: agent.revision + 1,
      projectionSha256: "e".repeat(64),
    };
    const upgrade = vi
      .spyOn(services.agentCapabilities, "upgrade")
      .mockResolvedValueOnce({
        schemaVersion: 1,
        previousRevision: agent.revision,
        projection: upgradedProjection,
      });

    const response = await app.request(
      `/api/agents/${agent.id}/capabilities/upgrade`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: upgradePreview.agentRevision,
          diffSha256: upgradePreview.diffSha256,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(upgrade).toHaveBeenCalledWith(agent.id, {
      schemaVersion: 1,
      expectedRevision: agent.revision,
      diffSha256: "d".repeat(64),
    });
    const body = await response.json();
    expect(response.headers.get("x-napier-content-sha256")).toBe(
      sha256Json(body),
    );
    expect(body).toEqual(
      expect.objectContaining({
        previousRevision: agent.revision,
        projection: expect.objectContaining({
          agentRevision: agent.revision + 1,
        }),
      }),
    );
  });

  it("projects a temporary preset without changing persistent capability state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-capability-http-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
    });
    openServices.push(services);
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const revisions = services.store.listAgentRevisions(agent.id);

    const response = await app.request(
      `/api/agents/${agent.id}/capabilities?preset=browser`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-napier-capability-preset")).toBe("browser");
    const projection =
      (await response.json()) as EffectiveAgentCapabilityProjectionV1;
    expect(projection).toEqual(
      expect.objectContaining({
        capabilityPreset: "browser",
        agentRevision: agent.revision,
        toolPolicy: "observe",
        configuredTools: expect.arrayContaining(["browser", "skill_load"]),
        runtimeExposedTools: expect.arrayContaining(["browser", "skill_load"]),
      }),
    );
    expect(response.headers.get("x-napier-content-sha256")).toBe(
      sha256Json(projection),
    );
    expect(services.store.getAgent(agent.id)).toEqual(agent);
    expect(services.store.listAgentRevisions(agent.id)).toEqual(revisions);

    for (const query of [
      "preset=unknown",
      "preset=browser&preset=coding",
      "extra=1",
    ]) {
      expect(
        (await app.request(`/api/agents/${agent.id}/capabilities?${query}`))
          .status,
      ).toBe(400);
    }
  });

  it("distinguishes validation, persistence, and internal failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-capability-http-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
    });
    openServices.push(services);
    const app = createApp(services);
    const seeded = services.store.listAgents()[0]!;
    const projection = await services.agentCapabilities.project(seeded.id);

    const validation = vi
      .spyOn(services.agentCapabilities, "restore")
      .mockRejectedValueOnce(
        new CapabilityRestoreValidationError("Capability binding is broken"),
      );
    const validationResponse = await app.request(
      `/api/agents/${seeded.id}/capabilities/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: seeded.revision,
          diffSha256: projection.restorePreview.diffSha256,
        }),
      },
    );
    expect(validationResponse.status).toBe(422);
    validation.mockRestore();

    const commit = vi
      .spyOn(SqliteLedger.prototype, "commit")
      .mockImplementationOnce(() => {
        throw new Error("synthetic persistence failure");
      });
    const persistenceResponse = await app.request(
      `/api/agents/${seeded.id}/capabilities/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: seeded.revision,
          diffSha256: projection.restorePreview.diffSha256,
        }),
      },
    );
    expect(persistenceResponse.status).toBe(503);
    expect(await persistenceResponse.json()).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("no restore was committed"),
      }),
    );
    commit.mockRestore();
    expect(services.store.getAgent(seeded.id).revision).toBe(seeded.revision);

    const internal = vi
      .spyOn(services.agentCapabilities, "project")
      .mockRejectedValueOnce(new Error("private internal detail"));
    const internalResponse = await app.request(
      `/api/agents/${seeded.id}/capabilities`,
    );
    await expectCapabilityError(
      internalResponse,
      500,
      "server_error",
      "Capability service failed; refresh and retry. No capability state was inferred.",
    );
    internal.mockRestore();
  });
});

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function expectCapabilityError(
  response: Response,
  status: number,
  code: string,
  message: string,
): Promise<void> {
  const body = await response.text();
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    createHash("sha256").update(body).digest("hex"),
  );
  expect(response.headers.get("x-napier-error-status")).toBe(String(status));
  expect(response.headers.get("x-napier-error-code")).toBe(code);
  expect(response.headers.get("x-napier-error-message-sha256")).toBe(
    createHash("sha256").update(message).digest("hex"),
  );
  expect(JSON.parse(body)).toEqual({ error: message });
}
