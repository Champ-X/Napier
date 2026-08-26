import type { RunEvent } from "@napier/contracts";

import type { AppendEventInput } from "./run-event-registry.js";

export interface RunEventStorePort {
  appendEvent(input: AppendEventInput): Promise<RunEvent>;
}
