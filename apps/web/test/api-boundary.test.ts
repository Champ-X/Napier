import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(webRoot, "src");
const allowedFetchCallers = new Set(["src/api-client.ts", "src/api.ts"]);

describe("Web API boundary", () => {
  it("keeps direct fetch calls behind hash-verified JSON and SSE clients", async () => {
    const files = await listSourceFiles(sourceRoot);
    const directFetchCallers = [];

    for (const filePath of files) {
      const source = await readFile(filePath, "utf8");
      if (/\bfetch\s*\(/.test(source)) {
        directFetchCallers.push(toWebRelativePath(filePath));
      }
    }

    expect(directFetchCallers.sort()).toEqual([...allowedFetchCallers].sort());
  });

  it("keeps hash-verified JSON requests scoped to management API routes", async () => {
    const files = await listSourceFiles(sourceRoot);
    const invalidCallers = [];

    for (const filePath of files) {
      if (toWebRelativePath(filePath) === "src/api-client.ts") continue;
      const source = await readFile(filePath, "utf8");
      for (const call of requestJsonCallSites(source)) {
        const suffix = source.slice(call.index + call.text.length);
        if (!/^\s*(["'`])\/api(?:[/?#${]|$)/.test(suffix)) {
          invalidCallers.push(`${toWebRelativePath(filePath)}:${call.line}`);
        }
      }
    }

    expect(invalidCallers).toEqual([]);
  });
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry);
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      files.push(...(await listSourceFiles(filePath)));
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry)) files.push(filePath);
  }
  return files;
}

function toWebRelativePath(filePath: string): string {
  return path.relative(webRoot, filePath).split(path.sep).join("/");
}

function requestJsonCallSites(
  source: string,
): { index: number; line: number; text: string }[] {
  return [...source.matchAll(/\brequestJson\s*(?:<[^>]+>)?\s*\(/g)].map(
    (match) => ({
      index: match.index ?? 0,
      line: lineNumberAt(source, match.index ?? 0),
      text: match[0]!,
    }),
  );
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}
