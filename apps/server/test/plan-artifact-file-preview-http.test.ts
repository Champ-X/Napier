import { createHash } from "node:crypto";
import { mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExecutionPlan, RunEvent } from "@napier/contracts";
import { MAX_WORKSPACE_FILE_PREVIEW_BYTES } from "@napier/contracts/file-preview";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerPlanArtifactFileHttp } from "../src/plan-artifact-file-http.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(
  filename = "image.png",
  contents = Buffer.from([0x89, 0x50, 0x4e, 0x47]),
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-file-preview-http-"));
  roots.push(root);
  await writeFile(path.join(root, filename), contents);
  const artifact: ExecutionPlan["artifacts"][number] = {
    id: "result",
    path: filename,
    kind: "file",
    description: "Preview fixture",
    status: "produced",
    evidence: "Fixture written to workspace",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  };
  const plan = {
    id: "plan_preview",
    threadId: "thread_preview",
    revision: 3,
    artifacts: [artifact],
  } as ExecutionPlan;
  const events: RunEvent[] = [];
  const app = new Hono();
  registerPlanArtifactFileHttp(app, {
    workspaceRoot: root,
    getPlan: (id) => {
      if (id !== plan.id) throw new Error("Plan missing");
      return plan;
    },
    appendEvent: async (input) => {
      const event: RunEvent = {
        id: `event_${events.length + 1}`,
        seq: events.length + 1,
        createdAt: "2026-09-26T00:00:00.000Z",
        visibility: input.visibility ?? "user",
        ...input,
      };
      events.push(event);
      return event;
    },
  });
  const endpoint = `/api/threads/${plan.threadId}/plans/${plan.id}/artifacts/${artifact.id}`;
  return { root, artifact, plan, events, app, endpoint, contents };
}

