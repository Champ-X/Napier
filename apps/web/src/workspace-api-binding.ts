const WORKSPACE_ID = /^workspace_[a-f0-9]{64}$/u;
const HEADER = "X-Napier-Workspace-Id";
const PREFIX = "/api/workspaces/";

/** One immutable binding per document. Switching workspaces creates a new
 * document, so an awaited follow-up cannot accidentally target another ledger. */
export class WorkspaceApiBinding {
  private workspaceId: string | undefined;
  private readonly origin: string;

  constructor(href = "http://localhost/", private readonly onBound?: (id: string) => void) {
    const url = new URL(href);
    this.origin = url.origin;
    this.workspaceId = url.searchParams.get("workspace") ?? undefined;
  }

  address(endpoint: string): string {
    const url = new URL(endpoint, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith("/api/")) {
      throw new Error("Workspace API address must belong to this application");
    }
    if (this.workspaceId && !WORKSPACE_ID.test(this.workspaceId)) {
      throw new Error("Workspace address is invalid. Open the workspace again.");
    }
    if (url.pathname.startsWith(PREFIX)) {
      const id = url.pathname.slice(PREFIX.length).split("/")[0];
      if (!id || !WORKSPACE_ID.test(id) || (this.workspaceId && id !== this.workspaceId)) {
        throw new Error("Workspace API address belongs to another workspace");
      }
      return `${url.pathname}${url.search}`;
    }
    return this.workspaceId
      ? `${PREFIX}${this.workspaceId}/${url.pathname.slice(5)}${url.search}`
      : `${url.pathname}${url.search}`;
  }

  async fetch(endpoint: string, init?: RequestInit): Promise<Response> {
    const address = this.address(endpoint);
    const requested = address.startsWith(PREFIX) ? address.slice(PREFIX.length).split("/")[0] : undefined;
    const response = await (init === undefined ? fetch(address) : fetch(address, init));
    const observed = response.headers.get(HEADER);
    // Standalone single-workspace servers remain usable until a binding is
    // supplied. Once bound, a successful unbound response is never accepted.
    if (observed) {
      if (!WORKSPACE_ID.test(observed) || (requested && requested !== observed) || (this.workspaceId && this.workspaceId !== observed)) {
        await response.body?.cancel();
        throw new Error("Response belongs to another workspace. Refresh this workspace.");
      }
      if (!this.workspaceId) { this.workspaceId = observed; this.onBound?.(observed); }
    } else if ((this.workspaceId || requested) && response.ok) {
      await response.body?.cancel();
      throw new Error("Response workspace could not be verified. Refresh this workspace.");
    }
    return response;
  }
}

function rememberDocumentWorkspace(id: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.has("workspace")) return;
  url.searchParams.set("workspace", id);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

const documentBinding = new WorkspaceApiBinding(
  typeof window === "undefined" ? undefined : window.location?.href,
  rememberDocumentWorkspace,
);

export const workspaceFetch = documentBinding.fetch.bind(documentBinding);
export const workspaceApiUrl = documentBinding.address.bind(documentBinding);

export const explicitWorkspaceAddress = typeof window !== "undefined" &&
  Boolean(window.location?.href && new URL(window.location.href).searchParams.has("workspace"));

export function workspaceNavigationUrl(workspaceId: string, href: string, threadId?: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error("Workspace identity is missing or invalid");
  const url = new URL(href);
  url.searchParams.set("workspace", workspaceId);
  url.searchParams.delete("thread");
  if (threadId) url.searchParams.set("thread", threadId);
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

export function navigateWorkspace(workspaceId: string, threadId?: string): void {
  window.location.assign(workspaceNavigationUrl(workspaceId, window.location.href, threadId));
}
