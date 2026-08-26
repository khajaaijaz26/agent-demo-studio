import { describe, expect, it } from "vitest";
import { normalizeSpeechRate } from "../src/audio/neural-tts.js";
import { formatSrtTimestamp } from "../src/render/synchronized.js";

describe("synchronized narration helpers", () => {
  it("normalizes neural speech rates", () => {
    expect(normalizeSpeechRate(-4)).toBe("-4%");
    expect(normalizeSpeechRate("+8%")).toBe("+8%");
    expect(normalizeSpeechRate(undefined)).toBe("+0%");
  });

  it("formats timeline offsets as SRT timestamps", () => {
    expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
    expect(formatSrtTimestamp(65.432)).toBe("00:01:05,432");
    expect(formatSrtTimestamp(3_661.2)).toBe("01:01:01,200");
  });
});
