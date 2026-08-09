import { describe, expect, it } from "vitest";

import { BUNDLED_SKILLS } from "../src/bundled-skills.js";

describe("bundled Skill catalog", () => {
  it("advertises the five launch Skills", () => {
    expect(BUNDLED_SKILLS).toEqual([
      expect.objectContaining({ name: "data-analysis", enabled: true }),
      expect.objectContaining({ name: "research-brief", enabled: true }),
      expect.objectContaining({ name: "software-delivery", enabled: true }),
      expect.objectContaining({ name: "artifact-studio", enabled: true }),
      expect.objectContaining({ name: "browser-automation", enabled: true }),
    ]);
  });
});
