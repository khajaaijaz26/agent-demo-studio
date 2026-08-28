import path from "node:path";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

import { createSocialPackage, renderCreatorManifest } from "../../../dist/index.js";

import { campaign, formats } from "../campaign.mjs";
import { generateCinematicScore, generateSceneSpeech, writeCaptions } from "./audio.mjs";
import { prepareVisualAssets } from "./assets.mjs";

const DEFAULT_LEAD = 0.58;
const OPENING_LEAD = 0.46;
const TAIL = 0.9;

function relative(fromDirectory, filePath) {
  const value = path.relative(fromDirectory, filePath).replaceAll("\\", "/");
  return value.startsWith(".") ? value : `./${value}`;
}

function computeTimeline(production, speech) {
  const entries = [];
  let cursor = 0;
  for (const [index, scene] of production.scenes.entries()) {
    const voice = speech.find((item) => item.sceneId === scene.id);
    if (!voice) throw new Error(`Missing narration for scene '${scene.id}'.`);
    const lead = scene.id === "brand-arrival" ? OPENING_LEAD : DEFAULT_LEAD;
    const duration = Math.max(scene.minimumSeconds, voice.duration + lead + TAIL);
    // If a future clip transition overlaps scenes, place every overlay and
    // voice on that same effective timeline so narration cannot drift.
    const overlap = index === 0 ? 0 : transitionFor(index).durationSeconds;
    const start = Math.max(0, cursor - overlap);
    const end = start + duration;
    entries.push({ scene, voice, lead, start, end, duration });
    cursor = end;
  }
  return { entries, duration: cursor };
}

function transitionFor(index) {
  // The campaign's visible transitions are built into the full-canvas layers:
  // drop, rise, pop, fade, and directional product reveals. Editorial cuts at
  // the clip level keep 4K rendering deterministic and make the audio/visual
  // timeline exact without decoding twelve UHD streams simultaneously.
  return { type: "cut", durationSeconds: 0 };
}

function captionStyle(format) {
  return {
    position: "bottom",
    fontSize: format.captionFontSize,
    color: campaign.palette.cream,
    background: "#170C2920",
    accent: campaign.palette.coral,
    maxCharactersPerLine: format.maxCaptionCharacters,
    maxLines: 2,
    margin: format.captionMargin
  };
}

