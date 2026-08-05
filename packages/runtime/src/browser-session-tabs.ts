import type { BrowserContext, Page, Request } from "playwright-core";

import {
  MAX_BROWSER_SESSION_TABS,
  type BrowserSessionTabDescriptor,
} from "./browser-session-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";

interface ManagedBrowserTab {
  id: string;
  page: Page;
}

export interface BrowserSessionTabEvidence {
  activeTabId: string;
  tabCount: number;
  tabSetSha256: string;
}

export class BrowserSessionTabs {
  private readonly tabs = new Map<string, ManagedBrowserTab>();
  private readonly pages = new Map<Page, string>();
  private readonly pendingPages = new Set<Page>();
  private activeId: string;
  private nextId = 2;
  private explicitCreationPending = false;

  constructor(
    private readonly context: BrowserContext,
    initialPage: Page,
  ) {
    this.activeId = "tab_1";
    this.register(this.activeId, initialPage);
  }

  get activePage(): Page {
    return this.active().page;
  }

  get healthy(): boolean {
    return this.tabs.size > 0 && this.tabs.has(this.activeId);
  }

  owns(page: Page): boolean {
    return this.pages.has(page);
  }

  isActive(page: Page): boolean {
    return this.activePage === page;
  }

  pageForRequest(request: Request): Page | undefined {
    try {
      const page = request.frame().page();
      return this.owns(page) ? page : undefined;
    } catch {
      return undefined;
    }
  }

  rejectUnmanaged(page: Page): void {
    if (this.owns(page)) return;
    if (this.explicitCreationPending) {
      this.pendingPages.add(page);
      return;
    }
    void page.close().catch(() => undefined);
  }

  async create(): Promise<{ page: Page; evidence: BrowserSessionTabEvidence }> {
    if (this.tabs.size >= MAX_BROWSER_SESSION_TABS) {
      throw new Error("Browser Session tab limit reached");
    }
    this.explicitCreationPending = true;
    try {
      const page = await this.context.newPage();
      const id = `tab_${String(this.nextId)}`;
      this.nextId += 1;
      this.register(id, page);
      this.pendingPages.delete(page);
      this.closePending();
      this.activeId = id;
      return { page, evidence: this.evidence() };
    } catch (error) {
      this.closePending();
      throw error;
    } finally {
      this.explicitCreationPending = false;
    }
  }

  switch(tabId: string): BrowserSessionTabEvidence {
    const tab = this.tab(tabId);
    this.activeId = tab.id;
    return this.evidence();
  }

  async close(tabId: string): Promise<BrowserSessionTabEvidence> {
    if (this.tabs.size === 1) {
      throw new Error("Browser Session cannot close its final tab");
    }
    const tab = this.tab(tabId);
    const ids = [...this.tabs.keys()];
    const index = ids.indexOf(tab.id);
    this.tabs.delete(tab.id);
    this.pages.delete(tab.page);
    await tab.page.close();
    if (this.activeId === tab.id) {
      this.activeId = ids[index + 1] ?? ids[index - 1]!;
    }
    return this.evidence();
  }

  async descriptors(): Promise<BrowserSessionTabDescriptor[]> {
    return await Promise.all(
      [...this.tabs.values()].map(async (tab) => ({
        tabId: tab.id,
        active: tab.id === this.activeId,
        url: tab.page.url().slice(0, 4_096),
        title: (await tab.page.title()).slice(0, 512),
      })),
    );
  }

  evidence(): BrowserSessionTabEvidence {
    const tabIds = [...this.tabs.keys()];
    return {
      activeTabId: this.activeId,
      tabCount: tabIds.length,
      tabSetSha256: sha256(canonicalJson(tabIds)),
    };
  }

  private active(): ManagedBrowserTab {
    return this.tab(this.activeId);
  }

  private tab(tabId: string): ManagedBrowserTab {
    if (!/^tab_[1-9][0-9]{0,3}$/u.test(tabId)) {
      throw new Error("Browser Session tab ID is invalid");
    }
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error("Browser Session tab is not active");
    return tab;
  }

  private register(id: string, page: Page): void {
    this.tabs.set(id, { id, page });
    this.pages.set(page, id);
    page.on("close", () => {
      if (this.pages.get(page) !== id) return;
      this.pages.delete(page);
      this.tabs.delete(id);
      if (this.activeId === id) {
        this.activeId = this.tabs.keys().next().value as string;
      }
    });
  }

  private closePending(): void {
    for (const page of this.pendingPages) {
      void page.close().catch(() => undefined);
    }
    this.pendingPages.clear();
  }
}