describe("binary plan artifact preview HTTP", () => {
  it("peeks with the same file evidence without writing to the Ledger", async () => {
    const { app, endpoint, contents, artifact, root, events } = await fixture();
    artifact.status = "verified";
    artifact.sha256 = createHash("sha256").update(contents).digest("hex");
    const response = await app.request(`${endpoint}/preview-file/peek`);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Napier-Read-Mode")).toBe("peek");
    expect(response.headers.get("X-Napier-Plan-Artifact-SHA256")).toBe(
      artifact.sha256,
    );
    expect(response.headers.get("X-Napier-Plan-Artifact-Id")).toBe(artifact.id);
    expect(response.headers.get("X-Napier-Ledger-Event-Id")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(contents);
    await writeFile(path.join(root, artifact.path), "drifted");
    expect((await app.request(`${endpoint}/preview-file/peek`)).status).toBe(
      400,
    );
    expect(events).toEqual([]);
  });

  it.each([
    ["image.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ["image.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    [
      "report.pdf",
      "application/pdf",
      Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff]),
    ],
    ["ascii.pdf", "application/pdf", Buffer.from("%PDF-1.7\nASCII PDF")],
  ])(
    "previews %s bytes with artifact identity and a preview receipt",
    async (filename, mime, contents) => {
      const { app, endpoint, plan, artifact, events } = await fixture(
        filename,
        contents,
      );
      const sha256 = createHash("sha256").update(contents).digest("hex");
      const response = await app.request(`${endpoint}/preview-file`);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(mime);
      expect(response.headers.get("Content-Disposition")).toBe(
        `inline; filename="${filename}"`,
      );
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Napier-Content-SHA256")).toBe(sha256);
      expect(response.headers.get("X-Napier-Content-SHA256-Mode")).toBe(
        "stable",
      );
      expect(response.headers.get("X-Napier-Thread-Id")).toBe(plan.threadId);
      expect(response.headers.get("X-Napier-Plan-Id")).toBe(plan.id);
      expect(response.headers.get("X-Napier-Plan-Revision")).toBe("3");
      expect(response.headers.get("X-Napier-Plan-Artifact-Id")).toBe(
        artifact.id,
      );
      expect(response.headers.get("X-Napier-Plan-Artifact-Status")).toBe(
        "produced",
      );
      expect(response.headers.get("X-Napier-Plan-Artifact-Kind")).toBe("file");
      expect(response.headers.get("X-Napier-Plan-Artifact-Path")).toBe(
        encodeURIComponent(filename),
      );
      expect(response.headers.get("X-Napier-Plan-Artifact-Path-SHA256")).toBe(
        createHash("sha256").update(filename).digest("hex"),
      );
      expect(response.headers.get("X-Napier-Plan-Artifact-SHA256")).toBe(
        sha256,
      );
      expect(response.headers.get("X-Napier-Plan-Artifact-Size-Bytes")).toBe(
        String(contents.byteLength),
      );
      expect(response.headers.get("X-Napier-Ledger-Event-Id")).toBe("event_1");
      expect(response.headers.get("X-Napier-Ledger-Event-Seq")).toBe("1");
      expect(response.headers.get("X-Napier-Ledger-Event-SHA256")).toBe(
        createHash("sha256").update(JSON.stringify(events[0])).digest("hex"),
      );
      expect(Buffer.from(await response.arrayBuffer())).toEqual(contents);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "artifact.previewed",
        payload: {
          previewKind: "file",
          contentType: mime,
          sha256,
          sizeBytes: contents.byteLength,
        },
      });
      expect(events[0]!.payload).not.toHaveProperty("contents");
    },
  );

  it("accepts verified bytes but rejects drift before adding a preview event", async () => {
    const { app, endpoint, artifact, root, contents, events } = await fixture();
    artifact.status = "verified";
    artifact.sha256 = createHash("sha256").update(contents).digest("hex");
    const accepted = await app.request(`${endpoint}/preview-file`);
    expect(accepted.status).toBe(200);
    await writeFile(path.join(root, artifact.path), "replaced");

    const rejected = await app.request(`${endpoint}/preview-file`);

    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain(
      "Verified artifact digest drifted",
    );
    expect(events).toHaveLength(1);
  });

  it("does not preview unexpected artifacts or artifacts from another thread", async () => {
    const { app, endpoint, artifact, events } = await fixture();
    artifact.status = "expected";
    expect((await app.request(`${endpoint}/preview-file`)).status).toBe(400);
    expect(
      (
        await app.request(
          `${endpoint.replace("thread_preview", "thread_other")}/preview-file`,
        )
      ).status,
    ).toBe(404);
    expect(events).toEqual([]);
  });

  it("rejects workspace escapes and symbolic links before reading file bytes", async () => {
    const { app, endpoint, root, artifact, events } = await fixture();
    await symlink(path.join(root, artifact.path), path.join(root, "link.png"));
    artifact.path = "link.png";
    const linked = await app.request(`${endpoint}/preview-file`);
    expect(linked.status).toBe(400);
    expect((await linked.json()).error).toContain("cannot be symbolic links");
    artifact.path = "../outside.png";
    const outside = await app.request(`${endpoint}/preview-file`);
    expect(outside.status).toBe(400);
    expect((await outside.json()).error).toContain(
      "escapes the configured workspace",
    );
    expect(events).toEqual([]);
  });

  it("previews and downloads larger artifacts through the shared file limit", async () => {
    const { app, endpoint, root, artifact, events } =
      await fixture("large.pdf");
    const file = await open(path.join(root, artifact.path), "r+");
    try {
      const bytes = 32 * 1024 * 1024 + 1;
      await file.truncate(bytes);
      const preview = await app.request(`${endpoint}/preview-file`);
      expect(preview.status).toBe(200);
      expect(preview.headers.get("X-Napier-Plan-Artifact-Size-Bytes")).toBe(
        String(bytes),
      );
      const download = await app.request(`${endpoint}/file`);
      expect(download.status).toBe(200);
      expect(download.headers.get("X-Napier-Plan-Artifact-Size-Bytes")).toBe(
        String(bytes),
      );
      expect(download.headers.get("Content-Type")).toBe(
        "application/octet-stream",
      );
      expect(download.headers.get("Content-Disposition")).toContain(
        "attachment;",
      );
      expect((await download.arrayBuffer()).byteLength).toBe(bytes);
      expect(events[1]!.type).toBe("artifact.exported");
      await file.truncate(MAX_WORKSPACE_FILE_PREVIEW_BYTES + 1);
      const tooLarge = await app.request(`${endpoint}/preview-file`);
      expect(tooLarge.status).toBe(413);
      expect((await tooLarge.json()).error).toContain(
        `${MAX_WORKSPACE_FILE_PREVIEW_BYTES / 1024 / 1024} MiB file limit`,
      );
      const oversizedDownload = await app.request(`${endpoint}/file`);
      expect(oversizedDownload.status).toBe(400);
      expect(events).toHaveLength(2);
    } finally {
      await file.close();
    }
  });

  it.each(["page.html", "image.svg"])(
    "sandboxes direct navigation to %s",
    async (filename) => {
      const { app, endpoint } = await fixture(
        filename,
        Buffer.from("<script>throw 1</script>"),
      );
      const response = await app.request(`${endpoint}/preview-file`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "sandbox;",
      );
      expect(response.headers.get("Content-Security-Policy")).not.toContain(
        "allow-same-origin",
      );
    },
  );
});
