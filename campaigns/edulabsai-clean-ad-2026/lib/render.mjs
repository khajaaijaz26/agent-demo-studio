import path from "node:path";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

import { createSocialPackage, renderCreatorManifest } from "../../../dist/index.js";

import { campaign } from "../campaign.mjs";
import { generateGentleScore, generateSceneSpeech, writeCaptions } from "./audio.mjs";
import { prepareVisualAssets } from "./assets.mjs";

const DEFAULT_LEAD = 0.62;
const OPENING_LEAD = 1.05;
const TAIL = 1.0;

function relative(fromDirectory, filePath) {
  const value = path.relative(fromDirectory, filePath).replaceAll("\\", "/");
  return value.startsWith(".") ? value : `./${value}`;
}

function computeTimeline(production, speech) {
  const entries = [];
  let cursor = 0;
  for (const scene of production.scenes) {
    const voice = speech.find((item) => item.sceneId === scene.id);
    if (!voice) throw new Error(`Missing narration for scene '${scene.id}'.`);
    const lead = scene.id === "one-clear-idea" ? OPENING_LEAD : DEFAULT_LEAD;
    const minimum = scene.id === "one-clear-idea" || scene.id === "start-free" ? 7.4 : 6.6;
    const duration = Math.max(minimum, voice.duration + lead + TAIL);
    const start = cursor;
    const end = start + duration;
    entries.push({ scene, voice, lead, start, end, duration });
    cursor = end;
  }
  return { entries, duration: cursor };
}

function fullCanvasOverlay(entry, source, index) {
  const openingLogo = entry.scene.id === "one-clear-idea" && index === 0;
  const openingCopy = entry.scene.id === "one-clear-idea" && index === 1;
  const startOffset = openingLogo ? 0.16 : openingCopy ? 1.05 : index === 0 ? 0.24 : 0.92;
  return {
    id: `${entry.scene.id}-locked-layer-${index + 1}`,
    type: "image",
    source,
    startSeconds: Number((entry.start + startOffset).toFixed(3)),
    endSeconds: Number(entry.end.toFixed(3)),
    x: 0.5,
    y: 0.5,
    width: 1920,
    height: 1080,
    opacity: 1,
    animation: {
      enter: openingLogo ? "drop" : "fade",
      exit: "none",
      loop: "none",
      durationSeconds: openingLogo ? 0.86 : 0.52,
      exitDurationSeconds: 0.1,
      intensity: openingLogo ? 3 : 0,
    },
    licenseId: openingLogo ? "edulabsai-brand" : entry.scene.still && index === 0 ? "edulabsai-verified-product-stills" : "edulabsai-locked-motion-art",
  };
}

function captionStyle() {
  return {
    position: "bottom",
    fontSize: 38,
    color: campaign.palette.cream,
    // ASS alpha is inverse (00 = opaque, FF = transparent). 24 keeps the panel
    // dark and readable on cream scenes while retaining a small amount of depth.
    background: "#170C2924",
    accent: campaign.palette.coral,
    maxCharactersPerLine: 58,
    maxLines: 2,
    margin: 58,
  };
}

function auditManifest(manifest) {
  const checks = {
    canvasIs1080p: manifest.exports.every((item) => item.preset === "youtube-1080p"),
    clipsAreImages: manifest.clips.every((clip) => clip.kind === "image"),
    clipMotionLocked: manifest.clips.every((clip) => clip.motion === "none"),
    sceneChangesAreCuts: manifest.clips.every((clip) => clip.transition?.type === "cut"),
    noClipVfx: manifest.clips.every((clip) => !clip.effects?.vfx?.length),
    overlaysAreImages: manifest.overlays.every((overlay) => overlay.type === "image"),
    overlaysUseFullCanvasGrid: manifest.overlays.every((overlay) => overlay.x === 0.5 && overlay.y === 0.5 && overlay.width === 1920 && overlay.height === 1080),
    overlayLoopsDisabled: manifest.overlays.every((overlay) => overlay.animation?.loop === "none"),
    noOverlayExitMotion: manifest.overlays.every((overlay) => overlay.animation?.exit === "none"),
    onlyOpeningDropMoves: manifest.overlays.every((overlay) => overlay.animation?.enter === "fade" || overlay.id === "one-clear-idea-locked-layer-1" && overlay.animation?.enter === "drop"),
    noVideoOverlays: manifest.overlays.every((overlay) => overlay.type !== "video"),
    noSoundEffects: (manifest.audio?.soundEffects ?? []).length === 0,
    clipAudioDisabled: manifest.audio?.keepClipAudio === false,
    musicDoesNotLoop: manifest.audio?.music?.loop === false,
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    passed,
    policy: "All visuals remain position-locked. The only positional animation is the opening orange logo drop.",
    checks,
  };
}

