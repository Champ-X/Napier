import { createNapierManagementClient } from "@napier/sdk/management";

const [baseUrl, agentId = "agent_napier"] = process.argv.slice(2);
if (!baseUrl) {
  throw new Error(
    "Usage: node effective-capabilities.mjs <base-url> [agent-id]",
  );
}

const projection = await createNapierManagementClient({
  baseUrl,
}).getEffectiveAgentCapabilities({ agentId });
process.stdout.write(
  `${JSON.stringify({
    agentId: projection.agentId,
    agentRevision: projection.agentRevision,
    driftState: projection.driftState,
    ownership: projection.ownership,
    projectionSha256: projection.projectionSha256,
  })}\n`,
);