function buildManifest({ production, format, timeline, assets, captionsPath, musicPath, manifestsRoot, workRoot }) {
  const clips = timeline.entries.map((entry, index) => ({
    id: `${format.id}-${entry.scene.id}`,
    source: relative(manifestsRoot, assets.scenes[format.id][entry.scene.id].base),
    kind: "image",
    durationSeconds: Number(entry.duration.toFixed(3)),
    motion: "none",
    reframe: "fill",
    transition: transitionFor(index),
    chapter: entry.scene.eyebrow,
    licenseId: "campaign-motion-design"
  }));

  const overlays = timeline.entries.flatMap((entry) => assets.scenes[format.id][entry.scene.id].layers.map((item, index) => ({
    id: `${format.id}-${entry.scene.id}-${item.role}-${index + 1}`,
    type: "image",
    source: relative(manifestsRoot, item.path),
    startSeconds: Number((entry.start + item.delay).toFixed(3)),
    endSeconds: Number((entry.end - .03).toFixed(3)),
    x: .5,
    y: .5,
    width: format.width,
    height: format.height,
    opacity: 1,
    animation: {
      enter: item.enter,
      exit: "none",
      loop: "none",
      durationSeconds: item.enterDuration,
      exitDurationSeconds: .1,
      intensity: item.intensity ?? 1
    },
    licenseId: item.licenseId
  })));

  const voices = timeline.entries.map((entry) => ({
    source: relative(manifestsRoot, entry.voice.path),
    startSeconds: Number((entry.start + entry.lead).toFixed(3)),
    volume: 1,
    licenseId: "microsoft-edge-neural-speech"
  }));

  return {
    schemaVersion: 2,
    title: production.title,
    description: `${production.description} ${campaign.website}`,
    outputDirectory: relative(manifestsRoot, path.join(workRoot, "renders", production.id, format.id)),
    brand: {
      name: "EdulabsAI",
      logo: relative(manifestsRoot, assets.brand.profile),
      logoLicenseId: "edulabsai-brand",
      primary: campaign.palette.coral,
      secondary: campaign.palette.gold,
      text: campaign.palette.cream,
      fontFamily: "Segoe UI"
    },
    clips,
    overlays,
    captions: {
      source: relative(manifestsRoot, captionsPath),
      format: "srt",
      burn: true,
      sidecar: true,
      language: "en",
      style: captionStyle(format)
    },
    audio: {
      voices,
      music: {
        source: relative(manifestsRoot, musicPath),
        loop: false,
        volume: .145,
        fadeInSeconds: 2.2,
        fadeOutSeconds: 3.2,
        licenseId: "connected-light-score"
      },
      soundEffects: [],
      mode: "voice",
      keepClipAudio: false,
      duckMusic: true,
      duckingThreshold: .03,
      targetLufs: -16,
      truePeak: -2
    },
    chapters: timeline.entries.map((entry) => ({
      title: entry.scene.eyebrow,
      startSeconds: Number(entry.start.toFixed(3))
    })),
    exports: [{
      id: format.exportId,
      preset: format.preset,
      fileName: format.id === "landscape" ? "edulabsai-ad-4k" : "edulabsai-ad-vertical",
      title: production.title,
      description: production.description,
      tags: ["EdulabsAI", "AI for teachers", "teacher tools", "lesson planning", "education technology"],
      quality: format.id === "landscape" ? 20 : 18,
      burnCaptions: true,
      thumbnailAtSeconds: 25.6
    }],
    licenses: [
      { id: "edulabsai-brand", source: "EdulabsAI authoritative brand directory", title: "EdulabsAI Sprout mark", creator: "EdulabsAI", license: "Owner-provided", attribution: "EdulabsAI", proofUrl: campaign.website },
      { id: "verified-product-stills", source: "Still frames extracted from verified EdulabsAI browser recordings", title: "EdulabsAI product UI", creator: "EdulabsAI", license: "Owner-provided", attribution: "EdulabsAI", proofUrl: "test-output/edulabs-v2/recorded-scenes.json" },
      { id: "fictional-teacher-artwork", source: "OpenAI built-in image generation", title: "Fragmented and connected teacher campaign illustrations", creator: "EdulabsAI with OpenAI image generation", license: "Original generated campaign artwork", attribution: "Fictional generated character; no real identity" },
      { id: "fictional-classroom-artwork", source: "OpenAI built-in image generation", title: "Connected classroom campaign illustration", creator: "EdulabsAI with OpenAI image generation", license: "Original generated campaign artwork", attribution: "Fictional generated people; no learner data" },
      { id: "campaign-motion-design", source: "Original local SVG and PNG composition", title: "Built for Teachers visual system", creator: "EdulabsAI with Agent Demo Studio", license: "Original work", attribution: "EdulabsAI" },
      { id: "connected-light-score", source: "Original local procedural composition", title: "Connected Light", creator: "EdulabsAI with Agent Demo Studio", license: "Original work", attribution: "No samples or third-party cues" },
      { id: "microsoft-edge-neural-speech", source: campaign.voice, title: campaign.voiceName, creator: "Microsoft", license: "Provider terms", attribution: "Synthetic neural narration" }
    ],
    metadata: {
      campaign: campaign.name,
      campaignVersion: 1,
      productionId: production.id,
      format: format.id,
      nativeCanvas: true,
      mobileFirst: format.id === "vertical",
      productionPlan: "../production-plan.json",
      creativeDirection: "../CREATIVE-DIRECTION.md",
      stableBackgrounds: true,
      continuousMotion: false,
      animationPolicy: "One-time entrances and scene transitions only; no shake, bounce, drift, or float loops.",
      originalMusic: true,
      soundEffects: false,
      syntheticVoice: true,
      controlledBetaClaims: ["Snap-and-Mark", "Family Learning Digest"],
      sceneTimeline: timeline.entries.map((entry) => ({ id: entry.scene.id, startSeconds: entry.start, endSeconds: entry.end }))
    }
  };
}

