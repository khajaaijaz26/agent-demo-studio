import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { production } from "./campaign.mjs";
import { prepareVisualAssets } from "./lib/assets.mjs";
import { renderProduction } from "./lib/render.mjs";

const campaignRoot = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(campaignRoot, "../..");
const sourceRoot = process.env.EDULABSAI_RECORDINGS
  ? path.resolve(process.env.EDULABSAI_RECORDINGS)
  : path.join(studioRoot, "test-output", "edulabs-v2", "scenes");
const workRoot = path.join(campaignRoot, ".work");
const assetsRoot = path.join(campaignRoot, "assets", "generated");
const deliverablesRoot = path.join(campaignRoot, "deliverables");
const manifestsRoot = path.join(campaignRoot, "manifests");

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

async function resolveBrandRoot() {
  const candidates = [
    process.env.EDULABSAI_SOURCE ? path.join(process.env.EDULABSAI_SOURCE, "public", "brand") : undefined,
    path.join("C:\\Users\\khaja\\EduLabsAI99", "public", "brand"),
    path.resolve(studioRoot, "..", "..", "EduLabsAI99", "public", "brand"),
    path.resolve(studioRoot, "..", "EduLabsAI99", "public", "brand")
  ].filter(Boolean);
  for (const candidate of candidates) {
    if ((await exists(path.join(candidate, "edulabsai-profile-coral.png"))) && (await exists(path.join(candidate, "edulabsai-mark.svg")))) return candidate;
  }
  throw new Error("Could not locate EdulabsAI brand assets. Set EDULABSAI_SOURCE to the EdulabsAI repository root.");
}

async function preflight() {
  const required = [
    path.join(studioRoot, "dist", "index.js"),
    path.join(sourceRoot, "09-teacher-lesson-brief.webm"),
    path.join(sourceRoot, "10-lesson-overview.webm"),
    path.join(sourceRoot, "11-lesson-plan-tab.webm"),
    path.join(sourceRoot, "12-lesson-slides-tab.webm"),
    path.join(sourceRoot, "13-lesson-quiz-tab.webm"),
    path.join(sourceRoot, "14-lesson-worksheet-tab.webm"),
    path.join(sourceRoot, "16-lesson-export-hub.webm"),
    path.join(sourceRoot, "18-resource-pptx-original.webm"),
    path.join(sourceRoot, "27-teacher-learning-insights.webm"),
    path.join(sourceRoot, "28-teacher-snap-mark.webm"),
    path.join(sourceRoot, "30-teacher-family-digests.webm"),
    path.join(sourceRoot, "33-student-dashboard.webm"),
    path.join(assetsRoot, "illustrations", "teacher-fragmented.png"),
    path.join(assetsRoot, "illustrations", "teacher-connected.png"),
    path.join(assetsRoot, "illustrations", "classroom-connected.png")
  ];
  const missing = [];
  for (const filePath of required) if (!(await exists(filePath))) missing.push(filePath);
  if (missing.length) throw new Error(`Missing required production inputs:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  await Promise.all([workRoot, assetsRoot, deliverablesRoot, manifestsRoot].map((directory) => mkdir(directory, { recursive: true })));
  return resolveBrandRoot();
}

const report = (message) => console.log(`${new Date().toISOString()} ${message}`);
const startedAt = new Date();
const brandRoot = await preflight();

if (process.argv.includes("--assets-only")) {
  report("Building native 4K and mobile assets only");
  const result = await prepareVisualAssets({ assetsRoot, sourceRoot, brandRoot, production });
  const summary = {
    campaign: production.title,
    mode: "assets-only",
    completedAt: new Date().toISOString(),
    formats: Object.keys(result.scenes),
    scenes: production.scenes.map((scene) => scene.id),
    alignmentSpec: path.relative(campaignRoot, result.alignmentSpec).replaceAll("\\", "/")
  };
  await writeFile(path.join(campaignRoot, "ASSET-BUILD-SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
} else {
  const result = await renderProduction({
    production,
    campaignRoot,
    sourceRoot,
    brandRoot,
    workRoot,
    assetsRoot,
    deliverablesRoot,
    manifestsRoot,
    report
  });
  const summary = {
    campaign: production.title,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    elapsedSeconds: Number(((Date.now() - startedAt.getTime()) / 1000).toFixed(1)),
    durationSeconds: Number(result.timeline.duration.toFixed(3)),
    packageDirectory: path.relative(campaignRoot, result.packageRoot).replaceAll("\\", "/"),
    outputs: result.results.map((item) => {
      const output = item.renderResult.outputs[0];
      const packaged = item.socialPackage.outputs[0];
      return {
        format: item.format.id,
        preset: output?.preset,
        width: output?.width,
        height: output?.height,
        fps: output?.fps,
        durationSeconds: output?.durationSeconds,
        videoPath: packaged?.video,
        validation: output?.validation,
        animationAudit: item.audit
      };
    })
  };
  await writeFile(path.join(campaignRoot, "BUILD-SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}
