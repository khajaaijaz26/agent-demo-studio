import { describe, expect, it } from "vitest";
import { analyzeAnimatedScene, animatedSceneHtml, animatedSceneLayout } from "../src/creator/animated-media.js";
import { inferPromptMode, resolvePromptMediaProvider, resolveRequestedVisualQuality } from "../src/creator/prompt.js";
import type { CreatorProductionPlanScene } from "../src/creator/types.js";

function scene(visual: string, narration: string, onScreenText: string, index = 0): CreatorProductionPlanScene {
  return {
    id: `scene-${index + 1}`,
    title: ["Hook", "Develop", "Resolve"][index] ?? "Scene",
    purpose: "Exercise prompt-conditioned animation.",
    durationSeconds: 8,
    visual,
    narration,
    onScreenText,
    transition: "fade",
  };
}

describe("prompt-conditioned motion graphics", () => {
  it("auto-detects a treatment without restricting arbitrary subject matter", () => {
    expect(inferPromptMode("A quiet ASMR glass-cutting sequence", "auto")).toBe("asmr");
    expect(inferPromptMode("Launch our new teacher platform", "auto")).toBe("product-launch");
    expect(inferPromptMode("A bioluminescent jellyfish explores an alien cathedral", "auto")).toBe("story");
    expect(inferPromptMode("Anything at all", "vfx")).toBe("vfx");
  });

  it("does not silently route generative cartoon requests to motion graphics", () => {
    const input = { prompt: "I want a fully generated cartoon video with characters running and talking.", mode: "cartoon" as const };
    expect(resolveRequestedVisualQuality(input)).toBe("generative");
    expect(resolvePromptMediaProvider(input, {})).toBe("ltx-desktop");

    expect(resolvePromptMediaProvider({ ...input, visualQuality: "motion-graphics" }, {})).toBe("animated");
    expect(resolvePromptMediaProvider({ ...input, mediaProvider: "animated" }, {})).toBe("animated");
  });

  it("turns the previously failed storyboards into different drawable scene graphs", () => {
    const planned = [
      scene("A colorful box floats in the sky with glowing lights.", "A magical gift waits for everyone.", "Magic Box!", 0),
      scene("Characters run through a forest filled with floating mushrooms and butterflies.", "They chase a mysterious creature.", "Adventure Begins!", 1),
      scene("A family finds a hidden treasure chest under a giant tree.", "They celebrate their discovery.", "Treasure Found!", 2),
    ].map((item, index) => analyzeAnimatedScene("cartoon", item, index, "Create a cartoon animated video"));

    expect(planned[0]).toMatchObject({ setting: "sky", actions: expect.arrayContaining(["float"]), props: expect.arrayContaining(["box", "lights"]) });
    expect(planned[1]).toMatchObject({ setting: "forest", actions: expect.arrayContaining(["run", "chase"]), props: expect.arrayContaining(["mushroom"]) });
    expect(planned[1]!.subjects).toHaveLength(3);
    expect(planned[2]).toMatchObject({ setting: "forest", actions: expect.arrayContaining(["celebrate"]), props: expect.arrayContaining(["treasure", "tree"]) });
    expect(new Set(planned.map((item) => item.semanticSignature)).size).toBe(3);
  });

  it("recognizes the requested animals and science demonstration instead of drawing a generic board", () => {
    const forest = analyzeAnimatedScene("cartoon", scene(
      "A rabbit and blue cat run while a dragon and bluebird fly over the forest with lanterns.",
      "They carried a planted seed through the forest.",
      "Run Fast!",
    ), 1, "A magical forest adventure");
    expect(forest.subjects.map((item) => item.kind)).toEqual(expect.arrayContaining(["rabbit", "cat", "dragon", "bird"]));
    expect(forest.actions).toEqual(expect.arrayContaining(["run", "fly", "hold"]));
    expect(forest.props).toEqual(expect.arrayContaining(["lantern", "plant"]));

    const science = analyzeAnimatedScene("cartoon", scene(
      "Students watch a scientist test water in a glowing beaker, then build a plant model with blocks.",
      "Scientists test ideas and students build models to learn how plants grow.",
      "Test and Build",
    ), 1, "Year 3 science video");
    expect(science.subjects.map((item) => item.kind)).toEqual(expect.arrayContaining(["scientist", "student"]));
    expect(science.actions).toEqual(expect.arrayContaining(["experiment", "build", "grow"]));
    expect(science.props).toEqual(expect.arrayContaining(["beaker", "water", "plant", "blocks", "lights"]));
  });

  it("infers visible actors when pronouns describe an action", () => {
    const celebration = analyzeAnimatedScene("story", scene(
      "A treasure chest opens below a giant tree.",
      "They celebrate together as the gold sparkles.",
      "Treasure Found",
    ), 2, "A complete cartoon story");

    expect(celebration.subjects).toHaveLength(2);
    expect(celebration.subjects.every((item) => item.kind === "character")).toBe(true);
    expect(celebration.actions).toContain("celebrate");
    expect(celebration.props).toEqual(expect.arrayContaining(["treasure", "tree", "lights"]));
  });

  it("recognizes completed jump and celebration verbs used by natural narration", () => {
    const action = analyzeAnimatedScene("cartoon", scene(
      "A bear and friends jumped beside a rainbow tree.",
      "They cheered and celebrated when the tree bloomed.",
      "Kindness Blooms",
    ), 2);
    expect(action.actions).toEqual(expect.arrayContaining(["jump", "grow", "celebrate"]));
  });

  it("adds an actor before applying a sparse middle-scene fallback action", () => {
    const fallback = analyzeAnimatedScene("cartoon", scene(
      "create an full cartoon video",
      "create an full cartoon video",
      "create an full cartoon video",
    ), 1);
    expect(fallback.actions).toContain("hold");
    expect(fallback.props).toContain("tree");
    expect(fallback.subjects).toEqual([{ kind: "character", label: "Story character" }]);
  });

  it("preserves open concepts that are not in the starter drawing vocabulary", () => {
    const arbitrary = analyzeAnimatedScene("story", scene(
      "A bioluminescent jellyfish drifts through an alien cathedral beside a quantum piano.",
      "The impossible instrument answers with ribbons of color.",
      "Quantum Cathedral",
    ), 0, "An unrestricted visual story");

    expect(arbitrary.concepts.map((item) => item.label.toLowerCase())).toEqual(expect.arrayContaining(["quantum", "cathedral"]));
    expect(arbitrary.semanticSignature).toContain("quantum");
  });

  it("embeds the resolved scene graph into the editable animation source", () => {
    const plannedScene = scene("A bear sleeps beside a glowing mushroom in the forest.", "Barnaby rests before meeting a dragon.", "Barnaby Rests", 0);
    const animation = analyzeAnimatedScene("cartoon", plannedScene, 0, "Forest story");
    const html = animatedSceneHtml("cartoon", { ...plannedScene, animation }, 0, "none", "Forest story");
    expect(html).toContain('"setting":"forest"');
    expect(html).toContain('"kind":"bear"');
    expect(html).toContain('"sleep"');
    expect(html).toContain('"mushroom"');
    expect(html).toContain("semanticCartoon");
  });

  it("stages vertical-only social work for a native portrait master", () => {
    expect(animatedSceneLayout({ presets: ["shorts"] })).toBe("portrait");
    expect(animatedSceneLayout({ presets: ["shorts", "reels", "tiktok"] })).toBe("portrait");
    expect(animatedSceneLayout({ presets: ["youtube-1080p", "shorts"] })).toBe("landscape");
    const plannedScene = scene("A bear holds a glowing seed while a bird flies through a garden.", "Kindness begins with one little seed.", "Plant Kindness", 0);
    const html = animatedSceneHtml("cartoon", plannedScene, 0, "none", "Kids Short", "portrait");
    expect(html).toContain('"layout":"portrait"');
    expect(html).toContain("portrait=project.layout==='portrait'");
    expect(html).toContain("/\\brainbow\\b/i");
    expect(html).not.toContain("/\brainbow\b/i");
  });

  it("does not count editorial scene titles as visible concepts or unique content", () => {
    const first = analyzeAnimatedScene("cartoon", scene(
      "A magic box floats above clouds.",
      "The magic box glows in the sky.",
      "Magic Box",
      0,
    ), 0);
    const second = analyzeAnimatedScene("cartoon", scene(
      "A magic box floats above clouds.",
      "The magic box glows in the sky.",
      "Magic Box",
      1,
    ), 1);

    expect(first.concepts.map((item) => item.label)).not.toEqual(expect.arrayContaining(["Hook", "Establish"]));
    expect(second.concepts.map((item) => item.label)).not.toEqual(expect.arrayContaining(["Develop", "Demonstrate"]));
    expect(first.semanticSignature).toBe(second.semanticSignature);
  });
});
