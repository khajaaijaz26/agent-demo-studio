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
