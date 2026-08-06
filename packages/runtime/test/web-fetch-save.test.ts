import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256 } from "../src/ed25519.js";
import type { PublicHttpResponse } from "../src/public-http-client.js";
import { LocalStore } from "../src/store.js";
import {
  createThreadReplayBundle,
  verifyThreadReplayBundle,
} from "../src/thread-bundles.js";
import { RunWebFetchSaveManager } from "../src/web-fetch-save.js";

const OWNER_URL = "https://example.com/report.pdf";
const PDF_BODY = minimalPdf("Saved PDF evidence.");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("RunWebFetchSaveManager", () => {
  it("saves exact raw bytes and verifies the declared file Artifact", async () => {
    const fixture = await createFixture("artifacts/report.pdf");
    const http = { request: vi.fn(async () => response()) };
    const manager = new RunWebFetchSaveManager({
      workspaceRoot: fixture.workspaceRoot,
      store: fixture.store,
      http,
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });

    const result = await manager.execute(fixture.owner, {
      url: OWNER_URL,
      path: "artifacts/report.pdf",
    });

    expect(http.request).toHaveBeenCalledOnce();
    await expect(
      readFile(path.join(fixture.workspaceRoot, "artifacts/report.pdf")),
    ).resolves.toEqual(PDF_BODY);
    expect(result.details).toEqual(
      expect.objectContaining({
        kind: "napier.web-fetch-save",
        pathSha256: sha256("artifacts/report.pdf"),
        fileSha256: sha256(PDF_BODY),
        fileBytes: PDF_BODY.byteLength,
        sourceFormat: "pdf",
        sourceBodySha256: sha256(PDF_BODY),
        sourceBodyBytes: PDF_BODY.byteLength,
        artifactRegistration: "artifact_registered",
      }),
    );
    expect(fixture.store.getPlan(fixture.planId).artifacts[0]).toEqual(
      expect.objectContaining({
        status: "verified",
        sourceRunId: fixture.owner.runId,
        sha256: sha256(PDF_BODY),
        sizeBytes: PDF_BODY.byteLength,
      }),
    );
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

  it("denies missing authority before network and refuses unsafe targets", async () => {
    const noPlan = await createFixture();
    const noPlanHttp = { request: vi.fn(async () => response()) };
    const noPlanManager = new RunWebFetchSaveManager({
      workspaceRoot: noPlan.workspaceRoot,
      store: noPlan.store,
      http: noPlanHttp,
    });
    await expect(
      noPlanManager.execute(noPlan.owner, {
        url: OWNER_URL,
        path: "artifacts/report.pdf",
      }),
    ).rejects.toThrow("requires one expected file Artifact");
    expect(noPlanHttp.request).not.toHaveBeenCalled();
    noPlan.store.close();

    const mismatch = await createFixture("artifacts/expected.pdf");
    const mismatchHttp = { request: vi.fn(async () => response()) };
    const mismatchManager = new RunWebFetchSaveManager({
      workspaceRoot: mismatch.workspaceRoot,
      store: mismatch.store,
      http: mismatchHttp,
    });
    await expect(
      mismatchManager.execute(mismatch.owner, {
        url: OWNER_URL,
        path: "artifacts/other.pdf",
      }),
    ).rejects.toThrow("requires one expected file Artifact");
    expect(mismatchHttp.request).not.toHaveBeenCalled();

    await writeFile(
      path.join(mismatch.workspaceRoot, "artifacts/expected.pdf"),
      "existing",
    );
    await expect(
      mismatchManager.execute(mismatch.owner, {
        url: OWNER_URL,
        path: "artifacts/expected.pdf",
      }),
    ).rejects.toThrow("already exists");
    expect(mismatchHttp.request).not.toHaveBeenCalled();
    mismatch.store.close();
  });

  it("rejects extension mismatch and symlink parents without leaving bytes", async () => {
    const extension = await createFixture("artifacts/report.txt");
    const extensionManager = new RunWebFetchSaveManager({
      workspaceRoot: extension.workspaceRoot,
      store: extension.store,
      http: { request: vi.fn(async () => response()) },
    });
    await expect(
      extensionManager.execute(extension.owner, {
        url: OWNER_URL,
        path: "artifacts/report.txt",
      }),
    ).rejects.toThrow("does not match pdf content");
    await expect(
      readFile(path.join(extension.workspaceRoot, "artifacts/report.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    extension.store.close();

    const symlinked = await createFixture("linked/report.pdf", undefined, true);
    const symlinkManager = new RunWebFetchSaveManager({
      workspaceRoot: symlinked.workspaceRoot,
      store: symlinked.store,
      http: { request: vi.fn(async () => response()) },
    });
    await expect(
      symlinkManager.execute(symlinked.owner, {
        url: OWNER_URL,
        path: "linked/report.pdf",
      }),
    ).rejects.toThrow("symlink");
    symlinked.store.close();
  });

  it("rechecks Plan authority after Fetch and before writing bytes", async () => {
    const fixture = await createFixture("artifacts/report.pdf");
    const manager = new RunWebFetchSaveManager({
      workspaceRoot: fixture.workspaceRoot,
      store: fixture.store,
      http: {
        request: vi.fn(async () => {
          await fixture.store.updatePlanArtifact(
            fixture.planId,
            "source-file",
            {
              status: "superseded",
              sourceRunId: fixture.owner.runId,
              evidence: "The operator superseded the output during Fetch.",
            },
          );
          return response();
        }),
      },
    });

    await expect(
      manager.execute(fixture.owner, {
        url: OWNER_URL,
        path: "artifacts/report.pdf",
      }),
    ).rejects.toThrow("Plan authority changed before write");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "artifacts/report.pdf")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(fixture.store.getPlan(fixture.planId).artifacts[0]?.status).toBe(
      "superseded",
    );
    fixture.store.close();
  });

  it("retains saved bytes when late Artifact settlement fails", async () => {
    const fixture = await createFixture("artifacts/report.pdf");
    const manager = new RunWebFetchSaveManager({
      workspaceRoot: fixture.workspaceRoot,
      store: fixture.store,
      http: { request: vi.fn(async () => response()) },
    });
    fixture.store.updatePlanArtifact = async () => {
      throw new Error("PRIVATE_SAVE_ARTIFACT_FAILURE");
    };

    const result = await manager.execute(fixture.owner, {
      url: OWNER_URL,
      path: "artifacts/report.pdf",
    });

    expect(result.details.artifactRegistration).toBe(
      "artifact_registration_failed",
    );
    await expect(
      readFile(path.join(fixture.workspaceRoot, "artifacts/report.pdf")),
    ).resolves.toEqual(PDF_BODY);
    expect(fixture.store.getPlan(fixture.planId).artifacts[0]?.status).toBe(
      "expected",
    );
    expect(
      JSON.stringify(await fixture.store.listEvents(fixture.owner.threadId)),
    ).not.toContain("PRIVATE_SAVE_ARTIFACT_FAILURE");
    fixture.store.close();
  });
});

async function createFixture(
  artifactPath?: string,
  artifactKind: "file" | "other" = "file",
  symlinkParent = false,
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-fetch-save-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await mkdir(path.join(workspaceRoot, "artifacts"));
  if (symlinkParent) {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(workspaceRoot, "linked"));
  }
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Web Fetch save",
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
      objective: "Save one public Source file.",
      steps: [
        {
          id: "save",
          title: "Save source",
          description: "Fetch and save the declared Source.",
          verification: "The file Artifact is verified.",
        },
      ],
      artifacts: [
        {
          id: "source-file",
          path: artifactPath,
          kind: artifactKind,
          description: "Raw fetched Source bytes.",
        },
      ],
    });
    plan = await store.transitionPlanStep(plan.id, "save", {
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

function response(): PublicHttpResponse {
  return {
    status: 200,
    headers: { "content-type": "application/pdf" },
    body: PDF_BODY,
    finalUrl: OWNER_URL,
    redirectCount: 0,
  };
}

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/[\()]/gu, "\$&");
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
