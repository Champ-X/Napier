import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertSubagentOutcomeBinding,
  createGroundedSubagentOutcome,
  createSubagentOutcome,
  formatSubagentOutcome,
  rebindSubagentOutcome,
  validateSubagentOutcome,
} from "../src/subagent-outcomes.js";

const temporaryRoots: string[] = [];

const TASK = {
  taskId: "task_outcome_fixture",
  role: "reviewer" as const,
  model: { provider: "faux", id: "faux-1" },
  prompt: "Review the runtime boundary.",
};

const RESULT = JSON.stringify({
  summary: "The boundary is enforced, with one remaining test gap.",
  items: [
    {
      kind: "risk",
      severity: "warning",
      title: "Missing restart coverage",
      detail: "The terminal receipt should be checked after restart.",
      evidence: [
        {
          path: "src/example.ts",
          lineStart: 1,
          lineEnd: 2,
        },
      ],
    },
  ],
  unknowns: ["External provider retry behavior was not exercised."],
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-outcome-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src/example.ts"),
    "line one\nline two\nline three\n",
    "utf8",
  );
  return root;
}

describe("Subagent outcomes", () => {
  it("normalizes typed results into grounded hash-bound task receipts", async () => {
    const workspaceRoot = await createWorkspace();
    const outcome = await createGroundedSubagentOutcome({
      ...TASK,
      resultText: RESULT,
      workspaceRoot,
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-outcome",
        schemaVersion: 2,
        taskId: TASK.taskId,
        role: "reviewer",
        model: TASK.model,
        itemCount: 1,
        unknownCount: 1,
        evidenceCount: 1,
        promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        instructionsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        itemSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        evidenceSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(outcome.items[0]?.evidence[0]).toEqual(
      expect.objectContaining({
        path: "src/example.ts",
        lineStart: 1,
        lineEnd: 2,
        fileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        rangeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        fileSizeBytes: 29,
        observedLineCount: 2,
      }),
    );
    expect(validateSubagentOutcome(outcome)).toEqual(outcome);
    expect(
      assertSubagentOutcomeBinding(outcome, {
        id: TASK.taskId,
        role: TASK.role,
        model: TASK.model,
        prompt: TASK.prompt,
      }),
    ).toEqual(outcome);
    expect(formatSubagentOutcome(outcome)).toContain(
      "[warning] Missing restart coverage",
    );
    expect(formatSubagentOutcome(outcome)).toContain("src/example.ts:1-2");
  });

  it("continues to verify schema-1 receipts without grounding fields", () => {
    const legacy = createSubagentOutcome({
      ...TASK,
      resultText: JSON.stringify({
        summary: "Legacy receipt remains valid.",
        items: [],
        unknowns: [],
      }),
    });

    expect(legacy.schemaVersion).toBe(1);
    expect(legacy).not.toHaveProperty("evidenceCount");
    expect(legacy).not.toHaveProperty("evidenceSetSha256");
    expect(validateSubagentOutcome(legacy)).toEqual(legacy);
  });

  it("rejects unknown fields, unsafe paths, and incomplete line evidence", () => {
    expect(() =>
      createSubagentOutcome({
        ...TASK,
        resultText: JSON.stringify({
          summary: "Invalid extra field.",
          items: [],
          unknowns: [],
          extra: true,
        }),
      }),
    ).toThrow("unsupported field");
    expect(() =>
      createSubagentOutcome({
        ...TASK,
        resultText: JSON.stringify({
          summary: "Unsafe evidence.",
          items: [
            {
              kind: "finding",
              severity: "info",
              title: "Unsafe path",
              detail: "Absolute paths are not portable.",
              evidence: [{ path: "/tmp/private", lineStart: 1, lineEnd: 1 }],
            },
          ],
          unknowns: [],
        }),
      }),
    ).toThrow("workspace-relative");
    expect(() =>
      createSubagentOutcome({
        ...TASK,
        resultText: JSON.stringify({
          summary: "Incomplete evidence.",
          items: [
            {
              kind: "finding",
              severity: "info",
              title: "Incomplete range",
              detail: "Both line bounds are required.",
              evidence: [{ path: "README.md", lineStart: 1 }],
            },
          ],
          unknowns: [],
        }),
      }),
    ).toThrow("line range is incomplete");
  });

  it("fails closed when claimed evidence is missing or outside the file", async () => {
    const workspaceRoot = await createWorkspace();
    await expect(
      createGroundedSubagentOutcome({
        ...TASK,
        workspaceRoot,
        resultText: JSON.stringify({
          summary: "Missing evidence.",
          items: [
            {
              kind: "finding",
              severity: "warning",
              title: "Missing file",
              detail: "The cited file does not exist.",
              evidence: [{ path: "src/missing.ts" }],
            },
          ],
          unknowns: [],
        }),
      }),
    ).rejects.toThrow();
    await expect(
      createGroundedSubagentOutcome({
        ...TASK,
        workspaceRoot,
        resultText: JSON.stringify({
          summary: "Out of range evidence.",
          items: [
            {
              kind: "finding",
              severity: "warning",
              title: "Invalid lines",
              detail: "The cited lines do not exist.",
              evidence: [{ path: "src/example.ts", lineStart: 8, lineEnd: 9 }],
            },
          ],
          unknowns: [],
        }),
      }),
    ).rejects.toThrow("exceeds");
  });

  it("detects tampering and rebinds imported task identities", async () => {
    const outcome = await createGroundedSubagentOutcome({
      ...TASK,
      resultText: RESULT,
      workspaceRoot: await createWorkspace(),
    });
    const tampered = structuredClone(outcome);
    tampered.items[0]!.detail = "Tampered";
    expect(() => validateSubagentOutcome(tampered)).toThrow("hash evidence");

    const rebound = rebindSubagentOutcome(outcome, {
      taskId: "task_imported_fixture",
      prompt: TASK.prompt,
    });
    expect(rebound).toEqual(
      expect.objectContaining({
        taskId: "task_imported_fixture",
        resultSha256: outcome.resultSha256,
        itemSetSha256: outcome.itemSetSha256,
        contentSha256: expect.not.stringMatching(outcome.contentSha256),
      }),
    );
    expect(
      assertSubagentOutcomeBinding(rebound, {
        id: "task_imported_fixture",
        role: TASK.role,
        model: TASK.model,
        prompt: TASK.prompt,
      }),
    ).toEqual(rebound);
  });
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});
