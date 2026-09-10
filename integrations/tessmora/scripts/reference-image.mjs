import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 20 * 1024 * 1024;

// The upstream file content/stream routes do not serve extracted images.
// Use the same reference resolver as Tessmora's chat UI, then retain bytes.
export async function fetchReferenceImage(args, cwd = process.cwd()) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (
      !["--kb-id", "--file-path", "--output", "--base-url"].includes(key) ||
      !args[index + 1] ||
      options[key] !== undefined
    ) {
      throw new Error(
        "Expected --kb-id ID --file-path PATH --output FILE [--base-url URL]",
      );
    }
    options[key] = args[index + 1];
  }
  for (const key of ["--kb-id", "--file-path", "--output"]) {
    if (!options[key]) throw new Error(`Missing ${key}`);
  }
  const root = await realpath(cwd);
  const output = path.resolve(root, options["--output"]);
  const parent = await realpath(path.dirname(output));
  const relative = path.relative(root, parent);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Image output must be inside the current workspace");
  }
  const source = {
    knowledge_base_id: options["--kb-id"],
    file_path: options["--file-path"],
  };
  const endpoint = new URL(
    "/api/chat/reference-image-url",
    options["--base-url"] ??
      process.env.MMA_RAG_BASE_URL ??
      "http://127.0.0.1:8000",
  );
  const signal = AbortSignal.timeout(30000);
  const resolved = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kb_id: source.knowledge_base_id,
      file_path: source.file_path,
    }),
  });
  if (!resolved.ok)
    throw new Error(`Image resolver returned HTTP ${resolved.status}`);
  const { img_url: imageUrl } = await resolved.json();
  if (typeof imageUrl !== "string" || !/^https?:\/\//u.test(imageUrl)) {
    throw new Error("Image resolver did not return an HTTP image URL");
  }
  const response = await fetch(imageUrl, { signal });
  if (!response.ok)
    throw new Error(`Image download returned HTTP ${response.status}`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error("Image exceeds 20 MiB");
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks);
  const mimeType = imageMimeType(content);
  if (!mimeType)
    throw new Error("Downloaded content is not a supported raster image");
  // Exclusive creation also refuses final-component symlinks and overwrites.
  await writeFile(path.join(parent, path.basename(output)), content, {
    flag: "wx",
  });
  return {
    source,
    output,
    bytes,
    mime_type: mimeType,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function imageMimeType(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return "image/jpeg";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString()))
    return "image/gif";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return undefined;
}
