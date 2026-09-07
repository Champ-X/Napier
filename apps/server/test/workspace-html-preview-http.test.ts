import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerWorkspaceDirectoriesHttp } from "../src/workspace-directories-http.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "napier-html-preview-")),
  );
  roots.push(root);
  await mkdir(path.join(root, "slides/assets"), { recursive: true });
  await writeFile(
    path.join(root, "slides/index.html"),
    '<link rel="stylesheet" href="assets/style.css"><script type="module" src="assets/main.js"></script>',
  );
  await writeFile(
    path.join(root, "slides/assets/style.css"),
    '.slide { background: url("paper.svg"); }',
  );
  await writeFile(
    path.join(root, "slides/assets/main.js"),
    'import "./child.js";',
  );
  await writeFile(
    path.join(root, "slides/assets/child.js"),
    'document.title = "Loaded";',
  );
  await writeFile(
    path.join(root, "slides/assets/paper.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  let activeRoot = root;
  const app = new Hono();
  registerWorkspaceDirectoriesHttp(app, undefined, () => activeRoot);
  const response = await app.request(
    "/api/workspace/file?path=slides/index.html",
  );
  const url = response.headers.get("X-Napier-Workspace-Preview-Url")!;
  expect(url).toMatch(/^\/api\/workspace\/preview\/[a-f0-9]{48}\/index.html$/u);
  return {
    app,
    root,
    url,
    prefix: url.slice(0, url.lastIndexOf("/") + 1),
    rebind: () => {
      activeRoot = path.join(root, "other");
    },
  };
}

describe("workspace HTML site preview", () => {
  it("serves unchanged HTML and nested relative CSS, module, and image resources", async () => {
    const { app, root, url } = await fixture();
    const html = await app.request(url);
    expect(await html.text()).toBe(
      await readFile(path.join(root, "slides/index.html"), "utf8"),
    );
    for (const [name, mime] of [
      ["style.css", "text/css"],
      ["main.js", "text/javascript"],
      ["child.js", "text/javascript"],
      ["paper.svg", "image/svg+xml"],
    ]) {
      const assetUrl = new URL(`assets/${name}`, `http://localhost${url}`);
      const response = await app.request(assetUrl.href);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain(mime);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(
        response.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();
    }
    const policy = html.headers.get("Content-Security-Policy")!;
    expect(policy).toContain("sandbox allow-scripts;");
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain("'self'");
  });

  it("blocks traversal, dotfiles, symlink assets, and requests outside the preview directory", async () => {
    const { app, root, prefix } = await fixture();
    await writeFile(path.join(root, "private.txt"), "private");
    await writeFile(path.join(root, "slides/.env"), "private");
    await symlink(
      path.join(root, "private.txt"),
      path.join(root, "slides/link.txt"),
    );
    for (const target of [
      ".env",
      "link.txt",
      "private.txt",
      "%2e%2e%2fprivate.txt",
      "assets%2f..%2f..%2fprivate.txt",
      "assets%5c..%5cprivate.txt",
    ]) {
      const response = await app.request(`${prefix}${target}`);
      expect(response.status, target).toBe(404);
      expect(await response.text()).not.toContain("private");
    }
  });

  it("pins inspected HTML bytes and expires the site when the active workspace changes", async () => {
    const { app, root, url, rebind } = await fixture();
    await writeFile(path.join(root, "slides/index.html"), "new task");
    expect(await (await app.request(url)).text()).toContain("assets/main.js");
    rebind();
    expect((await app.request(url)).status).toBe(410);
  });

  it("resolves legacy conversation links within their Thread and leaves file-tree paths explicit", async () => {
    const { app, root } = await fixture();
    for (const thread of ["thread_first", "thread_second"]) {
      await mkdir(path.join(root, "outputs", thread), { recursive: true });
      await writeFile(path.join(root, "outputs", thread, "index.html"), thread);
    }
    await writeFile(path.join(root, "index.html"), "workspace file");
    for (const threadId of ["thread_first", "thread_second"]) {
      const response = await app.request(
        `/api/workspace/file?${new URLSearchParams({ path: "index.html", threadId })}`,
      );
      expect(await response.text()).toBe(threadId);
      expect(
        decodeURIComponent(
          response.headers.get("X-Napier-Workspace-File-Path")!,
        ),
      ).toBe(path.join(root, "outputs", threadId, "index.html"));
    }
    expect(
      await (
        await app.request(
          `/api/workspace/file?${new URLSearchParams({ path: path.join(root, "index.html"), threadId: "thread_first" })}`,
        )
      ).text(),
    ).toBe("workspace file");
    expect(
      (
        await app.request(
          "/api/workspace/file?path=index.html&threadId=../escape",
        )
      ).status,
    ).toBe(400);
  });
});
