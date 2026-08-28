import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { production } from "./campaign.mjs";
import { prepareVisualAssets } from "./lib/assets.mjs";
import { renderProduction } from "./lib/render.mjs";

const campaignRoot = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(campaignRoot, "../..");
const sourceRoot = path.join(studioRoot, "test-output", "edulabs-v2", "scenes");
const workRoot = path.join(campaignRoot, ".work");
const assetsRoot = path.join(campaignRoot, "assets", "generated");
const deliverablesRoot = path.join(campaignRoot, "deliverables");
const manifestsRoot = path.join(campaignRoot, "manifests");

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}
async function preflight() {
  const required = [
    path.join(studioRoot, "dist", "index.js"),
    path.join(sourceRoot, "09-teacher-lesson-brief.webm"),
    path.join(sourceRoot, "10-lesson-overview.webm"),
    path.join(sourceRoot, "18-resource-pptx-original.webm"),
    path.join(sourceRoot, "33-student-dashboard.webm"),
    path.join(sourceRoot, "28-teacher-snap-mark.webm"),
    path.join(sourceRoot, "27-teacher-learning-insights.webm"),
    path.join(sourceRoot, "30-teacher-family-digests.webm"),
  ];
  const missing = [];
  for (const filePath of required) if (!(await exists(filePath))) missing.push(filePath);
  if (missing.length) throw new Error(`Missing required production inputs:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  await Promise.all([workRoot, assetsRoot, deliverablesRoot, manifestsRoot].map((directory) => mkdir(directory, { recursive: true })));
}

await preflight();
const startedAt = new Date();
const report = (message) => console.log(`${new Date().toISOString()} ${message}`);

if (process.argv.includes("--assets-only")) {
  report("Building alignment-locked visual assets only");
  const result = await prepareVisualAssets(assetsRoot, sourceRoot, production);
  const summary = {
    campaign: production.title,
    mode: "assets-only",
    completedAt: new Date().toISOString(),
    scenes: Object.keys(result.scenes),
    alignmentSpec: result.alignmentSpec,
  };
  await writeFile(path.join(campaignRoot, "ASSET-BUILD-SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
} else {
  const result = await renderProduction({
    production,
    campaignRoot,
    sourceRoot,
    workRoot,
    assetsRoot,
    deliverablesRoot,
    manifestsRoot,
    report,
  });
  const output = result.renderResult.outputs[0];
  const summary = {
    campaign: production.title,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    elapsedSeconds: Number(((Date.now() - startedAt.getTime()) / 1000).toFixed(1)),
    manifestPath: path.relative(campaignRoot, result.manifestPath).replaceAll("\\", "/"),
    packageDirectory: path.relative(campaignRoot, result.packageDirectory).replaceAll("\\", "/"),
    stabilityAudit: result.stabilityAudit,
    output: output ? {
      id: output.id,
      preset: output.preset,
      durationSeconds: output.durationSeconds,
      width: output.width,
      height: output.height,
      fps: output.fps,
      validation: output.validation,
    } : undefined,
  };
  await writeFile(path.join(campaignRoot, "BUILD-SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}
