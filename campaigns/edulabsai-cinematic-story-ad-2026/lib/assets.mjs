import path from "node:path";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import sharp from "sharp";

import { campaign, formats } from "../campaign.mjs";

const FONT = "Segoe UI, Arial, sans-serif";
const FORCE = process.env.REBUILD_VISUALS === "1";

const stillDefinitions = {
  "lesson-brief": { file: "09-teacher-lesson-brief.webm", at: 11.4 },
  "lesson-overview": { file: "10-lesson-overview.webm", at: 0.8 },
  "lesson-plan": { file: "11-lesson-plan-tab.webm", at: 1.2 },
  "lesson-slides": { file: "12-lesson-slides-tab.webm", at: 1.2 },
  "lesson-quiz": { file: "13-lesson-quiz-tab.webm", at: 1.2 },
  "lesson-worksheet": { file: "14-lesson-worksheet-tab.webm", at: 1.2 },
  "export-hub": { file: "16-lesson-export-hub.webm", at: 1.2 },
  "teaching-slides": { file: "18-resource-pptx-original.webm", at: 3.2 },
  "student-dashboard": { file: "33-student-dashboard.webm", at: 1.2 },
  "learning-insights": { file: "27-teacher-learning-insights.webm", at: 1.2 },
  "snap-mark": { file: "28-teacher-snap-mark.webm", at: 1.2 },
  "family-digest": { file: "30-teacher-family-digests.webm", at: 1.2 }
};

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`)));
  });
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgDocument(format, body) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}">${body}</svg>`);
}

async function renderSvg(outputPath, format, body) {
  if (!FORCE && (await exists(outputPath))) return outputPath;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(svgDocument(format, body)).png({ compressionLevel: 9 }).toFile(outputPath);
  return outputPath;
}

function paletteForTone(tone) {
  const p = campaign.palette;
  if (["hero", "problem-dark", "product-dark", "finale"].includes(tone)) {
    return { dark: true, start: p.midnight, end: tone === "finale" ? "#52254D" : p.aubergine, ink: p.cream, muted: "#FFF8EFC4" };
  }
  if (tone === "problem") {
    return { dark: true, start: "#251332", end: "#5A2938", ink: p.cream, muted: "#FFF8EFC4" };
  }
  return { dark: false, start: p.paper, end: "#F6E9DA", ink: p.ink, muted: "#55495FC7" };
}

function baseBackground(scene, format) {
  const p = campaign.palette;
  const tone = paletteForTone(scene.tone);
  const w = format.width;
  const h = format.height;
  const grid = format.id === "landscape" ? 84 : 54;
  const orb1 = format.id === "landscape"
    ? `<circle cx="${w - 120}" cy="-80" r="720" fill="${p.coral}" fill-opacity=".09"/>`
    : `<circle cx="${w - 30}" cy="250" r="420" fill="${p.coral}" fill-opacity=".10"/>`;
  const orb2 = format.id === "landscape"
    ? `<circle cx="180" cy="${h + 40}" r="620" fill="${p.teal}" fill-opacity=".07"/>`
    : `<circle cx="80" cy="${h - 130}" r="420" fill="${p.teal}" fill-opacity=".07"/>`;
  const rail = format.id === "landscape"
    ? `<rect x="192" y="${h - 164}" width="${w - 384}" height="3" rx="2" fill="${tone.ink}" fill-opacity=".10"/>`
    : `<rect x="90" y="${h - 322}" width="820" height="3" rx="2" fill="${tone.ink}" fill-opacity=".10"/>`;
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${tone.start}"/><stop offset="1" stop-color="${tone.end}"/></linearGradient>
    <pattern id="grid" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="3" fill="${tone.ink}" fill-opacity=".035"/></pattern>
    <radialGradient id="warmHalo"><stop stop-color="${p.orange}" stop-opacity=".25"/><stop offset="1" stop-color="${p.orange}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#grid)"/>
  ${orb1}${orb2}
  <circle cx="${format.id === "landscape" ? w * 0.7 : w * 0.5}" cy="${format.id === "landscape" ? h * 0.45 : h * 0.57}" r="${format.id === "landscape" ? 1050 : 650}" fill="url(#warmHalo)" opacity="${scene.tone === "hero" || scene.tone === "finale" ? .62 : .24}"/>
  ${rail}`;
}

function brandBug(format, light) {
  const p = campaign.palette;
  if (format.id === "landscape") {
    return `<g transform="translate(206 116)"><g transform="scale(1.25)"><path d="M31 43 C18 41 12 30 15 18 C27 21 31 32 31 43 Z" fill="${light ? p.cream : p.aubergine}"/><path d="M33 43 C46 41 52 30 49 18 C37 21 33 32 33 43 Z" fill="${light ? p.cream : p.aubergine}"/><path d="M32 40 V53" stroke="${light ? p.cream : p.aubergine}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="56" r="6" fill="${p.coral}"/></g><text x="92" y="59" font-family="${FONT}" font-size="52" font-weight="800" fill="${light ? p.cream : p.aubergine}">Edulabs<tspan fill="${p.gold}">AI</tspan></text></g>`;
  }
  return `<g transform="translate(90 82)"><g transform="scale(.82)"><path d="M31 43 C18 41 12 30 15 18 C27 21 31 32 31 43 Z" fill="${light ? p.cream : p.aubergine}"/><path d="M33 43 C46 41 52 30 49 18 C37 21 33 32 33 43 Z" fill="${light ? p.cream : p.aubergine}"/><path d="M32 40 V53" stroke="${light ? p.cream : p.aubergine}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="56" r="6" fill="${p.coral}"/></g><text x="62" y="39" font-family="${FONT}" font-size="34" font-weight="800" fill="${light ? p.cream : p.aubergine}">Edulabs<tspan fill="${p.gold}">AI</tspan></text></g>`;
}

