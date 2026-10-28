import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createApprovalFixture } from "./workflow-approval-recovery-setup.js";

const root = process.argv[2];
if (!root) throw new Error("Fixture root required");
const fixture = await createApprovalFixture(root);
const original = fixture.request.manifest;
const { manifest } = await fixture.embedded.define({
  ...original,
  name: "Two Workflow breakpoints",
  plan: {
    objective: original.blueprint.objective,
    steps: original.blueprint.steps,
  },
  nodes: original.nodes.map((node) =>
    node.id === "write"
      ? {
          ...node,
          inputBindings: {
            ...node.inputBindings,
            path: { source: "literal" as const, value: "breakpoint.txt" },
          },
        }
      : node,
  ),
});
const paused = await fixture.embedded.run({
  manifest,
  input: {},
  breakBeforeNodeIds: ["approve", "write"],
  title: "Two Workflow breakpoints",
});
await writeFile(
  path.join(root, "workflow-ui-fixture.json"),
  JSON.stringify({
    approval: {
      threadId: fixture.request.threadId,
      planId: fixture.request.planId,
      manifestSha256: original.contentSha256,
    },
    breakpoint: {
      threadId: paused.threadId,
      planId: paused.result.planId,
      manifestSha256: manifest.contentSha256,
    },
  }),
);
fixture.store.close();
