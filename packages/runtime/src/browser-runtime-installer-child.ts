import { createRequire } from "node:module";

interface BrowserExecutable {
  installType: string;
}

interface BrowserRegistryModule {
  registry: {
    findExecutable(name: string): BrowserExecutable | undefined;
    install(
      executables: BrowserExecutable[],
      options: { gc: boolean },
    ): Promise<void>;
  };
}

const require = createRequire(import.meta.url);
const registryModule = (
  require("playwright-core/lib/coreBundle") as {
    registry: BrowserRegistryModule;
  }
).registry;
const executable = registryModule.registry.findExecutable("chromium");
if (!executable || executable.installType === "none") {
  throw new Error("Pinned Chromium runtime is unavailable");
}
await registryModule.registry.install([executable], { gc: false });
