import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { productions, productionById } from "./campaign.mjs";
import { renderProduction } from "./lib/render.mjs";

const campaignRoot = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(campaignRoot, "../..");
const sourceRoot = path.join(studioRoot, "test-output", "edulabs-v2", "scenes");
const workRoot = path.join(campaignRoot, ".work");
const assetsRoot = path.join(campaignRoot, "assets", "generated");
const deliverablesRoot = path.join(campaignRoot, "deliverables");
const manifestsRoot = path.join(campaignRoot, "manifests");

function has(flag) {
  return process.argv.includes(flag);
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

function selectedProductions() {
  if (has("--all")) return productions;
  if (has("--remaining")) return productions.filter((production) => production.id !== "01-meet-edulabsai-launch-film");
  const only = valueAfter("--only");
  if (only) {
    const production = productionById(only);
    if (!production) throw new Error(`Unknown production '${only}'. Available: ${productions.map((item) => item.id).join(", ")}`);
    return [production];
  }
  return [productionById("01-meet-edulabsai-launch-film")];
}

async function preflight(selected) {
  if (!(await exists(path.join(studioRoot, "dist", "index.js")))) {
    throw new Error("Agent Demo Studio is not built. Run `npm run build` from the repository root first.");
  }
  if (!(await exists(sourceRoot))) {
    throw new Error(`Verified product scenes are missing: ${sourceRoot}`);
  }
  const files = [...new Set(selected.flatMap((production) => production.scenes.flatMap((scene) => [scene.visual, scene.secondaryVisual].filter(Boolean))))];
  const missing = [];
  for (const fileName of files) if (!(await exists(path.join(sourceRoot, fileName)))) missing.push(fileName);
  if (missing.length) throw new Error(`Missing verified product scenes:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  await Promise.all([workRoot, assetsRoot, deliverablesRoot, manifestsRoot].map((directory) => mkdir(directory, { recursive: true })));
}

const selected = selectedProductions().filter(Boolean);
await preflight(selected);
const startedAt = new Date();
const results = [];

for (const production of selected) {
  const result = await renderProduction({
    production,
    campaignRoot,
    studioRoot,
    sourceRoot,
    workRoot,
    assetsRoot,
    deliverablesRoot,
    manifestsRoot,
    report: (message) => console.log(`${new Date().toISOString()} ${message}`),
  });
  results.push({
    id: production.id,
    title: production.title,
    format: production.format,
    durationSeconds: result.renderResult.outputs[0]?.durationSeconds,
    manifestPath: path.relative(campaignRoot, result.manifestPath).replaceAll("\\", "/"),
    packageDirectory: path.relative(campaignRoot, result.packageDirectory).replaceAll("\\", "/"),
    outputs: result.renderResult.outputs.map((output) => ({
      id: output.id,
      preset: output.preset,
      durationSeconds: output.durationSeconds,
      width: output.width,
      height: output.height,
      fps: output.fps,
      validation: output.validation,
    })),
  });
}

const summary = {
  campaign: "Meet EdulabsAI — premium launch campaign",
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  elapsedSeconds: Number(((Date.now() - startedAt.getTime()) / 1_000).toFixed(1)),
  productions: results,
};
await writeFile(path.join(campaignRoot, "BUILD-SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));

