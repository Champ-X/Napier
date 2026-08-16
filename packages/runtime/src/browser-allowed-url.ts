import type { BrowserSessionOwner } from "./browser-session-model.js";
import type { PublicHostLookup } from "./public-network.js";
import { resolvePublicHost, validatePublicHttpUrl } from "./public-network.js";
import {
  localServiceUrl,
  type RunLocalServiceLeaseRegistry,
} from "./run-local-service-leases.js";

export class BrowserAllowedUrls {
  constructor(
    private readonly owner: BrowserSessionOwner,
    private readonly leases: RunLocalServiceLeaseRegistry | undefined,
    private readonly lookup: PublicHostLookup | undefined,
  ) {}

  async resolve(value: string): Promise<URL> {
    const local = localServiceUrl(this.leases, this.owner, value);
    if (local) return local.url;
    const url = validatePublicHttpUrl(value);
    await resolvePublicHost(url.hostname, {
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });
    return url;
  }
}
