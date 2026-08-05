import type { Page, Request } from "playwright-core";

export interface BrowserNavigationGrant {
  allowCrossOrigin: boolean;
  baselineOrigin?: string;
  initialOrigin?: string;
}

export class BrowserSessionNavigation {
  private readonly committedOrigins = new Map<Page, string>();
  private grant:
    | { page: Page; value: BrowserNavigationGrant; blocked?: string }
    | undefined;

  async preflight(
    page: Page,
    url: URL,
    allowCrossOrigin: boolean,
  ): Promise<void> {
    const current = browserPageOrigin(page.url());
    if (current && current !== url.origin && !allowCrossOrigin) {
      throw new Error("Cross-origin navigation requires allowCrossOrigin");
    }
  }

  async run<T>(
    page: Page,
    allowCrossOrigin: boolean,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.grant) {
      throw new Error("Browser navigation grant is already active");
    }
    const baselineOrigin =
      this.committedOrigins.get(page) ?? browserPageOrigin(page.url());
    this.grant = {
      page,
      value: {
        allowCrossOrigin,
        ...(baselineOrigin ? { baselineOrigin } : {}),
      },
    };
    try {
      let result: T;
      try {
        result = await operation();
      } catch (error) {
        if (this.grant.blocked) throw new Error(this.grant.blocked);
        throw error;
      }
      if (this.grant.blocked) throw new Error(this.grant.blocked);
      const committed = browserPageOrigin(page.url());
      if (committed) this.committedOrigins.set(page, committed);
      return result;
    } finally {
      this.grant = undefined;
    }
  }

  authorize(request: Request, page: Page, origin: string): boolean {
    if (!request.isNavigationRequest()) return true;
    try {
      if (request.frame() !== page.mainFrame()) return true;
    } catch {
      return false;
    }
    const grant = this.grant?.page === page ? this.grant : undefined;
    const baseline =
      grant?.value.baselineOrigin ?? this.committedOrigins.get(page);
    if (!grant?.value.initialOrigin) {
      if (grant) grant.value.initialOrigin = origin;
    }
    const navigationBaseline =
      baseline ?? grant?.value.initialOrigin ?? this.committedOrigins.get(page);
    if (
      navigationBaseline &&
      origin !== navigationBaseline &&
      grant?.value.allowCrossOrigin !== true
    ) {
      if (grant) {
        grant.blocked = "Cross-origin navigation requires allowCrossOrigin";
      }
      return false;
    }
    return true;
  }
}

export function browserPageOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}
