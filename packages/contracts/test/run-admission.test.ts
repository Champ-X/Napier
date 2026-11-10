import { describe, expect, it } from "vitest";
import { controlModeToBusyPolicy } from "../src/run-admission.js";

describe("run admission busy policy", () => {
  it("maps existing control modes to Durable steer/follow_up names", () => {
    expect(controlModeToBusyPolicy("steering")).toBe("steer");
    expect(controlModeToBusyPolicy("follow_up")).toBe("follow_up");
  });
});
