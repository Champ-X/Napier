import type { BrowserSessionOwner } from "./browser-session-model.js";
import type { Route } from "playwright-core";
import type { PublicHostLookup } from "./public-network.js";
import { resolvePublicHost, validatePublicHttpUrl } from "./public-network.js";
import {
  localServiceUrl,
  type RunLocalServiceLeaseRegistry,
} from "./run-local-service-leases.js";
import type { BrowserWorkspacePreview } from "./browser-workspace-preview.js";

export class BrowserAllowedUrls {
  private workspacePreview: BrowserWorkspacePreview | undefined;

  constructor(
    private readonly owner: BrowserSessionOwner,
    private readonly leases: RunLocalServiceLeaseRegistry | undefined,
    private readonly lookup: PublicHostLookup | undefined,
    workspacePreview?: BrowserWorkspacePreview,
  ) {
    this.workspacePreview = workspacePreview;
  }

  enableWorkspacePreview(preview: BrowserWorkspacePreview): void {
    this.workspacePreview = preview;
  }

  async fulfillWorkspacePreview(route: Route): Promise<boolean> {
    return (await this.workspacePreview?.fulfill(route)) ?? false;
  }

  async resolve(value: string): Promise<URL> {
    const preview = this.workspacePreview?.url(value);
    if (preview) return preview;
    if (this.workspacePreview) {
      throw new Error("Workspace preview Browser Sessions are offline");
    }
    const local = localServiceUrl(this.leases, this.owner, value);
    if (local) return local.url;
    const url = validatePublicHttpUrl(value);
    await resolvePublicHost(url.hostname, {
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });
    return url;
  }
}
