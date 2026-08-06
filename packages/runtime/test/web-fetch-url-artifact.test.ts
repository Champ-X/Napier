import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/store.js";
import {
  createThreadReplayBundle,
  verifyThreadReplayBundle,
} from "../src/thread-bundles.js";
import type { WebFetchSource } from "../src/web-fetch-model.js";
import { WebFetchUrlArtifactRegistrar } from "../src/web-fetch-url-artifact.js";

const SOURCE_URL = "https://example.com/report.pdf";
const SOURCE_LINES = ["Verified URL Artifact evidence."];
const SOURCE_CONTENT_SHA256 = sha256(canonicalJson(SOURCE_LINES));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Web Fetch URL Plan Artifact registration", () => {
  it("registers exact normalized Source evidence on the current Run-bound Plan", async () => {
    const fixture = await createFixture(SOURCE_URL);
    const registration = await new WebFetchUrlArtifactRegistrar(
      fixture.store,
    ).register(fixture.owner, source());

    expect(registration).toBe("artifact_registered");
    expect(fixture.store.getPlan(fixture.planId).artifacts[0]).toEqual(
      expect.objectContaining({
        id: "source-url",
        kind: "url",
        path: SOURCE_URL,
        status: "verified",
        sourceRunId: fixture.owner.runId,
        sha256: SOURCE_CONTENT_SHA256,
        sizeBytes: Buffer.byteLength(canonicalJson(SOURCE_LINES), "utf8"),
        evidence:
          "Web Fetch verified the declared URL against normalized Source content.",
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

  it("skips absent, mismatched, and non-URL declarations", async () => {
    const noPlan = await createFixture();
    await expect(
      new WebFetchUrlArtifactRegistrar(noPlan.store).register(
        noPlan.owner,
        source(),
      ),
    ).resolves.toBe("no_run_bound_plan");
    noPlan.store.close();

    const mismatch = await createFixture("https://example.com/other.pdf");
    await expect(
      new WebFetchUrlArtifactRegistrar(mismatch.store).register(
        mismatch.owner,
        source(),
      ),
    ).resolves.toBe("no_matching_artifact");
    expect(mismatch.store.getPlan(mismatch.planId).artifacts[0]?.status).toBe(
      "expected",
    );
    mismatch.store.close();

    const wrongKind = await createFixture(SOURCE_URL, "other");
    await expect(
      new WebFetchUrlArtifactRegistrar(wrongKind.store).register(
        wrongKind.owner,
        source(),
      ),
    ).resolves.toBe("no_matching_artifact");
    wrongKind.store.close();
  });

  it("requires the declared URL to equal the authoritative final URL", async () => {
    const requested = await createFixture(
      "https://example.com/requested-report",
    );
    await expect(
      new WebFetchUrlArtifactRegistrar(requested.store).register(
        requested.owner,
        source(),
      ),
    ).resolves.toBe("no_matching_artifact");
    expect(requested.store.getPlan(requested.planId).artifacts[0]?.status).toBe(
      "expected",
    );
    expect(
      (await requested.store.listEvents(requested.owner.threadId)).some(
        (event) => event.type.startsWith("plan.artifact."),
      ),
    ).toBe(false);
    requested.store.close();
  });

  it("repairs an event commit gap and isolates persistent Store failure", async () => {
    const repair = await createFixture(SOURCE_URL);
    const appendEvent = repair.store.appendEvent.bind(repair.store);
    let failProduced = true;
    repair.store.appendEvent = async (input) => {
      if (input.type === "plan.artifact.produced" && failProduced) {
        failProduced = false;
        throw new Error("Injected URL Artifact event commit gap");
      }
      return appendEvent(input);
    };

    await expect(
      new WebFetchUrlArtifactRegistrar(repair.store).register(
        repair.owner,
        source(),
      ),
    ).resolves.toBe("artifact_registered");
    expect(
      (await repair.store.listEvents(repair.owner.threadId))
        .filter((event) => event.type.startsWith("plan.artifact."))
        .map((event) => event.type),
    ).toEqual(["plan.artifact.produced", "plan.artifact.verified"]);
    repair.store.close();

    const failure = await createFixture(SOURCE_URL);
    failure.store.updatePlanArtifact = async () => {
      throw new Error("Injected URL Artifact Store failure");
    };
    await expect(
      new WebFetchUrlArtifactRegistrar(failure.store).register(
        failure.owner,
        source(),
      ),
    ).resolves.toBe("artifact_registration_failed");
    expect(failure.store.getPlan(failure.planId).artifacts[0]?.status).toBe(
      "expected",
    );
    failure.store.close();
  });
});

function source(): WebFetchSource {
  return {
    id: "websource_12345678",
    finalUrl: SOURCE_URL,
    title: "Report",
    retrievedAt: "2026-08-06T00:00:00.000Z",
    contentType: "application/pdf",
    format: "pdf",
    bodySha256: "a".repeat(64),
    contentSha256: SOURCE_CONTENT_SHA256,
    bodyBytes: 1_024,
    lineCount: SOURCE_LINES.length,
    textChars: SOURCE_LINES.join("\n").length,
    truncated: false,
    redirectCount: 0,
    pageCount: 1,
    renderMode: "static",
    browserFallbackStatus: "not_needed",
    lines: SOURCE_LINES,
  };
}

async function createFixture(
  artifactUrl?: string,
  artifactKind: "url" | "other" = "url",
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-url-artifact-"));
  roots.push(root);
  const store = new LocalStore({
    workspaceRoot: root,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Web Fetch URL Artifact",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    source: "user",
  });
  let planId = "";
  if (artifactUrl) {
    let plan = await store.createPlan(thread.id, {
      objective: "Fetch and verify one declared public URL.",
      steps: [
        {
          id: "fetch",
          title: "Fetch URL",
          description: "Fetch the declared URL.",
          verification: "The URL Artifact has verified Source evidence.",
        },
      ],
      artifacts: [
        {
          id: "source-url",
          path: artifactUrl,
          kind: artifactKind,
          description: "The fetched public Source.",
        },
      ],
    });
    plan = await store.transitionPlanStep(plan.id, "fetch", {
      action: "start",
      runId: run.id,
    });
    planId = plan.id;
  }
  return {
    store,
    owner: { threadId: thread.id, runId: run.id },
    planId,
  };
}
