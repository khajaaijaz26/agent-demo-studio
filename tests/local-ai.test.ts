import { describe, expect, it, vi } from "vitest";
import { assertLocalModelName, enhancePromptVideoPlan, localOllamaBaseUrl, selectLocalPlannerModel } from "../src/creator/local-ai.js";
import { createPromptVideoPlan } from "../src/creator/prompt.js";

describe("local Qwen planning", () => {
  it("enforces loopback-only endpoints and rejects cloud-tagged models", () => {
    expect(localOllamaBaseUrl("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
    expect(localOllamaBaseUrl("http://localhost:11434")).toBe("http://localhost:11434");
    expect(() => localOllamaBaseUrl("https://models.example.com")).toThrow(/local-only/i);
    expect(() => assertLocalModelName("qwen3.5:397b-cloud")).toThrow(/cloud/i);
  });

  it("selects the smallest Qwen for speed and the installed 4B model for quality", () => {
    const models = ["embeddinggemma:latest", "qwen3.5:4b", "qwen3.5:0.8b"];
    expect(selectLocalPlannerModel(models, "fast")).toBe("qwen3.5:0.8b");
    expect(selectLocalPlannerModel(models, "quality")).toBe("qwen3.5:4b");
  });

  it("uses exactly one bounded generation call and preserves deterministic production rules", async () => {
    const fetchImpl = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen3.5:0.8b", size: 1_000_000_000 }] }), { status: 200 });
      if (url.endsWith("/api/version")) return new Response(JSON.stringify({ version: "0.32.15" }), { status: 200 });
      if (url.endsWith("/api/chat")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ model: "qwen3.5:0.8b", stream: false, think: false, keep_alive: "30m" });
        expect(body).toHaveProperty("format");
        return new Response(JSON.stringify({
          model: "qwen3.5:0.8b",
          prompt_eval_count: 120,
          eval_count: 180,
          message: {
            content: JSON.stringify({
              title: "The Fast Water Cycle",
              audience: "Primary science learners",
              objective: "Explain the water cycle in three memorable visual beats.",
              scenes: [
                { title: "Sunlight", visual: "Sun warms a blue lake.", narration: "Sunlight turns surface water into rising vapor.", onScreenText: "Water rises" },
                { title: "Clouds", visual: "Vapor gathers into soft clouds.", narration: "Cooling vapor condenses into clouds.", onScreenText: "Clouds form" },
                { title: "Rain", visual: "Rain returns to rivers and lakes.", narration: "Rain carries water back to the ground.", onScreenText: "Water returns" },
              ],
            }),
          },
        }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;
    const input = { prompt: "Teach the water cycle to a primary science class.", mode: "cartoon" as const, plannerProvider: "auto" as const, plannerProfile: "fast" as const };
    const baseline = createPromptVideoPlan(input);
    const plan = await enhancePromptVideoPlan(input, baseline, { fetchImpl });

    expect(plan.title).toBe("The Fast Water Cycle");
    expect(plan.scenes.map((scene) => scene.onScreenText)).toEqual(["Water rises", "Clouds form", "Water returns"]);
    expect(plan.intelligence).toMatchObject({ provider: "ollama", local: true, profile: "fast", model: "qwen3.5:0.8b", promptTokens: 120, outputTokens: 180 });
    expect(plan.productionRules).toEqual(baseline.productionRules);
    const repeated = await enhancePromptVideoPlan(input, baseline, { fetchImpl });
    expect(repeated.intelligence).toMatchObject({ provider: "ollama", cacheHit: true });
    expect(fetchImpl.mock.calls.filter(([request]) => String(request).endsWith("/api/chat"))).toHaveLength(1);
  });

  it("rejects locally planned scenes that are internally coherent but assigned to the wrong storyboard beat", async () => {
    const fetchImpl = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen3.5:0.8b" }] }), { status: 200 });
      if (url.endsWith("/api/version")) return new Response(JSON.stringify({ version: "0.32.15" }), { status: 200 });
      if (url.endsWith("/api/chat")) {
        return new Response(JSON.stringify({
          model: "qwen3.5:0.8b",
          message: {
            content: JSON.stringify({
              title: "Magic Sky Adventure",
              audience: "Families who enjoy animated stories",
              scenes: [
                { visual: "A gold box floats above clouds and glowing lights.", narration: "The magic box glows in the sky.", onScreenText: "Magic Box" },
                { visual: "A family opens a treasure chest under a giant tree.", narration: "The family celebrates its treasure discovery.", onScreenText: "Treasure Found" },
                { visual: "Characters run through a meadow of mushrooms and butterflies.", narration: "Friends chase butterflies while they run.", onScreenText: "Adventure Begins" },
              ],
            }),
          },
        }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;
    const input = {
      prompt: "Create a cartoon video. A colorful box floats in the sky with glowing lights. Characters run through a meadow with floating mushrooms and butterflies. A family finds a hidden treasure chest under a giant tree.",
      mode: "cartoon" as const,
      visualQuality: "motion-graphics" as const,
      plannerProvider: "auto" as const,
    };
    const baseline = createPromptVideoPlan(input);
    const plan = await enhancePromptVideoPlan(input, baseline, { fetchImpl });

    expect(plan.scenes[0]?.visual).toBe("A gold box floats above clouds and glowing lights.");
    expect(plan.scenes[1]).toEqual(baseline.scenes[1]);
    expect(plan.scenes[2]).toEqual(baseline.scenes[2]);
    expect(plan.intelligence?.fallbackReason).toMatch(/2 Qwen scenes failed visual\/narration alignment or uniqueness QA/i);
  });

  it("falls back instantly without losing the plan when Ollama is unavailable", async () => {
    const input = { prompt: "Create a calm local story video.", mode: "story" as const, plannerProvider: "auto" as const };
    const baseline = createPromptVideoPlan(input);
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); }) as typeof fetch;
    const plan = await enhancePromptVideoPlan(input, baseline, { fetchImpl });
    expect(plan.scenes).toEqual(baseline.scenes);
    expect(plan.intelligence).toMatchObject({ provider: "deterministic", local: true, profile: "fast" });
    expect(plan.intelligence?.fallbackReason).toMatch(/unavailable/i);
  });

  it("fails clearly when local Qwen is explicitly required", async () => {
    const input = { prompt: "Require a local planner.", mode: "story" as const, plannerProvider: "ollama" as const };
    const baseline = createPromptVideoPlan(input);
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); }) as typeof fetch;
    await expect(enhancePromptVideoPlan(input, baseline, { fetchImpl })).rejects.toThrow(/unavailable|offline/i);
  });
});
