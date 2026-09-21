import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const requirements = {
  "model-metadata": {
    path: "sources/deepseek.json",
    anchors: ['"deepseek-v4-flash"', '"minimal":null', '"high":"high"'],
  },
  "level-filter": {
    path: "sources/models.js",
    anchors: [
      "const mapped = model.thinkingLevelMap?.[level]",
      "if (mapped === null)",
      'if (level === "xhigh" || level === "max")',
    ],
  },
  "clamp-fallback": {
    path: "sources/models.js",
    anchors: [
      "for (let i = requestedIndex;",
      "if (availableLevels.includes(candidate))",
      "return candidate;",
    ],
  },
  "simple-wrapper": {
    path: "sources/simple-wrapper.js",
    anchors: [
      "clampThinkingLevel(model, options.reasoning)",
      'clampedReasoning === "off" ? undefined',
    ],
  },
  "wire-disable": {
    path: "sources/deepseek-payload.js",
    anchors: [
      'compat.thinkingFormat === "deepseek"',
      "else if (model.thinkingLevelMap?.off !== null)",
      'params.thinking = { type: "disabled" }',
    ],
  },
};
export function validateAudit(root) {
  const findings = JSON.parse(
    readFileSync(path.join(root, "findings.json"), "utf8"),
  );
  assert.equal(findings.modelId, "deepseek-v4-flash");
  assert.deepEqual(findings.supportedLevels, ["off", "high", "max"]);
  assert.equal(findings.minimalClampsTo, "high");
  assert.deepEqual(findings.shortRetry, {
    reasoningOption: "omit",
    maxTokens: 2048,
    thinkingType: "disabled",
  });
  assert.equal(findings.ordinaryCallChange, "none");
  assert.equal(findings.verificationScope, "source-inspection-only");
  assert.ok(Array.isArray(findings.evidence));
  assert.deepEqual(
    findings.evidence.map((e) => e.id).sort(),
    Object.keys(requirements).sort(),
  );
  const report = readFileSync(path.join(root, "REPORT.md"), "utf8");
  for (const e of findings.evidence) {
    const expected = requirements[e.id];
    assert.equal(e.path, expected.path);
    const lines = readFileSync(path.join(root, e.path), "utf8")
      .trimEnd()
      .split(/\r?\n/u);
    assert.ok(
      Number.isSafeInteger(e.startLine) &&
        Number.isSafeInteger(e.endLine) &&
        e.startLine >= 1 &&
        e.endLine >= e.startLine &&
        e.endLine <= lines.length &&
        e.endLine - e.startLine < 20,
    );
    assert.equal(e.quote, lines.slice(e.startLine - 1, e.endLine).join("\n"));
    for (const anchor of expected.anchors)
      assert.ok(e.quote.includes(anchor), `${e.id} does not support its claim`);
    assert.ok(report.includes(e.id), `${e.id} is not referenced in the report`);
  }
  assert.match(report, /minimal/iu);
  assert.match(report, /high/iu);
  assert.match(report, /2048/u);
  // The structured scope and source citations are graded. Freeform explanatory
  // prose is retained for review, not represented as live-provider evidence.
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  validateAudit(process.cwd());
  console.log(
    "Source-derived compatibility findings and five exact citation ranges verified",
  );
}
