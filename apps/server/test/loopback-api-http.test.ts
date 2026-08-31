import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { registerLoopbackApiGuard } from "../src/http-request-validation.js";

function guardedApp(): Hono {
  const app = new Hono();
  registerLoopbackApiGuard(app);
  app.get("/api/probe", (context) => context.json({ ok: true }));
  app.get("/public", (context) => context.text("public"));
  return app;
}

describe("loopback API guard", () => {
  it.each([
    "http://localhost:3000/api/probe",
    "http://127.0.0.1:3000/api/probe",
    "http://[::1]:3000/api/probe",
  ])("allows a loopback API URL: %s", async (url) => {
    const response = await guardedApp().request(url);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects a non-loopback API Host before the route runs", async () => {
    const response = await guardedApp().request(
      "http://attacker.example/api/probe",
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "API host must be loopback",
    });
  });

  it("does not change non-API routes", async () => {
    const response = await guardedApp().request(
      "http://attacker.example/public",
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("public");
  });
});