function auditManifest(manifest, format) {
  const checks = {
    correctPreset: manifest.exports.every((item) => item.preset === format.preset),
    nativeCanvasOverlays: manifest.overlays.every((item) => item.width === format.width && item.height === format.height && item.x === .5 && item.y === .5),
    stableBackgrounds: manifest.clips.every((clip) => clip.motion === "none"),
    noLoopingOverlayMotion: manifest.overlays.every((item) => item.animation?.loop === "none"),
    noShakeAnimation: manifest.overlays.every((item) => !["shake", "bounce", "float", "drift"].includes(item.animation?.loop)),
    noOverlayExitMotion: manifest.overlays.every((item) => item.animation?.exit === "none"),
    transitionsAreShort: manifest.clips.every((clip) => (clip.transition?.durationSeconds ?? 0) <= .5),
    noSoundEffects: (manifest.audio?.soundEffects ?? []).length === 0,
    musicDoesNotLoop: manifest.audio?.music?.loop === false,
    narrationPresentEveryScene: manifest.audio?.voices?.length === manifest.clips.length,
    captionsBurnAndSidecar: manifest.captions?.burn === true && manifest.captions?.sidecar === true
  };
  return {
    passed: Object.values(checks).every(Boolean),
    policy: "Native format layouts, stable backgrounds, deliberate one-time motion, smooth original music, and no isolated sound effects.",
    checks
  };
}

