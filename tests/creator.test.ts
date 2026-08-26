import { describe, expect, it } from "vitest";
import { parseCaptions, serializeAss, serializeSrt, serializeVtt } from "../src/creator/captions.js";
import { listCreatorPresets } from "../src/creator/presets.js";
import { publishToYouTube, tiktokChunkPlan } from "../src/creator/publish.js";
import { validateCreatorManifest } from "../src/creator/schema.js";
import { buildPublishingPlan, validateSocialOutput } from "../src/creator/social.js";
import { createTemplateManifest, listCreatorTemplates } from "../src/creator/templates.js";
import type { CreatorRenderedOutput } from "../src/creator/types.js";

describe("creator manifests", () => {
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

  it("ships eight valid, editable templates", () => {
    const templates = listCreatorTemplates();
    expect(templates).toHaveLength(8);
    for (const template of templates) expect(validateCreatorManifest(template.manifest).valid).toBe(true);
    expect(createTemplateManifest("before-after").clips).toHaveLength(2);
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