function sceneCopy(scene, format) {
  const p = campaign.palette;
  const tone = paletteForTone(scene.tone);
  if (scene.id === "brand-arrival") return "";
  if (format.id === "landscape") {
    const x = 220;
    const eyebrowY = 340;
    const headlineY = 490;
    const size = scene.headline.length >= 3 ? 132 : 154;
    const lineHeight = size * 1.03;
    const subY = headlineY + scene.headline.length * lineHeight + 70;
    const headline = scene.headline.map((line, index) => `<text x="${x}" y="${headlineY + index * lineHeight}" font-family="${FONT}" font-size="${size}" font-weight="850" letter-spacing="-4" fill="${tone.ink}">${esc(line)}</text>`).join("");
    return `${brandBug(format, tone.dark)}<rect x="${x}" y="282" width="180" height="10" rx="5" fill="${p.coral}"/><text x="${x}" y="${eyebrowY}" font-family="${FONT}" font-size="37" font-weight="850" letter-spacing="7" fill="${p.coral}">${esc(scene.eyebrow)}</text>${headline}${scene.subhead ? `<text x="${x}" y="${subY}" font-family="${FONT}" font-size="52" font-weight="560" fill="${tone.muted}">${esc(scene.subhead)}</text>` : ""}`;
  }
  const x = 90;
  const eyebrowY = 246;
  const headlineY = 330;
  const size = scene.headline.length >= 3 ? 66 : scene.headline.some((line) => line.length > 21) ? 70 : 76;
  const lineHeight = size * 1.06;
  const subY = headlineY + scene.headline.length * lineHeight + 42;
  const headline = scene.headline.map((line, index) => `<text x="${x}" y="${headlineY + index * lineHeight}" font-family="${FONT}" font-size="${size}" font-weight="850" letter-spacing="-2" fill="${tone.ink}">${esc(line)}</text>`).join("");
  return `${brandBug(format, tone.dark)}<rect x="${x}" y="204" width="120" height="7" rx="4" fill="${p.coral}"/><text x="${x}" y="${eyebrowY}" font-family="${FONT}" font-size="24" font-weight="850" letter-spacing="3.2" fill="${p.coral}">${esc(scene.eyebrow)}</text>${headline}${scene.subhead ? `<text x="${x}" y="${subY}" font-family="${FONT}" font-size="31" font-weight="580" fill="${tone.muted}">${esc(scene.subhead)}</text>` : ""}`;
}

function copyBounds(scene, format) {
  if (scene.id === "brand-arrival") {
    return format.id === "landscape"
      ? { x: 850, y: 1120, width: 2140, height: 720 }
      : { x: 170, y: 930, width: 740, height: 420 };
  }
  return format.id === "landscape"
    ? { x: 206, y: 130, width: 1500, height: 1030 }
    : { x: 90, y: 204, width: 820, height: 390 };
}

function visualRegion(scene, format) {
  if (format.id === "landscape") {
    if (["teacher-fragmented", "fragmentation-cost", "connected-reveal"].includes(scene.id)) return { x: 1900, y: 240, width: 1720, height: 1720 };
    if (scene.id === "brand-arrival") return { x: 1200, y: 250, width: 1440, height: 1580 };
    if (scene.id === "connected-loop-cta") return { x: 1960, y: 260, width: 1660, height: 1660 };
    return { x: 1840, y: 300, width: 1780, height: 1450 };
  }
  if (scene.id === "brand-arrival") return { x: 190, y: 250, width: 700, height: 1150 };
  return { x: 70, y: 610, width: 940, height: 940 };
}

async function extractStill(sourceRoot, outputRoot, id, definition) {
  const outputPath = path.join(outputRoot, "stills", `${id}.png`);
  if (await exists(outputPath)) return outputPath;
  const inputPath = path.join(sourceRoot, definition.file);
  if (!(await exists(inputPath))) throw new Error(`Missing verified product source: ${inputPath}`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(definition.at), "-i", inputPath,
    "-frames:v", "1", "-vf", "scale=1920:1080:flags=lanczos",
    outputPath
  ]);
  return outputPath;
}

async function roundedImage(input, width, height, radius, options = {}) {
  let pipeline = sharp(input);
  if (options.extract) pipeline = pipeline.extract(options.extract);
  const resized = await pipeline.resize(width, height, {
    fit: options.fit ?? "cover",
    position: options.position ?? "centre",
    kernel: sharp.kernel.lanczos3
  }).png().toBuffer();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="white"/></svg>`);
  return sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

function frameSvg(format, frame, light = true, stroke = campaign.palette.coral) {
  const shadow = light ? "#0B0618" : "#2B1944";
  return svgDocument(format, `<defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="${Math.round(frame.radius * .55)}" stdDeviation="${Math.round(frame.radius * .62)}" flood-color="${shadow}" flood-opacity=".32"/></filter></defs><rect x="${frame.x - 10}" y="${frame.y - 10}" width="${frame.width + 20}" height="${frame.height + 20}" rx="${frame.radius + 10}" fill="${light ? "#FFFDF9" : "#FFFFFF"}" filter="url(#shadow)"/><rect x="${frame.x - 4}" y="${frame.y - 4}" width="${frame.width + 8}" height="${frame.height + 8}" rx="${frame.radius + 4}" fill="none" stroke="${stroke}" stroke-opacity=".55" stroke-width="8"/>`);
}

