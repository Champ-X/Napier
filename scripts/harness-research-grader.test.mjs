import { expect, it } from "vitest";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { validateAudit } from "../benchmarks/harness-optimization/provider-reasoning-audit-v1/outcome.mjs";
const source = path.resolve(
  "benchmarks/harness-optimization/provider-reasoning-audit-v1",
);
it("accepts source-backed findings and rejects unsupported claims, stale quotes and false verification scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-research-grade-"));
  try {
    await cp(path.join(source, "fixture"), root, { recursive: true });
    expect(() => validateAudit(root)).toThrow();
    await cp(path.join(source, "expected"), root, { recursive: true });
    expect(() => validateAudit(root)).not.toThrow();
    const original = JSON.parse(
      await readFile(path.join(root, "findings.json"), "utf8"),
    );
    const models = (
      await readFile(path.join(root, "sources/models.js"), "utf8")
    )
      .trimEnd()
      .split("\n");
    const narrowed = structuredClone(original);
    const start = models.findIndex((line) =>
      line.includes("for (let i = requestedIndex;"),
    );
    narrowed.evidence.find((e) => e.id === "clamp-fallback").startLine =
      start + 1;
    narrowed.evidence.find((e) => e.id === "clamp-fallback").endLine =
      start + 5;
    narrowed.evidence.find((e) => e.id === "clamp-fallback").quote = models
      .slice(start, start + 5)
      .join("\n");
    await writeFile(path.join(root, "findings.json"), JSON.stringify(narrowed));
    expect(() => validateAudit(root)).not.toThrow();
    const mutations = [
      (r) => r.supportedLevels.push("minimal"),
      (r) => (r.minimalClampsTo = "off"),
      (r) => (r.shortRetry.maxTokens = 4096),
      (r) => (r.ordinaryCallChange = "disable"),
      (r) => (r.verificationScope = "live-tested"),
      (r) => (r.evidence[0].quote += "invented"),
      (r) => r.evidence[1].startLine++,
      (r) => (r.evidence[1].path = "../other"),
      (r) => (r.evidence[1] = r.evidence[0]),
      (r) => {
        r.evidence[1].startLine = 1;
        r.evidence[1].endLine = 1;
        r.evidence[1].quote =
          'const EXTENDED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];';
      },
    ];
    for (const mutate of mutations) {
      const altered = structuredClone(original);
      mutate(altered);
      await writeFile(
        path.join(root, "findings.json"),
        JSON.stringify(altered),
      );
      expect(() => validateAudit(root)).toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
