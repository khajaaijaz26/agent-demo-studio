import path from "node:path";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { getCreatorPreset } from "./presets.js";
import type { CreatorExport, CreatorManifest, CreatorRenderResult, CreatorRenderedOutput, CreatorValidationIssue } from "./types.js";

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "output";
}

export function validateSocialOutput(output: Pick<CreatorRenderedOutput, "id" | "preset" | "durationSeconds" | "width" | "height" | "fps" | "fileSizeBytes">): CreatorValidationIssue[] {
  const preset = getCreatorPreset(output.preset);
  const issues: CreatorValidationIssue[] = [];
  if (output.width !== preset.width || output.height !== preset.height) issues.push({ level: "error", code: "DIMENSION_MISMATCH", exportId: output.id, message: `${output.id} is ${output.width}x${output.height}; ${preset.label} expects ${preset.width}x${preset.height}.` });
  if (output.fps < 24 || output.fps > 60) issues.push({ level: "warning", code: "FRAME_RATE_UNUSUAL", exportId: output.id, message: `${output.fps.toFixed(2)} fps is outside the common 24–60 fps creator range.` });
  if (preset.advisoryMaxDurationSeconds && output.durationSeconds > preset.advisoryMaxDurationSeconds + 0.05) issues.push({ level: "warning", code: "DURATION_ADVISORY", exportId: output.id, message: `${preset.label} is ${output.durationSeconds.toFixed(1)}s; the current preset advisory maximum is ${preset.advisoryMaxDurationSeconds}s.` });
  if (preset.platform === "youtube" && output.fileSizeBytes > 256 * 1024 * 1024 * 1024) issues.push({ level: "error", code: "FILE_TOO_LARGE", exportId: output.id, message: "The output exceeds YouTube's documented 256 GB upload limit." });
  if (!issues.length) issues.push({ level: "info", code: "PROFILE_OK", exportId: output.id, message: `${preset.label} dimensions, duration advisory, and frame rate checks passed.` });
  return issues;
}

export function buildPublishingPlan(manifest: CreatorManifest, output: CreatorRenderedOutput): Record<string, unknown> {
  const config = manifest.exports?.find((item) => item.id === output.id);
  const preset = getCreatorPreset(output.preset);
  const common = {
    generatedAt: new Date().toISOString(),
    platform: preset.platform,
    preset: preset.id,
    video: path.basename(output.videoPath),
    thumbnail: path.basename(output.thumbnailPath),
    captions: output.captionsPath ? path.basename(output.captionsPath) : undefined,
    title: config?.title ?? manifest.title,
    description: config?.description ?? manifest.description ?? "",
    tags: config?.tags ?? [],
    reviewRequired: true,
  };
  if (preset.platform === "youtube") return {
    ...common,
    api: "YouTube Data API v3",
    flow: ["OAuth youtube.upload scope", "videos.insert resumable upload", "thumbnails.set", "captions.insert when supplied"],
    defaultPrivacy: "private",
    syntheticMediaDisclosure: "Set status.containsSyntheticMedia when applicable.",
  };
  if (preset.platform === "tiktok") return {
    ...common,
    api: "TikTok Content Posting API",
    flow: ["Query Creator Info", "Confirm creator-specific max duration and privacy choices", "Initialize FILE_UPLOAD", "Upload chunks", "Poll publish status"],
    requiredScope: "video.publish",
    unauditedClientBehavior: "Private-only",
  };
  if (preset.platform === "instagram") return {
    ...common,
    api: "Instagram Platform Content Publishing",
    flow: ["Host the rendered file at a public URL", "Create a REELS media container", "Poll container status", "Publish after review"],
    mediaType: "REELS",
    publicVideoUrl: "REPLACE_WITH_PUBLIC_VIDEO_URL",
  };
  return { ...common, api: "Manual or platform-specific upload", flow: ["Review video and rights report", "Upload in the target platform's publisher"] };
}

export interface SocialPackageResult {
  directory: string;
  manifestPath: string;
  outputs: Array<{ id: string; directory: string; video: string; thumbnail: string; captions?: string; chapters?: string; publishingPlan: string }>;
}

async function copyInto(source: string, directory: string): Promise<string> {
  const target = path.join(directory, path.basename(source));
  if (path.resolve(source) !== path.resolve(target)) await copyFile(source, target);
  return target;
}

export async function createSocialPackage(manifest: CreatorManifest, renderResult: CreatorRenderResult, destination?: string): Promise<SocialPackageResult> {
  const packageDirectory = path.resolve(destination ?? path.join(renderResult.outputDirectory, "publish-package"));
  await mkdir(packageDirectory, { recursive: true });
  const packaged: SocialPackageResult["outputs"] = [];
  for (const output of renderResult.outputs) {
    const directory = path.join(packageDirectory, `${safeId(output.preset)}-${safeId(output.id)}`);
    await mkdir(directory, { recursive: true });
    const video = await copyInto(output.videoPath, directory);
    const thumbnail = await copyInto(output.thumbnailPath, directory);
    const captions = output.captionsPath ? await copyInto(output.captionsPath, directory) : undefined;
    const chapters = output.chaptersPath ? await copyInto(output.chaptersPath, directory) : undefined;
    const planPath = path.join(directory, "publishing-plan.json");
    await writeFile(planPath, `${JSON.stringify(buildPublishingPlan(manifest, output), null, 2)}\n`, "utf8");
    const readme = [
      `# ${getCreatorPreset(output.preset).label} package`, "",
      `- Video: ${path.basename(video)}`, `- Thumbnail: ${path.basename(thumbnail)}`,
      ...(captions ? [`- Captions: ${path.basename(captions)}`] : []),
      ...(chapters ? [`- Chapters: ${path.basename(chapters)}`] : []),
      "- Publishing plan: publishing-plan.json", "",
      "Review the video, safe zones, metadata, and asset-license report before posting. Publishing is intentionally opt-in because each platform requires account authorization.", "",
    ];
    await writeFile(path.join(directory, "README.md"), readme.join("\n"), "utf8");
    packaged.push({ id: output.id, directory, video, thumbnail, captions, chapters, publishingPlan: planPath });
  }
  if (renderResult.licenseReportPath) await copyInto(renderResult.licenseReportPath, packageDirectory);
  const snapshot = {
    schemaVersion: 1,
    title: manifest.title,
    createdAt: new Date().toISOString(),
    sourceRenderResult: renderResult,
    outputs: packaged,
  };
  const manifestPath = path.join(packageDirectory, "release-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  const summary = await Promise.all(packaged.map(async (item) => ({ id: item.id, bytes: (await stat(item.video)).size, publishingPlan: JSON.parse(await readFile(item.publishingPlan, "utf8")) as unknown })));
  await writeFile(path.join(packageDirectory, "PACKAGE-SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return { directory: packageDirectory, manifestPath, outputs: packaged };
}

export function exportConfig(manifest: CreatorManifest, outputId: string): CreatorExport | undefined {
  return manifest.exports?.find((item) => item.id === outputId);
}