async function writeCompositeLayer(outputPath, format, composites) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({ create: { width: format.width, height: format.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return outputPath;
}

function productCrop(id, format) {
  const vertical = format.id === "vertical";
  const configs = {
    "lesson-brief": vertical
      ? { extract: { left: 560, top: 60, width: 780, height: 1000 }, width: 900, height: 1080 }
      : { extract: { left: 560, top: 60, width: 780, height: 1000 }, width: 1450, height: 1660 },
    "lesson-overview": vertical
      ? { extract: { left: 235, top: 120, width: 1425, height: 590 }, width: 900, height: 520 }
      : { extract: { left: 210, top: 110, width: 1470, height: 650 }, width: 2220, height: 980 },
    "teaching-slides": vertical
      ? { extract: { left: 90, top: 20, width: 1740, height: 1020 }, width: 900, height: 530 }
      : { extract: { left: 40, top: 10, width: 1840, height: 1040 }, width: 2300, height: 1300 },
    "student-dashboard": vertical
      ? { extract: { left: 290, top: 75, width: 1130, height: 905 }, width: 900, height: 720 }
      : { extract: { left: 270, top: 70, width: 1580, height: 900 }, width: 2320, height: 1320 },
    "learning-insights": vertical
      ? { extract: { left: 350, top: 85, width: 1480, height: 585 }, width: 900, height: 510 }
      : { extract: { left: 275, top: 80, width: 1580, height: 820 }, width: 2320, height: 1200 },
    "family-digest": vertical
      ? { extract: { left: 350, top: 85, width: 1480, height: 610 }, width: 900, height: 540 }
      : { extract: { left: 275, top: 80, width: 1580, height: 820 }, width: 2320, height: 1200 }
  };
  return configs[id];
}

async function createProductLayer(outputPath, format, inputPath, id, options = {}) {
  const config = productCrop(id, format);
  if (!config) throw new Error(`No crop configured for product still '${id}'.`);
  const frame = format.id === "landscape"
    ? { x: id === "lesson-brief" ? 2140 : 1380, y: id === "lesson-brief" ? 270 : 760, width: config.width, height: config.height, radius: 54 }
    : { x: 90, y: options.y ?? 650, width: config.width, height: config.height, radius: 34 };
  if (format.id === "landscape" && id !== "lesson-brief") frame.x = 1320;
  if (!FORCE && (await exists(outputPath))) return { path: outputPath, bounds: frame };
  const product = await roundedImage(inputPath, frame.width, frame.height, frame.radius, { extract: config.extract, fit: "fill" });
  const badgeBody = options.badge
    ? svgDocument(format, `<g transform="translate(${frame.x + 32} ${frame.y + 32})"><rect width="${format.id === "landscape" ? 560 : 380}" height="${format.id === "landscape" ? 94 : 70}" rx="${format.id === "landscape" ? 32 : 24}" fill="${campaign.palette.midnight}" fill-opacity=".94"/><circle cx="${format.id === "landscape" ? 48 : 36}" cy="${format.id === "landscape" ? 47 : 35}" r="${format.id === "landscape" ? 15 : 11}" fill="${campaign.palette.coral}"/><text x="${format.id === "landscape" ? 82 : 62}" y="${format.id === "landscape" ? 61 : 45}" font-family="${FONT}" font-size="${format.id === "landscape" ? 38 : 26}" font-weight="800" fill="${campaign.palette.cream}">${esc(options.badge)}</text></g>`)
    : null;
  const composites = [
    { input: frameSvg(format, frame, paletteForTone(options.tone ?? "product-dark").dark), left: 0, top: 0 },
    { input: product, left: frame.x, top: frame.y }
  ];
  if (badgeBody) composites.push({ input: badgeBody, left: 0, top: 0 });
  await writeCompositeLayer(outputPath, format, composites);
  return { path: outputPath, bounds: frame };
}

async function createIllustrationLayer(outputPath, format, inputPath, sceneId, options = {}) {
  const region = visualRegion({ id: sceneId }, format);
  const frame = format.id === "landscape"
    ? { x: region.x, y: region.y, width: region.width, height: region.height, radius: 90 }
    : { x: 40, y: options.y ?? 610, width: 1000, height: options.height ?? 980, radius: 58 };
  if (!FORCE && (await exists(outputPath))) return { path: outputPath, bounds: frame };
  const image = await roundedImage(inputPath, frame.width, frame.height, frame.radius, { fit: "cover", position: options.position ?? "centre" });
  const shadow = frameSvg(format, frame, true, options.stroke ?? campaign.palette.coral);
  await writeCompositeLayer(outputPath, format, [
    { input: shadow, left: 0, top: 0 },
    { input: image, left: frame.x, top: frame.y }
  ]);
  return { path: outputPath, bounds: frame };
}

function openingCopy(format) {
  const p = campaign.palette;
  if (format.id === "landscape") {
    return `<text x="1920" y="1290" text-anchor="middle" font-family="${FONT}" font-size="108" font-weight="900" letter-spacing="18" fill="${p.cream}">EDULABS<tspan fill="${p.gold}">AI</tspan></text><text x="1920" y="1510" text-anchor="middle" font-family="${FONT}" font-size="154" font-weight="850" letter-spacing="-5" fill="${p.cream}">Teaching deserves</text><text x="1920" y="1680" text-anchor="middle" font-family="${FONT}" font-size="154" font-weight="850" letter-spacing="-5" fill="${p.cream}">a better kind of day.</text>`;
  }
  return `<text x="540" y="1000" text-anchor="middle" font-family="${FONT}" font-size="62" font-weight="900" letter-spacing="8" fill="${p.cream}">EDULABS<tspan fill="${p.gold}">AI</tspan></text><text x="540" y="1175" text-anchor="middle" font-family="${FONT}" font-size="78" font-weight="850" letter-spacing="-2" fill="${p.cream}">Teaching deserves</text><text x="540" y="1270" text-anchor="middle" font-family="${FONT}" font-size="78" font-weight="850" letter-spacing="-2" fill="${p.cream}">a better kind of day.</text>`;
}

async function createOpeningLayers(outputDirectory, format, brand) {
  const logoPath = path.join(outputDirectory, "01-logo.png");
  const copyPath = path.join(outputDirectory, "02-copy.png");
  const logoSize = format.id === "landscape" ? 760 : 600;
  const logoX = Math.round((format.width - logoSize) / 2);
  const logoY = format.id === "landscape" ? 250 : 260;
  const frame = { x: logoX, y: logoY, width: logoSize, height: logoSize, radius: format.id === "landscape" ? 180 : 145 };
  if (FORCE || !(await exists(logoPath))) {
    const logo = await roundedImage(brand.profile, logoSize, logoSize, format.id === "landscape" ? 180 : 145, { fit: "fill" });
    await writeCompositeLayer(logoPath, format, [
      { input: frameSvg(format, frame, true, campaign.palette.orange), left: 0, top: 0 },
      { input: logo, left: logoX, top: logoY }
    ]);
  }
  await renderSvg(copyPath, format, openingCopy(format));
  return [
    { path: logoPath, role: "brand", delay: 0.08, enter: "drop", enterDuration: 0.72, intensity: 2.2, bounds: frame, licenseId: "edulabsai-brand" },
    { path: copyPath, role: "copy", delay: 0.82, enter: "rise", enterDuration: 0.58, bounds: copyBounds({ id: "brand-arrival" }, format), licenseId: "campaign-motion-design" }
  ];
}

function toolCardsSvg(format, connected = false) {
  const p = campaign.palette;
  const cards = format.id === "landscape"
    ? [
        { x: 1870, y: 430, w: 760, h: 410, label: "LESSON PLAN", sub: "Objectives and timing", color: p.coral, n: "01" },
        { x: 2720, y: 430, w: 760, h: 410, label: "SLIDES", sub: "Visual teaching story", color: p.lilac, n: "02" },
        { x: 1870, y: 950, w: 760, h: 410, label: "QUIZ", sub: "Questions and checks", color: p.gold, n: "03" },
        { x: 2720, y: 950, w: 760, h: 410, label: "WORKSHEET", sub: "Focused practice", color: p.teal, n: "04" }
      ]
    : [
        { x: 90, y: 650, w: 820, h: 190, label: "LESSON PLAN", sub: "Objectives and timing", color: p.coral, n: "01" },
        { x: 90, y: 875, w: 820, h: 190, label: "SLIDES", sub: "Visual teaching story", color: p.lilac, n: "02" },
        { x: 90, y: 1100, w: 820, h: 190, label: "QUIZ", sub: "Questions and checks", color: p.gold, n: "03" },
        { x: 90, y: 1325, w: 820, h: 190, label: "WORKSHEET", sub: "Focused practice", color: p.teal, n: "04" }
      ];
  const connector = connected
    ? (format.id === "landscape"
      ? `<path d="M1680 895 C1820 895 1760 635 1870 635 M2630 635 H2720 M2250 840 V950 M3100 840 V950" fill="none" stroke="${p.orange}" stroke-width="18" stroke-linecap="round"/><circle cx="1680" cy="895" r="28" fill="${p.orange}"/>`
      : `<path d="M500 600 V1515" fill="none" stroke="${p.orange}" stroke-width="12" stroke-linecap="round" opacity=".65"/>`)
    : (format.id === "landscape"
      ? `<path d="M1660 895 L1795 895 M1808 895 L1870 895 M2630 635 L2670 635 M2698 635 L2720 635 M2250 840 L2250 880 M2250 914 L2250 950 M3100 840 L3100 880 M3100 914 L3100 950" fill="none" stroke="${p.coral}" stroke-width="18" stroke-linecap="round"/><path d="M1786 862 L1817 928 M1817 862 L1786 928" stroke="${p.gold}" stroke-width="12" stroke-linecap="round"/>`
      : `<path d="M500 612 V640 M500 850 V867 M500 1075 V1092 M500 1300 V1317" stroke="${p.coral}" stroke-width="12" stroke-linecap="round"/><path d="M475 848 L525 886 M525 848 L475 886" stroke="${p.gold}" stroke-width="10" stroke-linecap="round"/>`);
  return `<defs><filter id="cardShadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#140B22" flood-opacity=".20"/></filter></defs>${connector}${cards.map((card) => `<g filter="url(#cardShadow)"><rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="${format.id === "landscape" ? 56 : 40}" fill="${p.white}"/><rect x="${card.x}" y="${card.y}" width="${format.id === "landscape" ? 18 : 13}" height="${card.h}" rx="7" fill="${card.color}"/><circle cx="${card.x + (format.id === "landscape" ? 88 : 72)}" cy="${card.y + (format.id === "landscape" ? 94 : 72)}" r="${format.id === "landscape" ? 38 : 30}" fill="${card.color}" fill-opacity=".18"/><circle cx="${card.x + (format.id === "landscape" ? 88 : 72)}" cy="${card.y + (format.id === "landscape" ? 94 : 72)}" r="${format.id === "landscape" ? 15 : 12}" fill="${card.color}"/><text x="${card.x + (format.id === "landscape" ? 154 : 126)}" y="${card.y + (format.id === "landscape" ? 112 : 82)}" font-family="${FONT}" font-size="${format.id === "landscape" ? 52 : 34}" font-weight="850" fill="${p.ink}">${card.label}</text><text x="${card.x + (format.id === "landscape" ? 78 : 66)}" y="${card.y + (format.id === "landscape" ? 235 : 145)}" font-family="${FONT}" font-size="${format.id === "landscape" ? 40 : 26}" font-weight="560" fill="${p.muted}">${card.sub}</text><text x="${card.x + card.w - (format.id === "landscape" ? 98 : 72)}" y="${card.y + (format.id === "landscape" ? 340 : 152)}" text-anchor="end" font-family="${FONT}" font-size="${format.id === "landscape" ? 72 : 42}" font-weight="850" fill="${card.color}" fill-opacity=".72">${card.n}</text></g>`).join("")}`;
}

function evidenceCardsSvg(format) {
  const p = campaign.palette;
  if (format.id === "landscape") {
    return `<g transform="translate(1450 1600)">${["REVIEW EVIDENCE", "SPOT THE GAP", "SHAPE NEXT MOVE"].map((label, index) => `<g transform="translate(${index * 700} 0)"><rect width="630" height="170" rx="48" fill="${p.white}"/><circle cx="70" cy="85" r="32" fill="${[p.coral, p.gold, p.teal][index]}"/><text x="126" y="101" font-family="${FONT}" font-size="36" font-weight="820" fill="${p.ink}">${label}</text></g>${index < 2 ? `<path d="M${630 + index * 700} 85 H${700 + index * 700}" stroke="${p.orange}" stroke-width="12" stroke-linecap="round"/>` : ""}`).join("")}</g>`;
  }
  return `<g transform="translate(90 1220)">${["REVIEW", "UNDERSTAND", "RESPOND"].map((label, index) => `<g transform="translate(${index * 285} 0)"><rect width="250" height="150" rx="38" fill="${p.white}"/><circle cx="125" cy="48" r="24" fill="${[p.coral, p.gold, p.teal][index]}"/><text x="125" y="112" text-anchor="middle" font-family="${FONT}" font-size="23" font-weight="820" fill="${p.ink}">${label}</text></g>${index < 2 ? `<path d="M${250 + index * 285} 75 H${285 + index * 285}" stroke="${p.orange}" stroke-width="8" stroke-linecap="round"/>` : ""}`).join("")}</g>`;
}

function exportBadgesSvg(format) {
  const p = campaign.palette;
  const badges = [
    { label: "PPTX", color: p.coral },
    { label: "PDF", color: p.gold },
    { label: "EDITABLE", color: p.teal }
  ];
  if (format.id === "landscape") {
    return `<g transform="translate(1600 1680)">${badges.map((badge, index) => `<g transform="translate(${index * 590} 0)"><rect width="520" height="156" rx="50" fill="${p.white}"/><circle cx="74" cy="78" r="28" fill="${badge.color}"/><text x="126" y="96" font-family="${FONT}" font-size="46" font-weight="850" fill="${p.ink}">${badge.label}</text></g>`).join("")}</g>`;
  }
  return `<g transform="translate(90 1230)">${badges.map((badge, index) => `<g transform="translate(${index * 285} 0)"><rect width="250" height="132" rx="38" fill="${p.white}"/><circle cx="48" cy="66" r="20" fill="${badge.color}"/><text x="84" y="80" font-family="${FONT}" font-size="25" font-weight="850" fill="${p.ink}">${badge.label}</text></g>`).join("")}</g>`;
}

function familyFlowSvg(format) {
  const p = campaign.palette;
  const labels = ["OPT IN", "TEACHER REVIEW", "PRIVATE EMAIL"];
  if (format.id === "landscape") {
    return `<g transform="translate(1450 1600)">${labels.map((label, index) => `<g transform="translate(${index * 700} 0)"><rect width="630" height="170" rx="48" fill="${p.white}"/><circle cx="76" cy="85" r="34" fill="${[p.lilac, p.coral, p.teal][index]}"/><text x="136" y="101" font-family="${FONT}" font-size="37" font-weight="830" fill="${p.ink}">${label}</text></g>${index < 2 ? `<path d="M${630 + index * 700} 85 H${700 + index * 700}" stroke="${p.orange}" stroke-width="12"/>` : ""}`).join("")}</g>`;
  }
  return `<g transform="translate(90 1240)">${labels.map((label, index) => `<g transform="translate(${index * 285} 0)"><rect width="250" height="150" rx="38" fill="${p.white}"/><circle cx="125" cy="50" r="24" fill="${[p.lilac, p.coral, p.teal][index]}"/><text x="125" y="112" text-anchor="middle" font-family="${FONT}" font-size="${index === 1 ? 19 : 22}" font-weight="830" fill="${p.ink}">${label}</text></g>`).join("")}</g>`;
}

function brokenLoopSvg(format) {
  const p = campaign.palette;
  if (format.id === "landscape") {
    return `<g transform="translate(1870 390)"><path d="M230 760 C230 310 590 70 1020 210 C1370 325 1480 700 1320 1010 C1160 1320 760 1420 450 1230" fill="none" stroke="${p.cream}" stroke-opacity=".46" stroke-width="22" stroke-linecap="round"/><path d="M410 1260 L475 1200 M420 1190 L485 1260" stroke="${p.gold}" stroke-width="24" stroke-linecap="round"/><g transform="translate(80 650)"><circle r="96" fill="${p.coral}"/><text y="18" text-anchor="middle" font-family="${FONT}" font-size="58" font-weight="900" fill="${p.white}">PLAN</text></g><g transform="translate(1040 145)"><circle r="96" fill="${p.lilac}"/><text y="18" text-anchor="middle" font-family="${FONT}" font-size="52" font-weight="900" fill="${p.white}">TEACH</text></g><g transform="translate(1370 1040)"><circle r="96" fill="${p.teal}"/><text y="18" text-anchor="middle" font-family="${FONT}" font-size="52" font-weight="900" fill="${p.white}">CHECK</text></g></g>`;
  }
  return `<g transform="translate(90 690)"><path d="M450 20 C740 20 900 250 820 520 C750 760 500 860 275 760 C70 670 -20 430 75 235" fill="none" stroke="${p.cream}" stroke-opacity=".45" stroke-width="14" stroke-linecap="round"/><path d="M40 250 L100 200 M40 200 L100 250" stroke="${p.gold}" stroke-width="18" stroke-linecap="round"/><g transform="translate(70 225)"><circle r="70" fill="${p.coral}"/><text y="10" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="900" fill="${p.white}">PLAN</text></g><g transform="translate(720 90)"><circle r="70" fill="${p.lilac}"/><text y="10" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="900" fill="${p.white}">TEACH</text></g><g transform="translate(760 680)"><circle r="70" fill="${p.teal}"/><text y="10" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="900" fill="${p.white}">CHECK</text></g></g>`;
}

function connectedRailSvg(format) {
  const p = campaign.palette;
  const labels = ["PLAN", "BUILD", "TEACH", "CHECK", "CONNECT"];
  if (format.id === "landscape") {
    return `<g transform="translate(250 1540)"><path d="M120 90 H2600" stroke="${p.orange}" stroke-width="20" stroke-linecap="round"/>${labels.map((label, index) => `<g transform="translate(${120 + index * 620} 90)"><circle r="44" fill="${p.orange}"/><circle r="19" fill="${p.cream}"/><text x="0" y="112" text-anchor="middle" font-family="${FONT}" font-size="38" font-weight="850" fill="${p.cream}">${label}</text></g>`).join("")}</g>`;
  }
  return `<g transform="translate(95 1390)"><path d="M50 50 H810" stroke="${p.orange}" stroke-width="12" stroke-linecap="round"/>${labels.map((label, index) => `<g transform="translate(${50 + index * 190} 50)"><circle r="25" fill="${p.orange}"/><circle r="10" fill="${p.cream}"/><text x="0" y="65" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="850" fill="${p.cream}">${label}</text></g>`).join("")}</g>`;
}

async function createSceneLayers({ scene, format, outputDirectory, stills, illustrations, brand }) {
  const layers = [];
  const layer = (name) => path.join(outputDirectory, name);
  if (scene.id === "brand-arrival") return createOpeningLayers(outputDirectory, format, brand);

  if (scene.id === "teacher-fragmented") {
    const visual = await createIllustrationLayer(layer("01-teacher.png"), format, illustrations.fragmented, scene.id, { position: "centre" });
    layers.push({ ...visual, role: "illustration", delay: .18, enter: format.id === "landscape" ? "slide-right" : "rise", enterDuration: .62, licenseId: "fictional-teacher-artwork" });
  } else if (scene.id === "tool-by-tool") {
    const visualPath = layer("01-tool-cards.png");
    await renderSvg(visualPath, format, toolCardsSvg(format, false));
    layers.push({ path: visualPath, role: "drawing", delay: .2, enter: "pop", enterDuration: .58, bounds: visualRegion(scene, format), licenseId: "campaign-motion-design" });
  } else if (scene.id === "fragmentation-cost") {
    const visual = await createIllustrationLayer(layer("01-teacher.png"), format, illustrations.fragmented, scene.id, { position: "centre", stroke: campaign.palette.gold });
    const fracturePath = layer("02-broken-loop.png");
    await renderSvg(fracturePath, format, brokenLoopSvg(format));
    layers.push({ ...visual, role: "illustration", delay: .1, enter: "fade", enterDuration: .5, licenseId: "fictional-teacher-artwork" });
    layers.push({ path: fracturePath, role: "vfx", delay: .9, enter: "pop", enterDuration: .46, bounds: visualRegion(scene, format), licenseId: "campaign-motion-design" });
  } else if (scene.id === "connected-reveal") {
    const visual = await createIllustrationLayer(layer("01-teacher.png"), format, illustrations.connected, scene.id, { position: "centre", stroke: campaign.palette.orange });
    const railPath = layer("02-connected-rail.png");
    await renderSvg(railPath, format, connectedRailSvg(format));
    layers.push({ ...visual, role: "illustration", delay: .14, enter: "slide-right", enterDuration: .62, licenseId: "fictional-teacher-artwork" });
    layers.push({ path: railPath, role: "vfx", delay: .92, enter: "rise", enterDuration: .48, bounds: format.id === "landscape" ? { x: 220, y: 1500, width: 2900, height: 260 } : { x: 90, y: 1380, width: 900, height: 160 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "classroom-context") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { badge: "REAL CLASSROOM CONTEXT", tone: scene.tone, y: 650 });
    const chipsPath = layer("02-context-chips.png");
    const chips = format.id === "landscape"
      ? `<g transform="translate(220 1270)">${["CURRICULUM", "CLASS", "TOPIC", "LANGUAGE", "SOURCES"].map((label, index) => `<g transform="translate(${(index % 2) * 600} ${Math.floor(index / 2) * 150})"><rect width="540" height="116" rx="38" fill="${campaign.palette.cream}"/><circle cx="58" cy="58" r="20" fill="${[campaign.palette.coral, campaign.palette.gold, campaign.palette.teal, campaign.palette.lilac, campaign.palette.orange][index]}"/><text x="102" y="73" font-family="${FONT}" font-size="38" font-weight="820" fill="${campaign.palette.ink}">${label}</text></g>`).join("")}</g>`
      : `<g transform="translate(90 1405)">${["CURRICULUM", "CLASS", "TOPIC", "LANGUAGE", "SOURCES"].map((label, index) => `<g transform="translate(${(index % 3) * 285} ${Math.floor(index / 3) * 90})"><rect width="250" height="76" rx="26" fill="${campaign.palette.cream}"/><circle cx="36" cy="38" r="13" fill="${[campaign.palette.coral, campaign.palette.gold, campaign.palette.teal, campaign.palette.lilac, campaign.palette.orange][index]}"/><text x="62" y="47" font-family="${FONT}" font-size="${label === "CURRICULUM" ? 19 : 21}" font-weight="820" fill="${campaign.palette.ink}">${label}</text></g>`).join("")}</g>`;
    await renderSvg(chipsPath, format, chips);
    layers.push({ ...visual, role: "product", delay: .18, enter: "slide-right", enterDuration: .62, licenseId: "verified-product-stills" });
    layers.push({ path: chipsPath, role: "drawing", delay: 1.05, enter: "rise", enterDuration: .48, bounds: format.id === "landscape" ? { x: 220, y: 1270, width: 1140, height: 420 } : { x: 90, y: 1405, width: 820, height: 166 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "four-resources") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { badge: "ONE CONNECTED WORKSPACE", tone: scene.tone, y: 640 });
    const cardsPath = layer("02-resource-cards.png");
    await renderSvg(cardsPath, format, toolCardsSvg(format, true));
    layers.push({ ...visual, role: "product", delay: .15, enter: "fade", enterDuration: .5, licenseId: "verified-product-stills" });
    layers.push({ path: cardsPath, role: "drawing", delay: 1.05, enter: "rise", enterDuration: .58, bounds: visualRegion(scene, format), licenseId: "campaign-motion-design" });
  } else if (scene.id === "teach-and-export") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { badge: "EDITABLE TEACHING VISUALS", tone: scene.tone, y: 660 });
    const badgePath = layer("02-export-badges.png");
    await renderSvg(badgePath, format, exportBadgesSvg(format));
    layers.push({ ...visual, role: "product", delay: .16, enter: "slide-right", enterDuration: .62, licenseId: "verified-product-stills" });
    layers.push({ path: badgePath, role: "drawing", delay: 1.08, enter: "rise", enterDuration: .5, bounds: format.id === "landscape" ? { x: 1600, y: 1680, width: 1700, height: 160 } : { x: 90, y: 1230, width: 820, height: 132 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "students-connected") {
    const human = await createIllustrationLayer(layer("01-classroom.png"), format, illustrations.classroom, scene.id, { y: 600, height: 1030, position: "centre", stroke: campaign.palette.teal });
    const visual = await createProductLayer(layer("02-product.png"), format, stills[scene.still], scene.still, { badge: "STUDENT LEARNING SPACE", tone: scene.tone, y: 770 });
    layers.push({ ...human, role: "illustration", delay: .12, enter: "fade", enterDuration: .52, licenseId: "fictional-classroom-artwork" });
    layers.push({ ...visual, role: "product", delay: 1.2, enter: format.id === "landscape" ? "slide-right" : "rise", enterDuration: .58, licenseId: "verified-product-stills" });
  } else if (scene.id === "evidence-next-step") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { badge: "NOTHING ASSIGNS WITHOUT YOU", tone: scene.tone, y: 650 });
    const flowPath = layer("02-evidence-flow.png");
    await renderSvg(flowPath, format, evidenceCardsSvg(format));
    layers.push({ ...visual, role: "product", delay: .15, enter: "fade", enterDuration: .52, licenseId: "verified-product-stills" });
    layers.push({ path: flowPath, role: "drawing", delay: 1.12, enter: "rise", enterDuration: .52, bounds: format.id === "landscape" ? { x: 1450, y: 1600, width: 2050, height: 170 } : { x: 90, y: 1220, width: 820, height: 150 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "families-connected") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { badge: "CONTROLLED BETA - TEACHER APPROVED", tone: scene.tone, y: 650 });
    const flowPath = layer("02-family-flow.png");
    await renderSvg(flowPath, format, familyFlowSvg(format));
    layers.push({ ...visual, role: "product", delay: .15, enter: "slide-right", enterDuration: .6, licenseId: "verified-product-stills" });
    layers.push({ path: flowPath, role: "drawing", delay: 1.08, enter: "rise", enterDuration: .5, bounds: format.id === "landscape" ? { x: 1450, y: 1600, width: 2050, height: 170 } : { x: 90, y: 1240, width: 820, height: 150 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "connected-loop-cta") {
    const human = await createIllustrationLayer(layer("01-classroom.png"), format, illustrations.classroom, scene.id, { y: 600, height: 1030, position: "centre", stroke: campaign.palette.orange });
    const ctaPath = layer("02-cta.png");
    const cta = format.id === "landscape"
      ? `<g transform="translate(220 1250)"><rect width="1380" height="250" rx="72" fill="${campaign.palette.coral}"/><text x="690" y="105" text-anchor="middle" font-family="${FONT}" font-size="48" font-weight="850" fill="${campaign.palette.white}">CREATE YOUR FIRST LESSON FREE</text><text x="690" y="180" text-anchor="middle" font-family="${FONT}" font-size="42" font-weight="730" fill="${campaign.palette.white}">edulabsai.com</text></g>`
      : `<g transform="translate(90 1340)"><rect width="820" height="190" rx="58" fill="${campaign.palette.coral}"/><text x="410" y="78" text-anchor="middle" font-family="${FONT}" font-size="31" font-weight="850" fill="${campaign.palette.white}">CREATE YOUR FIRST LESSON FREE</text><text x="410" y="136" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="760" fill="${campaign.palette.white}">edulabsai.com</text></g>`;
    await renderSvg(ctaPath, format, cta);
    layers.push({ ...human, role: "illustration", delay: .1, enter: "fade", enterDuration: .54, licenseId: "fictional-classroom-artwork" });
    layers.push({ path: ctaPath, role: "cta", delay: .92, enter: "rise", enterDuration: .54, bounds: format.id === "landscape" ? { x: 220, y: 1250, width: 1380, height: 250 } : { x: 90, y: 1340, width: 820, height: 190 }, licenseId: "campaign-motion-design" });
  }

  const copyPath = layer(`${String(layers.length + 1).padStart(2, "0")}-copy.png`);
  await renderSvg(copyPath, format, sceneCopy(scene, format));
  layers.push({ path: copyPath, role: "copy", delay: .32, enter: "rise", enterDuration: .5, bounds: copyBounds(scene, format), licenseId: "campaign-motion-design" });
  return layers;
}

export async function prepareVisualAssets({ assetsRoot, sourceRoot, brandRoot, production }) {
  const brandDirectory = path.join(assetsRoot, "brand");
  const scenesDirectory = path.join(assetsRoot, "scenes");
  const illustrationsDirectory = path.join(assetsRoot, "illustrations");
  await Promise.all([brandDirectory, scenesDirectory, illustrationsDirectory, path.join(assetsRoot, "stills")].map((directory) => mkdir(directory, { recursive: true })));

  const brand = {
    profile: path.join(brandDirectory, "edulabsai-profile-coral.png"),
    mark: path.join(brandDirectory, "edulabsai-mark.svg")
  };
  await copyFile(path.join(brandRoot, "edulabsai-profile-coral.png"), brand.profile);
  await copyFile(path.join(brandRoot, "edulabsai-mark.svg"), brand.mark);

  const illustrations = {
    fragmented: path.join(illustrationsDirectory, "teacher-fragmented.png"),
    connected: path.join(illustrationsDirectory, "teacher-connected.png"),
    classroom: path.join(illustrationsDirectory, "classroom-connected.png")
  };
  for (const [id, filePath] of Object.entries(illustrations)) {
    if (!(await exists(filePath))) throw new Error(`Missing generated illustration '${id}': ${filePath}`);
  }

  const stills = {};
  for (const [id, definition] of Object.entries(stillDefinitions)) {
    stills[id] = await extractStill(sourceRoot, assetsRoot, id, definition);
  }

  const scenes = {};
  const alignment = { schemaVersion: 1, formats: {} };
  for (const format of Object.values(formats)) {
    scenes[format.id] = {};
    alignment.formats[format.id] = {
      width: format.width,
      height: format.height,
      safeZone: format.safeZone,
      scenes: {}
    };
    for (const scene of production.scenes) {
      const directory = path.join(scenesDirectory, format.id, scene.id);
      await mkdir(directory, { recursive: true });
      const base = path.join(directory, "00-base.png");
      await renderSvg(base, format, baseBackground(scene, format));
      const layers = await createSceneLayers({ scene, format, outputDirectory: directory, stills, illustrations, brand });
      scenes[format.id][scene.id] = { base, layers };
      alignment.formats[format.id].scenes[scene.id] = {
        copy: copyBounds(scene, format),
        visual: visualRegion(scene, format),
        layers: layers.map((item) => ({ role: item.role, bounds: item.bounds }))
      };
    }
  }
  const alignmentSpec = path.join(assetsRoot, "ALIGNMENT-SPEC.json");
  await writeFile(alignmentSpec, `${JSON.stringify(alignment, null, 2)}\n`, "utf8");
  return { brand, illustrations, stills, scenes, alignmentSpec };
}
