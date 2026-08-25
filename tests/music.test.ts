import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { generateAmbientMusic } from "../src/audio/music.js";

describe("ambient music generator", () => {
  it("creates a valid stereo PCM wave file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-demo-music-"));
    try {
      const output = path.join(directory, "ambient.wav");
      await generateAmbientMusic(output, 1);
      const file = await readFile(output);
      expect(file.subarray(0, 4).toString()).toBe("RIFF");
      expect(file.subarray(8, 12).toString()).toBe("WAVE");
      expect(file.readUInt16LE(22)).toBe(2);
      expect(file.readUInt32LE(24)).toBe(44_100);
      expect(file.length).toBeGreaterThan(170_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
