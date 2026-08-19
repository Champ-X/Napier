import type {
  CreatedInboundChannel,
  InboundChannelAdapter,
  InboundChannelPolicyTemplateId,
} from "@napier/contracts";

import { createInboundChannel } from "./automation-api";
import type { AutomationOperationController } from "./use-automation-operation";

export interface CreateAutomationChannelOptions {
  threadId: string;
  name: string;
  adapter: InboundChannelAdapter;
  policyTemplate: InboundChannelPolicyTemplateId;
  maxAttempts: number;
  retrySeconds: number;
  signatureRequired: boolean;
  operation: AutomationOperationController;
  refresh: () => Promise<void>;
}

export async function createAutomationChannel({
  threadId,
  name,
  adapter,
  policyTemplate,
  maxAttempts,
  retrySeconds,
  signatureRequired,
  operation,
  refresh,
}: CreateAutomationChannelOptions): Promise<CreatedInboundChannel | undefined> {
  const result = await operation.run("new-channel", async () => {
    const created = await createInboundChannel({
      name: name.trim(),
      threadId,
      adapter,
      ...(policyTemplate === "custom"
        ? {
            policyTemplate: "custom" as const,
            retryPolicy: {
              maxAttempts,
              baseDelayMs: Math.round(retrySeconds * 1_000),
            },
            signaturePolicy: {
              required: signatureRequired,
              toleranceSeconds: 300,
            },
          }
        : { policyTemplate }),
    });
    await refresh();
    return created;
  });
  return result.ok ? result.value : undefined;
}

export async function copyAutomationChannelToken(
  createdChannel: CreatedInboundChannel | undefined,
): Promise<boolean> {
  if (!createdChannel) return false;
  try {
    await navigator.clipboard.writeText(createdChannel.token);
    return true;
  } catch {
    return false;
  }
}