async function renderFormat({ production, format, timeline, assets, musicPath, workRoot, manifestsRoot, packageRoot, report }) {
  const formatWork = path.join(workRoot, production.id, format.id);
  const captionsPath = path.join(formatWork, `${production.id}-${format.id}.srt`);
  await writeCaptions(captionsPath, timeline.entries.map((entry) => ({
    start: entry.start + entry.lead,
    end: Math.min(entry.end - .28, entry.start + entry.lead + entry.voice.duration),
    text: entry.scene.narration,
    maxWords: format.id === "vertical" ? 5 : 8
  })), format.id === "vertical" ? 5 : 8);

  const manifest = buildManifest({ production, format, timeline, assets, captionsPath, musicPath, manifestsRoot, workRoot });
  const audit = auditManifest(manifest, format);
  if (!audit.passed) throw new Error(`${format.id} manifest audit failed: ${JSON.stringify(audit.checks)}`);
  const manifestPath = path.join(manifestsRoot, `${production.id}-${format.id}.creator.json`);
  const auditPath = path.join(manifestsRoot, `${production.id}-${format.id}.animation-audit.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  report(`Rendering native ${format.width}x${format.height} ${format.id} master`);
  const renderResult = await renderCreatorManifest(manifestPath, (progress, message) => report(`${format.id} ${Math.round(progress)}% ${message}`));
  const packageDirectory = path.join(packageRoot, format.id);
  const socialPackage = await createSocialPackage(manifest, renderResult, packageDirectory);
  await copyFile(auditPath, path.join(packageDirectory, "ANIMATION-AUDIT.json"));
  return { format, manifest, manifestPath, audit, captionsPath, renderResult, packageDirectory, socialPackage };
}

async function writeCombinedRelease({ production, timeline, results, packageRoot, alignmentSpec }) {
  const release = {
    schemaVersion: 2,
    campaign: campaign.name,
    productionId: production.id,
    title: production.title,
    generatedAt: new Date().toISOString(),
    durationSeconds: Number(timeline.duration.toFixed(3)),
    outputs: results.map((item) => {
      const output = item.renderResult.outputs[0];
      const packaged = item.socialPackage.outputs[0];
      return {
        format: item.format.id,
        preset: output?.preset,
        width: output?.width,
        height: output?.height,
        fps: output?.fps,
        durationSeconds: output?.durationSeconds,
        videoPath: packaged?.video ? path.relative(packageRoot, packaged.video).replaceAll("\\", "/") : undefined,
        captions: packaged?.captions ? path.relative(packageRoot, packaged.captions).replaceAll("\\", "/") : undefined,
        animationAudit: item.audit
      };
    }),
    audio: {
      narrator: campaign.voiceName,
      rate: campaign.voiceRate,
      score: "Connected Light - original smooth cinematic score",
      sampledAudio: false,
      isolatedSoundEffects: false,
      targetLufs: -16,
      truePeakDbtp: -2
    },
    sceneTimeline: timeline.entries.map((entry) => ({
      id: entry.scene.id,
      startSeconds: Number(entry.start.toFixed(3)),
      endSeconds: Number(entry.end.toFixed(3)),
      narration: entry.scene.narration
    })),
    alignmentSpec: path.relative(packageRoot, alignmentSpec).replaceAll("\\", "/"),
    rights: [
      "EdulabsAI owner-provided brand and verified product recordings",
      "Original generated fictional teacher and classroom artwork",
      "Original local motion design and procedural music",
      "Microsoft Edge neural narration under provider terms"
    ],
    reviewRequiredBeforeExternalPublishing: true
  };
  await writeFile(path.join(packageRoot, "release-manifest.json"), `${JSON.stringify(release, null, 2)}\n`, "utf8");
  return release;
}

export async function renderProduction({ production, campaignRoot, sourceRoot, brandRoot, workRoot, assetsRoot, deliverablesRoot, manifestsRoot, report = console.log }) {
  report("Generating measured natural narration scene by scene");
  const speech = await generateSceneSpeech(production, workRoot, campaign.voice, campaign.voiceRate);
  const timeline = computeTimeline(production, speech);
  report(`Timeline set from measured narration: ${timeline.duration.toFixed(1)} seconds across ${timeline.entries.length} scenes`);

  report("Building separate native 4K and mobile-first scene systems");
  const assets = await prepareVisualAssets({ assetsRoot, sourceRoot, brandRoot, production });
  const productionWork = path.join(workRoot, production.id);
  const musicPath = path.join(productionWork, "connected-light.wav");
  report("Composing the original smooth cinematic score");
  await generateCinematicScore(musicPath, timeline.duration);

  await Promise.all([mkdir(manifestsRoot, { recursive: true }), mkdir(deliverablesRoot, { recursive: true })]);
  const packageRoot = path.join(deliverablesRoot, "final");
  await mkdir(packageRoot, { recursive: true });
  const results = [];
  for (const format of [formats.landscape, formats.vertical]) {
    results.push(await renderFormat({ production, format, timeline, assets, musicPath, workRoot, manifestsRoot, packageRoot, report }));
  }
  const release = await writeCombinedRelease({ production, timeline, results, packageRoot, alignmentSpec: assets.alignmentSpec });

  for (const name of [
    "README.md",
    "production-plan.json",
    "CREATIVE-DIRECTION.md",
    "RESOURCE-LIST.md",
    "IMAGE-ASSET-PROVENANCE.md",
    "RESEARCH-NOTES.md",
    "MANUAL-VISUAL-QA.md"
  ]) {
    await copyFile(path.join(campaignRoot, name), path.join(packageRoot, name));
  }
  await copyFile(assets.alignmentSpec, path.join(packageRoot, "ALIGNMENT-SPEC.json"));
  const packageSummary = {
    productionId: production.id,
    title: production.title,
    generatedAt: new Date().toISOString(),
    durationSeconds: timeline.duration,
    outputs: results.map((item) => ({
      format: item.format.id,
      manifest: path.relative(campaignRoot, item.manifestPath).replaceAll("\\", "/"),
      packageDirectory: path.relative(campaignRoot, item.packageDirectory).replaceAll("\\", "/"),
      render: item.renderResult.outputs[0],
      packagedVideo: path.relative(campaignRoot, item.socialPackage.outputs[0].video).replaceAll("\\", "/")
    })),
    release
  };
  await writeFile(path.join(packageRoot, "CAMPAIGN-PACKAGE-SUMMARY.json"), `${JSON.stringify(packageSummary, null, 2)}\n`, "utf8");
  return { timeline, assets, musicPath, results, release, packageRoot };
}