async function writeReleaseManifest(packageDirectory, production, renderResult, timeline, stabilityAudit) {
  const output = renderResult.outputs[0];
  const release = {
    schemaVersion: 2,
    campaign: campaign.name,
    productionId: production.id,
    title: production.title,
    generatedAt: new Date().toISOString(),
    durationSeconds: output?.durationSeconds,
    format: { width: output?.width, height: output?.height, fps: output?.fps, preset: output?.preset },
    master: output ? path.basename(output.videoPath) : undefined,
    stabilityAudit,
    audioPolicy: {
      narration: campaign.voiceName,
      voiceRate: campaign.voiceRate,
      score: "Quiet Momentum — original continuous ambient score",
      percussion: false,
      soundEffects: false,
    },
    sceneTimeline: timeline.entries.map((entry) => ({
      id: entry.scene.id,
      startSeconds: Number(entry.start.toFixed(3)),
      endSeconds: Number(entry.end.toFixed(3)),
      narration: entry.scene.narration,
    })),
    rights: [
      "EdulabsAI-owned brand and verified product recordings",
      "Original fixed vector production design and original procedural score",
      "Microsoft Edge neural speech subject to provider terms",
    ],
    reviewRequiredBeforePublishing: true,
  };
  await writeFile(path.join(packageDirectory, "release-manifest.json"), `${JSON.stringify(release, null, 2)}\n`, "utf8");
}

