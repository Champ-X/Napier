import type { RunEvent } from "@napier/contracts";

import { compilePromptInvariantCore } from "./prompt-invariant-core.js";
import { validateResearchSourceCapsuleReceipt } from "./research-source-capsule.js";
import { validateWebFetchStateCapsuleReceipt } from "./web-fetch-capsule.js";

export function formatSourceContinuityGuidance(events: readonly RunEvent[]) {
  const lines = [];
  const research = events.findLast(
    (event) => event.type === "context.research_sources",
  );
  if (research) {
    const receipt = validateResearchSourceCapsuleReceipt(research.payload);
    lines.push(
      `Private local Research Sources continue into this Run (${receipt.sourceCount} Sources, ${receipt.citationCount} citations, set ${receipt.sourceSetSha256}). Call research_source list before reusing Source or citation IDs.`,
    );
  }
  const webFetch = events.findLast(
    (event) => event.type === "context.web_fetch_sources",
  );
  if (webFetch) {
    const receipt = validateWebFetchStateCapsuleReceipt(webFetch.payload);
    lines.push(
      `Private local Web Fetch Sources continue into this Run (${receipt.sourceCount} Sources, set ${receipt.sourceSetSha256}). Call web_fetch list before reusing IDs; read/find/capture_fetch use exact content hashes without another request.`,
    );
  }
  return lines.join("\n");
}

export function appendSourceContinuityGuidance(
  systemPrompt: string,
  guidance: string,
): string {
  const compiled = compilePromptInvariantCore(systemPrompt);
  return guidance ? `${compiled}\n\n${guidance}` : compiled;
}
