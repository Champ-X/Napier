import type { RunEvent } from "@napier/contracts";
import { isSkillResourceLoadReceiptV1 } from "@napier/contracts/skill-resource";

import type { MessageSkillResourceLink } from "./message-markdown";

export function conversationSkillResourceLinks(
  events: readonly RunEvent[],
): MessageSkillResourceLink[] {
  const latest = new Map<string, MessageSkillResourceLink>();
  for (const event of events) {
    if (event.type !== "tool.completed") continue;
    const details = eventDetails(event);
    if (!isSkillResourceLoadReceiptV1(details)) continue;
    latest.set(`${details.skillName}:${details.resourcePath}`, {
      skillName: details.skillName,
      resourcePath: details.resourcePath,
      relativePath: details.relativePath,
      virtualPath: details.virtualPath,
      rootKind: details.rootKind,
      rawContentSha256: details.rawContentSha256,
    });
  }
  return [...latest.values()];
}

function eventDetails(event: RunEvent): unknown {
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  return event.payload["details"];
}
