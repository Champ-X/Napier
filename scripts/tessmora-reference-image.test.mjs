import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fetchReferenceImage } from "../integrations/tessmora/scripts/reference-image.mjs";

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tessmora-image-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=",
    "base64",
  );
  const requests = [];
  let body = image;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks).toString(),
    });
    if (request.url === "/api/chat/reference-image-url") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ img_url: `${baseUrl}/object?signature=private` }),
      );
    } else {
      response.setHeader("Content-Type", "application/octet-stream");
      response.end(body);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  const args = [
    "--kb-id",
    "source-kb",
    "--file-path",
    "images/source.png",
    "--output",
    "image.png",
    "--base-url",
    baseUrl,
  ];
  return {
    root,
    image,
    requests,
    args,
    setBody(value) {
      body = value;
    },
  };
}

it("resolves source metadata and retains original octet-stream image bytes with a stable receipt", async () => {
  const f = await fixture();
  const receipt = await fetchReferenceImage(f.args, f.root);
  expect(JSON.parse(f.requests[0].body)).toEqual({
    kb_id: "source-kb",
    file_path: "images/source.png",
  });
  expect(f.requests[0].method).toBe("POST");
  expect(await readFile(receipt.output)).toEqual(f.image);
  expect(receipt).toMatchObject({
    source: { knowledge_base_id: "source-kb", file_path: "images/source.png" },
    mime_type: "image/png",
    bytes: f.image.length,
    sha256: createHash("sha256").update(f.image).digest("hex"),
  });
  expect(JSON.stringify(receipt)).not.toContain("signature");
  await expect(fetchReferenceImage(f.args, f.root)).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(await readFile(receipt.output)).toEqual(f.image);
});

it("rejects non-image responses without publishing a file", async () => {
  const f = await fixture();
  f.setBody(Buffer.from("<html>error</html>"));
  await expect(fetchReferenceImage(f.args, f.root)).rejects.toThrow(
    "not a supported raster image",
  );
  await expect(readFile(path.join(f.root, "image.png"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("rejects output escape through a directory symlink before contacting the service", async () => {
  const f = await fixture();
  await symlink(tmpdir(), path.join(f.root, "escape"));
  f.args[f.args.indexOf("--output") + 1] = "escape/unexpected.png";
  await expect(fetchReferenceImage(f.args, f.root)).rejects.toThrow(
    "inside the current workspace",
  );
  expect(f.requests).toHaveLength(0);
});
