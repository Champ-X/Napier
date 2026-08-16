import { createAgentKernel, type AgentKernel } from "./agent-kernel.js";
import {
  loadKernelPluginDesiredState,
  reconcileBuiltinKernelPluginState,
} from "./kernel-plugin-state.js";

export async function createPersistedAgentKernel(
  dataRoot: string,
  input: Parameters<typeof createAgentKernel>[0],
): Promise<AgentKernel> {
  const state = (await loadKernelPluginDesiredState(dataRoot)).desiredState;
  const kernel = await createAgentKernel(input);
  try {
    await reconcileBuiltinKernelPluginState(state, kernel.plugins);
    return kernel;
  } catch (error) {
    await kernel.shutdown().catch(() => undefined);
    throw error;
  }
}
