import type { RunEvent } from "@napier/contracts";

export type EventSink = (event: RunEvent) => Promise<void> | void;
