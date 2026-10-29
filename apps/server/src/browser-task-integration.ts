import type { Hono } from "hono";
import type { CredentialReferenceStore } from "@napier/runtime/governance";

import { registerBrowserTaskHttp } from "./browser-task-http.js";
import { BrowserTaskService } from "./browser-task-service.js";

export class BrowserTasks extends BrowserTaskService {
  constructor(
    dataRoot: string,
    credentials?: CredentialReferenceStore,
    env: Readonly<Record<string, string | undefined>> = process.env,
    resourceAdmission?: ConstructorParameters<
      typeof BrowserTaskService
    >[0]["resourceAdmission"],
  ) {
    super({
      dataRoot,
      env,
      ...(resourceAdmission ? { resourceAdmission } : {}),
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
    const failures: unknown[] = [];
    for (const drain of [() => this.shutdown(), shutdown]) {
      try {
        await drain();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Browser and local shutdown failed");
  }
}
