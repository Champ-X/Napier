import type { MemoryFact } from "@napier/contracts";

/** One invocation's observations, never a cross-call authorization cache. Every
 * successful digest is checked again after indexing before any dependent fact is
 * selected. A changed or unavailable source invalidates the whole dependency. */
export class TaskMemoryDependencySnapshot {
  private readonly digests = new Map<string, string | undefined>();
  private readonly changed = new Set<string>();
  private readCount = 0;
  private reuseCount = 0;

  constructor(private readonly readDigest: (filename: string) => Promise<string>) {}

  async accepts(fact: MemoryFact): Promise<boolean> {
    for (const expected of fact.source.fileDependencies ?? []) {
      if (!this.digests.has(expected.path))
        this.digests.set(expected.path, await this.read(expected.path));
      else {
        this.reuseCount++;
      }
      const observed = this.digests.get(expected.path);
      if (observed === undefined || observed !== expected.sha256) return false;
    }
    return true;
  }

  async revalidate(): Promise<void> {
    for (const [filename, digest] of this.digests) {
      // A failed initial observation cannot authorize a fact even if the file
      // appears later. Only successful observations can require invalidation.
      if (digest === undefined) continue;
      if (await this.read(filename) !== digest) {
        this.changed.add(filename);
        this.digests.set(filename, undefined);
      }
    }
  }

  retains(fact: MemoryFact): boolean {
    return (fact.source.fileDependencies ?? []).every(
      (expected) => this.digests.get(expected.path) !== undefined &&
        this.digests.get(expected.path) === expected.sha256,
    );
  }

  receipt() {
    return {
      uniquePaths: this.digests.size,
      readCount: this.readCount,
      reusedChecks: this.reuseCount,
      changedPaths: this.changed.size,
    };
  }

  private async read(filename: string): Promise<string | undefined> {
    this.readCount++;
    try {
      return await this.readDigest(filename);
    } catch {
      return undefined;
    }
  }
}
