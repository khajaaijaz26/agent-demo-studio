import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { generateLocalClonedSpeech } from "../src/audio/voice-clone.js";

describe("consented local voice cloning", () => {
  it("requires explicit named-speaker authorization", async () => {
    await expect(generateLocalClonedSpeech("Hello", "unused.wav", {
      referencePath: "missing.wav",
      consent: { speakerName: "", confirmed: false },
      endpoint: "http://127.0.0.1:8020/v1/voice/clone",
    })).rejects.toThrow(/authorization/i);
  });

  it("accepts audio only from a loopback adapter and writes it locally", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-demo-voice-clone-"));
    try {
      const referencePath = path.join(directory, "reference.wav");
      const outputPath = path.join(directory, "voiceover.wav");
      await writeFile(referencePath, Buffer.from("reference"));
      const fetchImpl = vi.fn(async (_request, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ speakerName: "Teacher Amina", referenceAudioPath: referencePath, outputPath });
        return new Response(Buffer.from("generated-audio"), { status: 200, headers: { "Content-Type": "audio/wav" } });
      }) as typeof fetch;
      await expect(generateLocalClonedSpeech("Welcome to class.", outputPath, {
        referencePath,
        consent: { speakerName: "Teacher Amina", confirmed: true, scope: "one lesson video" },
        endpoint: "http://127.0.0.1:8020/v1/voice/clone",
        fetchImpl,
      })).resolves.toBe(outputPath);
      await expect(readFile(outputPath, "utf8")).resolves.toBe("generated-audio");
      await expect(generateLocalClonedSpeech("Hello", outputPath, {
        referencePath,
        consent: { speakerName: "Teacher Amina", confirmed: true },
        endpoint: "https://voice.example.com/v1/voice/clone",
        fetchImpl,
      })).rejects.toThrow(/loopback/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
