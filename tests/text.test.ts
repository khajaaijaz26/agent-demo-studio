import { describe, expect, it } from "vitest";
import { slugify, splitNarration, wrapText } from "../src/utils/text.js";

describe("text helpers", () => {
  it("creates safe project slugs", () => {
    expect(slugify("  Orbit Analytics — Launch!  ")).toBe("orbit-analytics-launch");
  });

  it("wraps copy without losing words", () => {
    const lines = wrapText("Create a beautiful product demo from one agent prompt", 18);
    expect(lines.join(" ")).toBe("Create a beautiful product demo from one agent prompt");
    expect(lines.every((line) => line.length <= 18)).toBe(true);
  });

  it("splits narration into caption sentences", () => {
    expect(splitNarration("First scene. Second scene! Final scene?")).toEqual([
      "First scene.",
      "Second scene!",
      "Final scene?",
    ]);
  });
});
