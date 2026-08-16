export const browserKernelInspectorSlot = {
  pluginId: "plugin.browser",
  version: "1.0.0",
  contentSha256:
    "9242e78a76b9a7cef23c397360c3014c2895e0a8cc1cfb126c14ee08b3ed23a8",
  clientEntry: "@napier/web/kernel-browser-inspector-slot",
  slot: "inspector.panel",
  tab: "browser",
  load: () => import("./BrowserInspectorPanel"),
} as const;
