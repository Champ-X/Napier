import { ToolOperationFencingError } from "./tool-operation-execution-authority.js";

export interface ToolOperationHeartbeatState {
  heartbeatTimer?: ReturnType<typeof setTimeout>;
  closed?: boolean;
}

export function scheduleToolOperationHeartbeat(
  state: ToolOperationHeartbeatState,
  intervalMs: number,
  heartbeat: () => Promise<void>,
): void {
  if (state.closed || state.heartbeatTimer) return;
  state.heartbeatTimer = setTimeout(() => {
    delete state.heartbeatTimer;
    void heartbeat()
      .then(() => scheduleToolOperationHeartbeat(state, intervalMs, heartbeat))
      .catch((error: unknown) => {
        if (error instanceof ToolOperationFencingError || state.closed) {
          state.closed = true;
          return;
        }
        scheduleToolOperationHeartbeat(state, intervalMs, heartbeat);
      });
  }, intervalMs);
  state.heartbeatTimer.unref?.();
}

export function stopToolOperationHeartbeat(
  state: ToolOperationHeartbeatState,
): void {
  state.closed = true;
  if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
  delete state.heartbeatTimer;
}
