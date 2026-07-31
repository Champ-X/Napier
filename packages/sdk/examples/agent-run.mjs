import { createNapierClient } from "../dist/index.js";

const [workspaceRoot, dataRoot] = process.argv.slice(2);
if (!workspaceRoot || !dataRoot) {
  throw new Error("Usage: node agent-run.mjs <workspace-root> <data-root>");
}

const client = await createNapierClient({ workspaceRoot, dataRoot });
try {
  const eventTypes = [];
  const first = await client.runAgent({
    prompt: "Record one SDK Agent task without fabricating external work.",
    title: "SDK Agent example",
    model: { provider: "napier", id: "demo" },
    onEvent: (event) => {
      eventTypes.push(event.type);
    },
  });
  const continued = await client.runAgent({
    threadId: first.threadId,
    prompt: "Continue the same SDK Thread from its existing Ledger.",
    model: { provider: "napier", id: "demo" },
    onEvent: (event) => {
      eventTypes.push(event.type);
    },
  });
  process.stdout.write(
    `${JSON.stringify({
      threadId: first.threadId,
      runIds: [first.runId, continued.runId],
      statuses: [first.status, continued.status],
      firstAssistantText: first.assistantText,
      continuedAssistantText: continued.assistantText,
      eventTypes,
    })}\n`,
  );
} finally {
  await client.close();
}
