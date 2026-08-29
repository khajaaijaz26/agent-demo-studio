import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { generateLocalSceneMedia } from "../src/creator/local-media.js";
import { createPromptVideoPlan } from "../src/creator/prompt.js";

describe("loopback local media generation", () => {
  it("sends one scene batch for fast text/image/video generation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-demo-local-media-"));
    try {
      const generatedDirectory = path.join(directory, "generated");
      await mkdir(generatedDirectory, { recursive: true });
      const outputs = [path.join(generatedDirectory, "scene-1.png"), path.join(generatedDirectory, "scene-2.png"), path.join(generatedDirectory, "scene-3.png")];
      await Promise.all(outputs.map((file, index) => writeFile(file, `scene-${index + 1}`)));
      const input = {
        prompt: "Teach fractions using colorful paper shapes.",
        mode: "cartoon" as const,
        mediaProvider: "local-adapter" as const,
        mediaTask: "text-to-image" as const,
        mediaAdapterUrl: "http://127.0.0.1:8188/v1/media/generate",
        plannerProfile: "fast" as const,
        language: "ar-AE",
        negativePrompt: "jitter, duplicate characters",
        seed: 73,
        characters: [{ name: "Any User Character", source: path.join(directory, "open-character.png"), style: "user-defined style", rights: "Authorized test asset" }],
      };
      const plan = createPromptVideoPlan(input);
      const fetchImpl = vi.fn(async (_request, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.protocol).toBe("agent-demo-local-media-v2");
        expect(body.scenes).toHaveLength(3);
        expect(body.performance).toBe("fast");
        expect(body.characterReferences).toEqual([expect.objectContaining({ name: "Any User Character", style: "user-defined style" })]);
        expect(body.generation).toMatchObject({
          language: "ar-AE",
          negativePrompt: "jitter, duplicate characters",
          seed: 73,
          visualQuality: "generative",
          outputPresets: ["youtube-1080p", "shorts", "reels", "tiktok"],
        });
        expect(body.scenes[0]).toEqual(expect.objectContaining({ camera: expect.any(String), transition: expect.any(String) }));
        return new Response(JSON.stringify({ outputs: outputs.map((output) => ({ path: output, kind: "image", model: "local-test-model" })) }), { status: 200 });
      }) as typeof fetch;
      const result = await generateLocalSceneMedia(input, plan, generatedDirectory, { fetchImpl });
      expect(result).toMatchObject({ provider: "local-adapter", local: true, task: "text-to-image" });
      expect(result.outputs.map((output) => output.path)).toEqual(outputs);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects remote generation endpoints", async () => {
    const input = { prompt: "A lesson", mode: "story" as const, mediaProvider: "local-adapter" as const, mediaAdapterUrl: "https://video.example.com/generate" };
    await expect(generateLocalSceneMedia(input, createPromptVideoPlan(input), ".")).rejects.toThrow(/loopback/i);
  });
});
