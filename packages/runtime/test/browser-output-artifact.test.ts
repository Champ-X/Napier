import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BrowserOutputArtifactRegistrar } from "../src/browser-output-artifact.js";
import { sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/store.js";
import {
  createThreadReplayBundle,
  verifyThreadReplayBundle,
} from "../src/thread-bundles.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser output Plan Artifact registration", () => {
  it("registers an exact declared file on the current Run-bound Plan", async () => {
    const fixture = await createFixture("artifacts/browser.png");
    const registrar = new BrowserOutputArtifactRegistrar(fixture.store);
    await writeFile(
      path.join(fixture.workspaceRoot, "artifacts/browser.png"),
      "PNG",
    );

    const registration = await registrar.register(fixture.owner, {
      action: "save_screenshot",
      path: "artifacts/browser.png",
      pathSha256: sha256("artifacts/browser.png"),
      fileSha256: sha256("PNG"),
      fileBytes: 3,
    });

    expect(registration).toEqual({
      status: "registered",
      reason: "artifact_registered",
      planId: fixture.planId,
      artifactId: "browser-output",
    });
    expect(fixture.store.getPlan(fixture.planId).artifacts[0]).toEqual(
      expect.objectContaining({
        id: "browser-output",
        status: "verified",
        sourceRunId: fixture.owner.runId,
        sha256: sha256("PNG"),
        sizeBytes: 3,
        evidence:
          "Browser output registration verified the declared screenshot bytes.",
      }),
    );
    const events = await fixture.store.listEvents(fixture.owner.threadId);
    expect(
      events
        .filter((event) => event.type.startsWith("plan.artifact."))
        .map((event) => event.type),
    ).toEqual(["plan.artifact.produced", "plan.artifact.verified"]);
    expect(
      verifyThreadReplayBundle(
        createThreadReplayBundle(
          await fixture.store.getDetail(fixture.owner.threadId),
        ),
      ).status,
    ).toBe("valid");
    fixture.store.close();
  });

  it("skips without a Run-bound Plan or exact declared path", async () => {
    const noPlan = await createFixture();
    const noPlanRegistration = await new BrowserOutputArtifactRegistrar(
      noPlan.store,
    ).register(noPlan.owner, output("downloads/report.pdf"));
    expect(noPlanRegistration).toEqual({
      status: "skipped",
      reason: "no_run_bound_plan",
    });
    noPlan.store.close();

    const mismatch = await createFixture("artifacts/expected.png");
    const mismatchRegistration = await new BrowserOutputArtifactRegistrar(
      mismatch.store,
    ).register(mismatch.owner, output("artifacts/other.png"));
    expect(mismatchRegistration).toEqual({
      status: "skipped",
      reason: "no_matching_artifact",
      planId: mismatch.planId,
    });
    expect(mismatch.store.getPlan(mismatch.planId).artifacts[0]?.status).toBe(
      "expected",
    );
    mismatch.store.close();
  });

  it("repairs a one-time standard Artifact event commit gap", async () => {
    const fixture = await createFixture("downloads/report.pdf");
    const registrar = new BrowserOutputArtifactRegistrar(fixture.store);
    await writeFile(
      path.join(fixture.workspaceRoot, "downloads/report.pdf"),
      "PRIVATE_DOWNLOAD_BODY",
    );
    const appendEvent = fixture.store.appendEvent.bind(fixture.store);
    let failProduced = true;
    fixture.store.appendEvent = async (input) => {
      if (input.type === "plan.artifact.produced" && failProduced) {
        failProduced = false;
        throw new Error("Injected Browser Artifact event commit gap");
      }
      return appendEvent(input);
    };

    const registration = await registrar.register(
      fixture.owner,
      output("downloads/report.pdf"),
    );

    expect(registration.status).toBe("registered");
    expect(
      (await fixture.store.listEvents(fixture.owner.threadId))
        .filter((event) => event.type.startsWith("plan.artifact."))
        .map((event) => event.type),
    ).toEqual(["plan.artifact.produced", "plan.artifact.verified"]);
    expect(
      verifyThreadReplayBundle(
        createThreadReplayBundle(
          await fixture.store.getDetail(fixture.owner.threadId),
        ),
      ).status,
    ).toBe("valid");
    fixture.store.close();
  });
});

function output(path: string) {
  return {
    action: "download" as const,
    path,
    pathSha256: sha256(path),
    fileSha256: sha256("PRIVATE_DOWNLOAD_BODY"),
    fileBytes: 21,
  };
}

async function createFixture(artifactPath?: string) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-artifact-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await mkdir(path.join(workspaceRoot, "artifacts"));
  await mkdir(path.join(workspaceRoot, "downloads"));
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Browser Artifact registration",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    source: "user",
  });
  let planId = "";
  if (artifactPath) {
    let plan = await store.createPlan(thread.id, {
      objective: "Capture one Browser output.",
      steps: [
        {
          id: "capture",
          title: "Capture Browser output",
          description: "Save the Browser output.",
          verification: "The declared Artifact is registered.",
        },
      ],
      artifacts: [
        {
          id: "browser-output",
          path: artifactPath,
          kind: "file",
          description: "The Browser output.",
        },
      ],
    });
    plan = await store.transitionPlanStep(plan.id, "capture", {
      action: "start",
      runId: run.id,
    });
    planId = plan.id;
  }
  return {
    store,
    workspaceRoot,
    owner: { threadId: thread.id, runId: run.id },
    planId,
  };
}
