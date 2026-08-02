export interface McpClientTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpClientCallResult {
  contentText: string;
  isError: boolean;
}

export interface McpClient {
  initialize(signal?: AbortSignal): Promise<void>;
  listTools(
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ tools: McpClientTool[]; nextCursor?: string }>;
  callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpClientCallResult>;
  close(): Promise<void>;
}
