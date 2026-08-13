import type { Hono } from "hono";
import type { CredentialReferenceStore } from "@napier/runtime";

import { registerBrowserTaskHttp } from "./browser-task-http.js";
import { BrowserTaskService } from "./browser-task-service.js";

export class BrowserTasks extends BrowserTaskService {
  constructor(
    dataRoot: string,
    credentials?: CredentialReferenceStore,
    env: Readonly<Record<string, string | undefined>> = process.env,
  ) {
    super({
      dataRoot,
      env,
      ...(credentials
        ? {
            resolveCredential: async (providerId: string) => {
              const credential = await credentials.read(providerId);
              return credential?.type === "api_key"
                ? credential.key
                : undefined;
            },
          }
        : {}),
    });
  }

  register(app: Hono): void {
    registerBrowserTaskHttp(app, this);
  }

  async shutdownWith(shutdown: () => Promise<void>): Promise<void> {
    this.shutdown();
    await shutdown();
  }
}
