import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { parseCaptions, serializeAss, serializeSrt, serializeVtt } from "../src/creator/captions.js";
import { listCreatorAssets, resolveBundledCreatorAsset } from "../src/creator/assets.js";
import { renderOverlayAssets } from "../src/creator/design.js";
import { listCreatorPresets } from "../src/creator/presets.js";
import { createPromptVideoManifest, createPromptVideoPlan } from "../src/creator/prompt.js";
import { publishToYouTube, tiktokChunkPlan } from "../src/creator/publish.js";
import { filterComplexFileOptionForVersion } from "../src/creator/renderer.js";
import { validateCreatorManifest } from "../src/creator/schema.js";
import { buildPublishingPlan, validateSocialOutput } from "../src/creator/social.js";
import { createTemplateManifest, listCreatorTemplates } from "../src/creator/templates.js";
import { CREATOR_IMAGE_MOTIONS, CREATOR_OVERLAY_ANIMATIONS, CREATOR_TRANSITIONS, CREATOR_VFX_PRESETS, type CreatorPromptMode, type CreatorRenderedOutput } from "../src/creator/types.js";

describe("creator manifests", () => {
  it("preserves explicitly authored full-canvas image overlays", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-demo-studio-overlay-"));
    try {
      const preset = listCreatorPresets().find((item) => item.id === "youtube-1080p")!;
      const source = path.join(directory, "plate.png");
      await sharp({
        create: {
          width: preset.width,
          height: preset.height,
          channels: 4,
          background: { r: 244, g: 91, b: 62, alpha: 0 },
        },
      }).png().toFile(source);

      const [asset] = await renderOverlayAssets([{
        id: "authored-plate",
        type: "image",
        source,
        startSeconds: 0,
        endSeconds: 2,
        x: 0.5,
        y: 0.5,
        width: preset.width,
        height: preset.height,
      }], preset, path.join(directory, "rendered"));

      expect(asset).toMatchObject({ x: 0, y: 0, width: preset.width, height: preset.height });
      await expect(sharp(asset!.path).metadata()).resolves.toMatchObject({ width: preset.width, height: preset.height });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("selects compatible file-backed filter graphs across FFmpeg generations", () => {
    expect(filterComplexFileOptionForVersion("ffmpeg version 6.1.1-3ubuntu5")).toBe("-filter_complex_script");
    expect(filterComplexFileOptionForVersion("ffmpeg version 7.0 Copyright")).toBe("-/filter_complex");
    expect(filterComplexFileOptionForVersion("ffmpeg version 9.0-full_build")).toBe("-/filter_complex");
  });

  it("applies a safe default export", () => {
    const result = validateCreatorManifest({ schemaVersion: 1, title: "Launch", clips: [{ id: "main", source: "demo.mp4" }] });
    expect(result.valid).toBe(true);
    expect(result.manifest?.exports).toEqual([{ id: "youtube", preset: "youtube-1080p" }]);
  });

  it("reports semantic timeline errors and license warnings", () => {
    const result = validateCreatorManifest({
      schemaVersion: 1,
      title: "Broken edit",
      clips: [
        { id: "duplicate", source: "one.mp4", trimStartSeconds: 3, trimEndSeconds: 2 },
        { id: "duplicate", source: "still.png", kind: "image", licenseId: "missing" },
      ],
      licenses: [
        { id: "rights", source: "one.mp4", license: "Original" },
        { id: "rights", source: "still.png", license: "Original" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "INVALID_TRIM",
      "DUPLICATE_ID",
      "IMAGE_DURATION_REQUIRED",
      "LICENSE_REFERENCE_MISSING",
      "DUPLICATE_LICENSE_ID",
    ]));
  });

  it("ships thirteen valid, editable templates", () => {
    const templates = listCreatorTemplates();
    expect(templates).toHaveLength(13);
    for (const template of templates) expect(validateCreatorManifest(template.manifest).valid).toBe(true);
    expect(createTemplateManifest("before-after").clips).toHaveLength(2);
    expect(createTemplateManifest("cartoon-story").overlays?.some((item) => item.type === "character")).toBe(true);
    expect(createTemplateManifest("vfx-showcase").clips[0]?.effects?.vfx).toContain("neon");
  });

  it("creates valid launch, cartoon, story, ASMR, and VFX projects from prompts", () => {
    const modes: CreatorPromptMode[] = ["product-launch", "cartoon", "story", "asmr", "vfx"];
    for (const mode of modes) {
      const manifest = createPromptVideoManifest({ prompt: `A complete ${mode} creative brief. Show the central idea. Finish with a memorable resolution.`, mode, presets: ["youtube-1080p"] });
      expect(validateCreatorManifest(manifest).valid, mode).toBe(true);
      expect(manifest.metadata).toMatchObject({ productionMode: mode, workflow: "prompt-to-video" });
    }
  });

  it("plans requirements, scenes, resources, workflow, and QA before production", () => {
    const plan = createPromptVideoPlan({
      prompt: "Launch a classroom planning assistant for busy teachers with a clear final CTA.",
      mode: "product-launch",
      presenter: "aria",
      presets: ["youtube-1080p", "reels"],
    });
    expect(plan.requirements).toMatchObject({ targetDurationSeconds: 24, outputPresets: ["youtube-1080p", "reels"] });
    expect(plan.scenes).toHaveLength(3);
    expect(plan.resources.map((resource) => resource.category)).toEqual(expect.arrayContaining(["scene", "character", "voice", "captions", "music", "vfx", "export"]));
    expect(plan.workflow[0]?.stage).toBe("Requirements");
    expect(plan.workflow.at(-1)?.stage).toBe("Delivery");
    expect(plan.qualityChecklist.some((item) => item.includes("do not overlap"))).toBe(true);
  });

  it("keeps the plan, resource list, and cartoon cast consistent with user choices", () => {
    const noHostPlan = createPromptVideoPlan({
      prompt: "Tell a visual story about a seed becoming a rooftop garden.",
      mode: "cartoon",
      presenter: "none",
      generateVoice: false,
      generateMusic: false,
    });
    expect(noHostPlan.resources.some((resource) => resource.category === "character")).toBe(false);
    expect(noHostPlan.scenes.every((scene) => scene.narration.startsWith("No narration"))).toBe(true);
    expect(noHostPlan.creativeDirection.characterDirection).toContain("No host");

    const noHostManifest = createPromptVideoManifest({
      prompt: "Tell a visual story about a seed becoming a rooftop garden.",
      mode: "cartoon",
      presenter: "none",
      generateVoice: false,
      generateMusic: false,
    });
    expect(noHostManifest.overlays?.some((overlay) => overlay.type === "character" || overlay.type === "presenter")).toBe(false);

    const miloManifest = createPromptVideoManifest({ prompt: "Milo explains a tiny invention.", mode: "cartoon", presenter: "milo" });
    expect(miloManifest.overlays?.filter((overlay) => overlay.type === "character").map((overlay) => overlay.id)).toEqual(["milo", "nova"]);
  });

  it("keeps bundled characters optional and supports an open uploaded cast and scene set", () => {
    const plan = createPromptVideoPlan({
      prompt: "A teacher and two original helpers explain fractions with paper shapes.",
      mode: "cartoon",
      sceneSources: ["lesson-board.png", "paper-shapes.png"],
      characters: [
        { name: "Teacher Sam", source: "teacher-sam.png", role: "presenter", rights: "Original authorized character" },
        { name: "Fraction Fox", source: "fraction-fox.png", role: "character", rights: "Original authorized character" },
      ],
      logoSource: "school-logo.png",
      musicSource: "gentle-score.wav",
      presenter: "none",
    });
    expect(plan.productionRules.map((rule) => rule.id)).toEqual(expect.arrayContaining(["plan-first", "open-assets", "story-sync", "safe-layout", "local-first"]));
    expect(plan.resources.filter((resource) => resource.category === "character").map((resource) => resource.requirement)).toEqual(expect.arrayContaining([
      expect.stringContaining("Teacher Sam"),
      expect.stringContaining("Fraction Fox"),
    ]));
    const manifest = createPromptVideoManifest({
      prompt: "A teacher and two original helpers explain fractions with paper shapes.",
      mode: "cartoon",
      sceneSources: ["lesson-board.png", "paper-shapes.png"],
      characters: [
        { name: "Teacher Sam", source: "teacher-sam.png", role: "presenter" },
        { name: "Fraction Fox", source: "fraction-fox.png", role: "character" },
      ],
      logoSource: "school-logo.png",
      presenter: "none",
    }, plan);
    expect(manifest.clips.map((clip) => clip.source)).toEqual(["lesson-board.png", "paper-shapes.png"]);
    expect(manifest.overlays?.filter((overlay) => overlay.type === "character" || overlay.type === "presenter").map((overlay) => overlay.source)).toEqual(["teacher-sam.png", "fraction-fox.png"]);
    expect(manifest.licenses?.map((license) => license.id)).toEqual(expect.arrayContaining(["provided-scene-1", "provided-character-1", "provided-logo"]));
  });

  it("locks authored plates and preserves scene-by-scene narration timing", () => {
    const narration = [
      "Sunlight warms water in oceans and lakes. Liquid water becomes invisible vapor.",
      "High in the sky, that vapor cools. Tiny droplets gather into clouds.",
      "Heavy droplets fall as rain or snow. Collected water begins the cycle again.",
    ].join(" ");
    const input = {
      prompt: "Teach the water cycle in three clear scenes.",
      narration,
      mode: "cartoon" as const,
      durationSeconds: 42,
      presenter: "none" as const,
      sceneSources: ["evaporation.svg", "condensation.svg", "precipitation.svg"],
    };
    const plan = createPromptVideoPlan(input);
    expect(plan.scenes.map((scene) => scene.narration)).toEqual([
      "Sunlight warms water in oceans and lakes. Liquid water becomes invisible vapor.",
      "High in the sky, that vapor cools. Tiny droplets gather into clouds.",
      "Heavy droplets fall as rain or snow. Collected water begins the cycle again.",
    ]);
    const manifest = createPromptVideoManifest(input, plan);
    expect(manifest.clips.map((clip) => clip.motion)).toEqual(["none", "none", "none"]);
    expect(manifest.clips.map((clip) => clip.durationSeconds)).toEqual([
      plan.scenes[0]!.durationSeconds + 0.5,
      plan.scenes[1]!.durationSeconds + 0.5,
      plan.scenes[2]!.durationSeconds,
    ]);
    expect(manifest.overlays?.find((overlay) => overlay.id === "opening-title")?.animation?.loop).toBe("none");

    const shortScript = createPromptVideoPlan({
      prompt: "A two-line lesson.",
      narration: "Introduce the idea. Finish with the result.",
      mode: "story",
    });
    expect(shortScript.scenes.map((scene) => scene.narration)).toEqual([
      "Introduce the idea.",
      "Finish with the result.",
      "No narration; visuals carry this scene.",
    ]);
  });

  it("ships resolvable fictional characters, presenters, scenes, and effect catalogs", () => {
    const assets = listCreatorAssets();
    expect(assets).toHaveLength(8);
    expect(new Set(assets.map((item) => item.source)).size).toBe(8);
    for (const asset of assets) {
      expect(asset.synthetic).toBe(true);
      const resolved = resolveBundledCreatorAsset(asset.source);
      expect(resolved).toBeTruthy();
      expect(existsSync(resolved!)).toBe(true);
    }
    expect(CREATOR_TRANSITIONS).toHaveLength(28);
    expect(CREATOR_OVERLAY_ANIMATIONS).toContain("pop");
    expect(CREATOR_IMAGE_MOTIONS).toContain("ken-burns-in");
    expect(CREATOR_VFX_PRESETS).toEqual(expect.arrayContaining(["cinematic", "glitch", "asmr-soft"]));
  });
});

describe("captions", () => {
  const source = "1\n00:00:00,250 --> 00:00:02,000\nCreate once, publish everywhere.\n\n2\n00:00:02.100 --> 00:00:04.000\nCaptions stay editable.\n";

  it("normalizes SRT and WebVTT cues", () => {
    const cues = parseCaptions(source);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startSeconds: 0.25, endSeconds: 2, text: "Create once, publish everywhere." });
    expect(serializeSrt(cues)).toContain("00:00:02,100 --> 00:00:04,000");
    expect(serializeVtt(cues)).toContain("WEBVTT\n\n");
    expect(parseCaptions("WEBVTT\n\n00:01.250 --> 00:02.500 align:start\nShort WebVTT timestamps\n")[0]).toMatchObject({ startSeconds: 1.25, endSeconds: 2.5 });
  });

  it("creates resolution-aware ASS captions inside the safe zone", () => {
    const preset = listCreatorPresets().find((item) => item.id === "shorts")!;
    const ass = serializeAss(parseCaptions(source), preset, { position: "bottom", maxCharactersPerLine: 20 });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain(`,${preset.safeZone.bottom},1`);
    expect(ass).toContain("Create once, publish\\Neverywhere.");
  });

  it("paginates long cues instead of overflowing the video", () => {
    const preset = listCreatorPresets().find((item) => item.id === "shorts")!;
    const ass = serializeAss([{ index: 1, startSeconds: 0, endSeconds: 6, text: "A deliberately long caption cue keeps every spoken word visible without stacking text over the interface or pushing copy beyond the safe area." }], preset, { maxCharactersPerLine: 12, maxLines: 2 });
    const events = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
    expect(events.length).toBeGreaterThan(1);
    expect(events.every((line) => line.split("\\N").length <= 2)).toBe(true);
  });
});

describe("creator export profiles", () => {
  it("covers long-form, vertical, square, portrait, and 4K targets", () => {
    const presets = listCreatorPresets();
    expect(presets).toHaveLength(10);
    expect(new Set(presets.map((item) => item.id)).size).toBe(10);
    expect(presets.find((item) => item.id === "youtube-4k")).toMatchObject({ width: 3840, height: 2160 });
    expect(presets.find((item) => item.id === "reels")).toMatchObject({ width: 1080, height: 1920 });
    expect(presets.find((item) => item.id === "square")).toMatchObject({ width: 1080, height: 1080 });
  });

  it("validates rendered media against its target profile", () => {
    const validOutput: CreatorRenderedOutput = {
      id: "short",
      preset: "shorts",
      platform: "youtube",
      videoPath: "short.mp4",
      thumbnailPath: "short.jpg",
      durationSeconds: 45,
      width: 1080,
      height: 1920,
      fps: 30,
      fileSizeBytes: 12_000_000,
      validation: [],
    };
    expect(validateSocialOutput(validOutput)).toEqual([expect.objectContaining({ code: "PROFILE_OK" })]);
    expect(validateSocialOutput({ ...validOutput, height: 1080, durationSeconds: 181 }).map((issue) => issue.code)).toEqual(expect.arrayContaining(["DIMENSION_MISMATCH", "DURATION_ADVISORY"]));
  });

  it("builds review-first platform publishing plans", () => {
    const manifest = createTemplateManifest("launch-short", { title: "Release day" });
    const output = {
      id: "tiktok",
      preset: "tiktok",
      platform: "tiktok",
      videoPath: "release.mp4",
      thumbnailPath: "release.jpg",
      durationSeconds: 30,
      width: 1080,
      height: 1920,
      fps: 30,
      fileSizeBytes: 1_000,
      validation: [],
    } satisfies CreatorRenderedOutput;
    expect(buildPublishingPlan(manifest, output)).toMatchObject({
      platform: "tiktok",
      requiredScope: "video.publish",
      reviewRequired: true,
    });
  });

  it("rejects invalid YouTube visibility before any network operation", async () => {
    const output = {
      id: "youtube",
      preset: "youtube-1080p",
      platform: "youtube",
      videoPath: "missing.mp4",
      thumbnailPath: "missing.jpg",
      durationSeconds: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      fileSizeBytes: 1_000,
      validation: [],
    } satisfies CreatorRenderedOutput;
    await expect(publishToYouTube(output, { title: "Review" }, {
      accessToken: "not-sent",
      confirmPublish: true,
      privacyStatus: "friends" as never,
    })).rejects.toMatchObject({ code: "YOUTUBE_PRIVACY_INVALID" });
  });

  it("uses TikTok's whole-file and merged-final-chunk rules", () => {
    expect(tiktokChunkPlan(4 * 1024 * 1024)).toEqual({ chunkSize: 4 * 1024 * 1024, totalChunks: 1 });
    expect(tiktokChunkPlan(50_000_123, 10_000_000)).toEqual({ chunkSize: 10_000_000, totalChunks: 5 });
    expect(tiktokChunkPlan(65 * 1024 * 1024, 64 * 1024 * 1024)).toEqual({ chunkSize: 64 * 1024 * 1024, totalChunks: 1 });
  });
});
