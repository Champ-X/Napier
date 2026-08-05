import { describe, expect, it } from "vitest";

import { hasConservativeBrowserShell } from "../src/web-fetch-browser-shell.js";

describe("conservative Web Fetch Browser shell detection", () => {
  it("admits empty app mounts with executable app scripts", () => {
    expect(
      hasConservativeBrowserShell(`
        <!doctype html>
        <html><head><script defer src="app.bundle.js"></script></head>
        <body><section class="todoapp" id="root"></section></body></html>
      `),
    ).toBe(true);
    expect(
      hasConservativeBrowserShell(`
        <html><body><div id="app"><!-- loading --></div>
        <script type="module" src="/assets/index.js"></script></body></html>
      `),
    ).toBe(true);
    expect(
      hasConservativeBrowserShell(
        '<!doctype html><html lang="en" data-framework="react"><head><title>TodoMVC: React</title><script defer="defer" src="app.bundle.js"></script></head><body><section class="todoapp" id="root"></section><footer class="info"><p>Double-click to edit a todo</p></footer><script src="./base.js"></script></body></html>',
      ),
    ).toBe(true);
  });

  it("preserves document-write shells and rejects unsafe or static pages", () => {
    expect(
      hasConservativeBrowserShell(`
        <html><body><script>document.write("<main>rendered</main>")</script></body></html>
      `),
    ).toBe(true);
    expect(
      hasConservativeBrowserShell(`
        <html><body><div id="root"></div><script defer src="analytics.js"></script></body></html>
      `),
    ).toBe(false);
    expect(
      hasConservativeBrowserShell(`
        <html><body><div id="__next"><main>Server rendered</main></div>
        <script defer src="/_next/app.js"></script></body></html>
      `),
    ).toBe(false);
    expect(
      hasConservativeBrowserShell(`
        <html><body><div id="root"></div><input type="password">
        <script defer src="app.js"></script></body></html>
      `),
    ).toBe(false);
    expect(
      hasConservativeBrowserShell(`
        <html><body><div id="root"></div>
        <script type="application/json" src="app.json"></script></body></html>
      `),
    ).toBe(false);
  });
});
