import { expect, it } from "vitest";
import {
  regionsDoNotOverlap,
  regionSeparation,
} from "./web-ui-region-geometry.mjs";

const title = { left: 268, right: 898, top: 0, bottom: 48 };
const actions = { left: 914, right: 1264, top: 0, bottom: 48 };
const views = { left: 252, right: 1280, top: 48, bottom: 88 };

it("accepts separate grid rows and adjacent controls regardless of order", () => {
  expect(regionsDoNotOverlap([title, views, actions])).toBe(true);
  expect(regionsDoNotOverlap([actions, title, views])).toBe(true);
  expect(regionSeparation(title, actions)).toBe(16);
  expect(regionSeparation(views, title)).toBe(0);
  expect(regionSeparation(title, views)).toBe(0);
});

it("rejects actual horizontal, vertical, and enclosing collisions", () => {
  expect(regionsDoNotOverlap([title, { ...actions, left: 890 }])).toBe(false);
  expect(regionsDoNotOverlap([title, { ...views, top: 40 }])).toBe(false);
  expect(regionsDoNotOverlap([title, { ...views, top: 0 }])).toBe(false);
});

it("retains the one-pixel rounding tolerance without hiding larger overlaps", () => {
  expect(regionsDoNotOverlap([title, { ...views, top: 47 }])).toBe(true);
  expect(regionsDoNotOverlap([title, { ...views, top: 46.9 }])).toBe(false);
});
