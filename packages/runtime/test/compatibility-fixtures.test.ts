import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  compatibilityTelemetrySnapshot,
  resetCompatibilityTelemetryForTest,
} from "../src/compatibility-telemetry.js";
import { sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/store.js";
import { ExecutionPlanWorkflowLedger } from "../src/workflow-ledger.js";

interface CompatibilityFixture {
  id: string;
  path: string;
  sha256?: string;
  sourceCommit: string;
}

interface CompatibilityFixtureManifest {
  kind: string;
  schemaVersion: number;
  minimumReadableVersion: string;
  fixtures: CompatibilityFixture[];
}

interface StoreFixtureManifest {
  sourceCommit: string;
  files: Record<string, string>;
}

interface WorkflowTerminalFixture {
  type: string;
  category: "plan";
  visibility: "user";
  payload: Record<string, JsonValue>;
}

const fixtureRoot = path.join(
  import.meta.dirname,
  "fixtures",
  "compatibility-v1",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("oldest supported compatibility fixtures", () => {
  it("keeps every declared historical artifact content-addressed", async () => {
    const manifest = await readJson<CompatibilityFixtureManifest>(
      path.join(fixtureRoot, "manifest.json"),
    );

    expect(manifest).toMatchObject({
      kind: "napier.compatibility-fixture-manifest",
      schemaVersion: 1,
      minimumReadableVersion: "0.1.0",
    });
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual([
      "store-profile-pre-search",
      "project-legacy-skill",
      "workflow-terminal-before-plan-revision",
    ]);

    for (const fixture of manifest.fixtures) {
      expect(fixture.sourceCommit).toMatch(/^[a-f0-9]{40}$/u);
      if (fixture.sha256) {
        expect(
          sha256(await readFile(path.resolve(fixtureRoot, fixture.path))),
        ).toBe(fixture.sha256);
      }
    }

    const storeFixture = manifest.fixtures[0]!;
    const storeManifestPath = path.resolve(fixtureRoot, storeFixture.path);
    const storeManifest =
      await readJson<StoreFixtureManifest>(storeManifestPath);
    expect(storeManifest.sourceCommit).toBe(storeFixture.sourceCommit);
    for (const [relativePath, expectedSha256] of Object.entries(
      storeManifest.files,
    )) {
      expect(
        sha256(
          await readFile(
            path.join(path.dirname(storeManifestPath), relativePath),
          ),
        ),
      ).toBe(expectedSha256);
    }
  });

  it("replays a terminal Workflow event written before planRevision", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-compat-fixture-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    try {
      const fixture = await readJson<WorkflowTerminalFixture>(
        path.join(fixtureRoot, "workflow-terminal.json"),
      );
      const thread = await store.createThread({
        title: "Legacy Workflow replay",
        agentId: store.listAgents()[0]!.id,
      });
      await store.appendEvent({
        threadId: thread.id,
        runId: "runctl_legacy_workflow",
        type: fixture.type,
        category: fixture.category,
        visibility: fixture.visibility,
        payload: fixture.payload,
      });

      resetCompatibilityTelemetryForTest();
      await expect(
        new ExecutionPlanWorkflowLedger(store).hasTerminalEvent({
          threadId: thread.id,
          planId: String(fixture.payload["planId"]),
          eventType: fixture.type,
          manifestSha256: String(fixture.payload["manifestSha256"]),
          blueprintSha256: String(fixture.payload["blueprintSha256"]),
          status: String(fixture.payload["status"]),
          planRevision: 1,
          nodeResultCount: Number(fixture.payload["nodeResultCount"]),
          completedNodeCount: Number(fixture.payload["completedNodeCount"]),
          skippedNodeCount: 0,
          outputSha256: String(fixture.payload["outputSha256"]),
        }),
      ).resolves.toBe(true);
      expect(metricCount("compat.workflow.legacy_terminal_read")).toBe(1);
    } finally {
      store.close();
    }
  });
});

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function metricCount(id: string): number | undefined {
  return compatibilityTelemetrySnapshot().metrics.find(
    (metric) => metric.id === id,
  )?.count;
}