export async function renderProduction({ production, campaignRoot, sourceRoot, workRoot, assetsRoot, deliverablesRoot, manifestsRoot, report = console.log }) {
  report("Generating slower, scene-locked narration");
  const speech = await generateSceneSpeech(production, workRoot, campaign.voice, campaign.voiceRate);
  const timeline = computeTimeline(production, speech);
  report(`Timeline locked at ${timeline.duration.toFixed(1)} seconds across ${timeline.entries.length} scenes`);

  report("Building fixed 1920×1080 plates and product stills");
  const assets = await prepareVisualAssets(assetsRoot, sourceRoot, production);
  const productionWork = path.join(workRoot, production.id);
  const musicPath = path.join(productionWork, "quiet-momentum.wav");
  await generateGentleScore(musicPath, timeline.duration);
  const captionsPath = path.join(productionWork, `${production.id}.srt`);
  await writeCaptions(captionsPath, timeline.entries.map((entry) => ({
    start: entry.start + entry.lead,
    end: Math.min(entry.end - 0.3, entry.start + entry.lead + entry.voice.duration),
    text: entry.scene.narration,
    maxWords: 8,
  })));

  await mkdir(manifestsRoot, { recursive: true });
  const manifestPath = path.join(manifestsRoot, `${production.id}.creator.json`);
  const clips = timeline.entries.map((entry) => ({
    id: entry.scene.id,
    source: relative(manifestsRoot, assets.scenes[entry.scene.id].base),
    kind: "image",
    durationSeconds: Number(entry.duration.toFixed(3)),
    motion: "none",
    reframe: "fill",
    transition: { type: "cut", durationSeconds: 0 },
    chapter: entry.scene.eyebrow,
    licenseId: "edulabsai-locked-motion-art",
  }));
  const overlays = timeline.entries.flatMap((entry) => assets.scenes[entry.scene.id].layers.map((source, index) => ({
    ...fullCanvasOverlay(entry, relative(manifestsRoot, source), index),
  })));
  const voices = timeline.entries.map((entry) => ({
    source: relative(manifestsRoot, entry.voice.path),
    startSeconds: Number((entry.start + entry.lead).toFixed(3)),
    volume: 1,
    licenseId: "microsoft-edge-neural-speech",
  }));
  const manifest = {
    schemaVersion: 2,
    title: production.title,
    description: `${production.description} ${campaign.website}`,
    outputDirectory: relative(manifestsRoot, path.join(workRoot, "renders", production.id)),
    brand: {
      name: "EdulabsAI",
      primary: campaign.palette.coral,
      secondary: campaign.palette.gold,
      text: campaign.palette.cream,
      fontFamily: "Segoe UI",
    },
    clips,
    overlays,
    captions: {
      source: relative(manifestsRoot, captionsPath),
      format: "srt",
      burn: true,
      sidecar: true,
      language: "en",
      style: captionStyle(),
    },
    audio: {
      voices,
      music: {
        source: relative(manifestsRoot, musicPath),
        loop: false,
        volume: 0.12,
        fadeInSeconds: 1.8,
        fadeOutSeconds: 2.6,
        licenseId: "edulabsai-quiet-momentum-score",
      },
      soundEffects: [],
      mode: "voice",
      keepClipAudio: false,
      duckMusic: true,
      duckingThreshold: 0.032,
      targetLufs: -16,
      truePeak: -2.5,
    },
    chapters: timeline.entries.map((entry) => ({ title: entry.scene.eyebrow, startSeconds: Number(entry.start.toFixed(3)) })),
    exports: [{
      id: "clean-master",
      preset: "youtube-1080p",
      fileName: production.id,
      title: production.title,
      description: production.description,
      tags: ["EdulabsAI", "AI for teachers", "lesson planning", "K-12", "education technology"],
      quality: 17,
      burnCaptions: true,
      thumbnailAtSeconds: 2.2,
    }],
    licenses: [
      { id: "edulabsai-brand", source: "EdulabsAI brand identity", title: "EdulabsAI brand", creator: "EdulabsAI", license: "Owner-provided", attribution: "EdulabsAI", proofUrl: campaign.website },
      { id: "edulabsai-verified-product-stills", source: "Still frames extracted from verified EdulabsAI browser recordings", title: "EdulabsAI product UI", creator: "EdulabsAI", license: "Owner-provided", attribution: "EdulabsAI", proofUrl: "test-output/edulabs-v2/recorded-scenes.json" },
      { id: "edulabsai-locked-motion-art", source: "Original fixed SVG and PNG production design", title: "One Learning Loop visual system", creator: "EdulabsAI with Agent Demo Studio", license: "Original work", attribution: "EdulabsAI" },
      { id: "edulabsai-quiet-momentum-score", source: "Original procedural continuous-pad composition", title: "Quiet Momentum", creator: "EdulabsAI with Agent Demo Studio", license: "Original work", attribution: "EdulabsAI" },
      { id: "microsoft-edge-neural-speech", source: campaign.voice, title: campaign.voiceName, creator: "Microsoft", license: "Provider terms", attribution: "Neural narration" },
    ],
    metadata: {
      campaign: campaign.name,
      campaignVersion: 1,
      productionId: production.id,
      productionPlan: "../PRODUCTION-PLAN.md",
      creativeDirection: "../CREATIVE-DIRECTION.md",
      fixedProductStills: true,
      continuousMotion: false,
      openingLogoDropOnly: true,
      soundEffects: false,
      originalMusic: true,
      syntheticVoice: true,
      sceneTimeline: timeline.entries.map((entry) => ({ id: entry.scene.id, startSeconds: entry.start, endSeconds: entry.end })),
    },
  };

  const stabilityAudit = auditManifest(manifest);
  if (!stabilityAudit.passed) throw new Error(`Stability audit failed: ${JSON.stringify(stabilityAudit.checks)}`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(manifestsRoot, `${production.id}.stability-audit.json`), `${JSON.stringify(stabilityAudit, null, 2)}\n`, "utf8");

  report("Rendering the locked clean master");
  const renderResult = await renderCreatorManifest(manifestPath, (progress, message) => report(`${Math.round(progress)}% ${message}`));
  const packageDirectory = path.join(deliverablesRoot, production.id);
  await createSocialPackage(manifest, renderResult, packageDirectory);
  await writeReleaseManifest(packageDirectory, production, renderResult, timeline, stabilityAudit);
  await copyFile(path.join(manifestsRoot, `${production.id}.stability-audit.json`), path.join(packageDirectory, "STABILITY-AUDIT.json"));
  await copyFile(path.join(campaignRoot, "PRODUCTION-PLAN.md"), path.join(packageDirectory, "PRODUCTION-PLAN.md"));
  const packageSummaryPath = path.join(packageDirectory, "PACKAGE-SUMMARY.json");
  const packageSummary = JSON.parse(await readFile(packageSummaryPath, "utf8"));
  await writeFile(packageSummaryPath, `${JSON.stringify({
    productionId: production.id,
    title: production.title,
    durationSeconds: renderResult.outputs[0]?.durationSeconds,
    stabilityAudit,
    outputs: packageSummary,
  }, null, 2)}\n`, "utf8");
  report(`Package ready: ${packageDirectory}`);
  return { manifestPath, manifest, timeline, renderResult, packageDirectory, stabilityAudit };
}
