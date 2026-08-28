import path from "node:path";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import sharp from "sharp";

import { campaign, formats } from "../campaign.mjs";

const FONT = "Segoe UI, Arial, sans-serif";
const FORCE = process.env.REBUILD_VISUALS === "1";

// One optical grid drives every scene. Nothing important is positioned with
// one-off coordinates outside these columns and bands.
const DESIGN_GRIDS = {
  landscape: {
    safe: { x: 240, y: 128, width: 3360, height: 1840 },
    copy: { x: 240, y: 128, width: 1160, height: 1020 },
    visual: { x: 1600, y: 300, width: 2000, height: 1340 },
    support: { x: 1600, y: 1680, width: 2000, height: 180 },
    captionTop: 1900
  },
  vertical: {
    safe: { x: 90, y: 180, width: 820, height: 1410 },
    copy: { x: 90, y: 180, width: 820, height: 450 },
    visual: { x: 90, y: 640, width: 820, height: 720 },
    support: { x: 90, y: 1390, width: 820, height: 140 },
    captionTop: 1535
  }
};

function designGrid(format) {
  return DESIGN_GRIDS[format.id];
}

function fittedHeadlineSize(lines, maxWidth, preferred, minimum) {
  const longest = Math.max(...lines.map((line) => line.length));
  return Math.max(minimum, Math.min(preferred, Math.floor(maxWidth / Math.max(1, longest * .56))));
}

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
  const layout = designGrid(format);
  const rail = "";
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
    return `<g transform="translate(240 128)"><g transform="scale(1.16)"><path d="M31 43 C18 41 12 30 15 18 C27 21 31 32 31 43 Z" fill="${light ? p.cream : p.aubergine}"/><path d="M33 43 C46 41 52 30 49 18 C37 21 33 32 33 43 Z" fill="${light ? p.cream : p.aubergine}"/><path d="M32 40 V53" stroke="${light ? p.cream : p.aubergine}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="56" r="6" fill="${p.coral}"/></g><text x="86" y="56" font-family="${FONT}" font-size="48" font-weight="800" fill="${light ? p.cream : p.aubergine}">Edulabs<tspan fill="${p.gold}">AI</tspan></text></g>`;
  }
  return `<g transform="translate(90 184)"><g transform="scale(.78)"><path d="M31 43 C18 41 12 30 15 18 C27 21 31 32 31 43 Z" fill="${light ? p.cream : p.aubergine}"/><path d="M33 43 C46 41 52 30 49 18 C37 21 33 32 33 43 Z" fill="${light ? p.cream : p.aubergine}"/><path d="M32 40 V53" stroke="${light ? p.cream : p.aubergine}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="56" r="6" fill="${p.coral}"/></g><text x="60" y="38" font-family="${FONT}" font-size="32" font-weight="800" fill="${light ? p.cream : p.aubergine}">Edulabs<tspan fill="${p.gold}">AI</tspan></text></g>`;
}

function sceneCopy(scene, format) {
  const p = campaign.palette;
  const tone = paletteForTone(scene.tone);
  if (scene.id === "brand-arrival") return "";
  const layout = designGrid(format);
  if (format.id === "landscape") {
    const x = layout.copy.x;
    const eyebrowY = 326;
    const headlineY = 470;
    const size = fittedHeadlineSize(scene.headline, layout.copy.width, scene.headline.length >= 3 ? 112 : 128, 88);
    const lineHeight = size * 1.06;
    const subY = headlineY + scene.headline.length * lineHeight + 62;
    const headline = scene.headline.map((line, index) => `<text x="${x}" y="${headlineY + index * lineHeight}" font-family="${FONT}" font-size="${size}" font-weight="850" letter-spacing="-4" fill="${tone.ink}">${esc(line)}</text>`).join("");
    return `${brandBug(format, tone.dark)}<rect x="${x}" y="272" width="144" height="9" rx="5" fill="${p.coral}"/><text x="${x}" y="${eyebrowY}" font-family="${FONT}" font-size="32" font-weight="850" letter-spacing="5.2" fill="${p.coral}">${esc(scene.eyebrow)}</text>${headline}${scene.subhead ? `<text x="${x}" y="${subY}" font-family="${FONT}" font-size="36" font-weight="560" fill="${tone.muted}">${esc(scene.subhead)}</text>` : ""}`;
  }
  const x = layout.copy.x;
  const eyebrowY = 300;
  const headlineY = 378;
  const size = fittedHeadlineSize(scene.headline, layout.copy.width, scene.headline.length >= 3 ? 62 : 68, 50);
  const lineHeight = size * 1.06;
  const subY = headlineY + scene.headline.length * lineHeight + 34;
  const headline = scene.headline.map((line, index) => `<text x="${x}" y="${headlineY + index * lineHeight}" font-family="${FONT}" font-size="${size}" font-weight="850" letter-spacing="-2" fill="${tone.ink}">${esc(line)}</text>`).join("");
  return `${brandBug(format, tone.dark)}<rect x="${x}" y="256" width="112" height="7" rx="4" fill="${p.coral}"/><text x="${x}" y="${eyebrowY}" font-family="${FONT}" font-size="22" font-weight="850" letter-spacing="2.8" fill="${p.coral}">${esc(scene.eyebrow)}</text>${headline}${scene.subhead ? `<text x="${x}" y="${subY}" font-family="${FONT}" font-size="27" font-weight="580" fill="${tone.muted}">${esc(scene.subhead)}</text>` : ""}`;
}

function copyBounds(scene, format) {
  if (scene.id === "brand-arrival") {
    return format.id === "landscape"
      ? { x: 760, y: 1160, width: 2320, height: 560 }
      : { x: 90, y: 1000, width: 820, height: 340 };
  }
  return { ...designGrid(format).copy };
}

function visualRegion(scene, format) {
  const layout = designGrid(format);
  if (format.id === "landscape") {
    if (scene.id === "brand-arrival") return { x: 1470, y: 170, width: 900, height: 900 };
    return { ...layout.visual };
  }
  if (scene.id === "brand-arrival") return { x: 180, y: 210, width: 720, height: 720 };
  return { ...layout.visual };
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
      ? { extract: { left: 560, top: 80, width: 780, height: 820 }, width: 820, height: 800 }
      : { extract: { left: 560, top: 60, width: 780, height: 1000 }, width: 1160, height: 1480 },
    "lesson-overview": vertical
      ? { extract: { left: 235, top: 120, width: 1425, height: 590 }, width: 820, height: 370 }
      : { extract: { left: 210, top: 110, width: 1470, height: 650 }, width: 2000, height: 880 },
    "teaching-slides": vertical
      ? { extract: { left: 90, top: 20, width: 1740, height: 1020 }, width: 820, height: 480 }
      : { extract: { left: 40, top: 10, width: 1840, height: 1040 }, width: 2000, height: 1120 },
    "student-dashboard": vertical
      ? { extract: { left: 290, top: 75, width: 1130, height: 905 }, width: 820, height: 640 }
      : { extract: { left: 270, top: 70, width: 1580, height: 900 }, width: 2000, height: 1120 },
    "learning-insights": vertical
      ? { extract: { left: 350, top: 85, width: 1480, height: 585 }, width: 820, height: 420 }
      : { extract: { left: 275, top: 80, width: 1580, height: 820 }, width: 2000, height: 1040 },
    "family-digest": vertical
      ? { extract: { left: 350, top: 85, width: 1480, height: 610 }, width: 820, height: 420 }
      : { extract: { left: 275, top: 80, width: 1580, height: 820 }, width: 2000, height: 1040 }
  };
  return configs[id];
}

async function createProductLayer(outputPath, format, inputPath, id, options = {}) {
  const config = productCrop(id, format);
  if (!config) throw new Error(`No crop configured for product still '${id}'.`);
  const frame = format.id === "landscape"
    ? { x: id === "lesson-brief" ? 2320 : 1600, y: id === "lesson-brief" ? 300 : (options.y ?? 520), width: config.width, height: config.height, radius: 50 }
    : { x: 90, y: options.y ?? 640, width: config.width, height: config.height, radius: 32 };
  if (!FORCE && (await exists(outputPath))) return { path: outputPath, bounds: frame };
  const product = await roundedImage(inputPath, frame.width, frame.height, frame.radius, { extract: config.extract, fit: "fill" });
  const composites = [
    { input: frameSvg(format, frame, paletteForTone(options.tone ?? "product-dark").dark), left: 0, top: 0 },
    { input: product, left: frame.x, top: frame.y }
  ];
  await writeCompositeLayer(outputPath, format, composites);
  return { path: outputPath, bounds: frame };
}

async function createIllustrationLayer(outputPath, format, inputPath, sceneId, options = {}) {
  const region = visualRegion({ id: sceneId }, format);
  const frame = format.id === "landscape"
    ? { x: region.x + 120, y: region.y + 20, width: region.width - 240, height: options.height ?? 1420, radius: 82 }
    : { x: 90, y: options.y ?? 640, width: 820, height: options.height ?? 720, radius: 48 };
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
    return `<text x="1920" y="1240" text-anchor="middle" font-family="${FONT}" font-size="116" font-weight="900" letter-spacing="19" fill="${p.cream}">EDULABS<tspan fill="${p.gold}">AI</tspan></text><text x="1920" y="1445" text-anchor="middle" font-family="${FONT}" font-size="132" font-weight="850" letter-spacing="-4" fill="${p.cream}">Teaching deserves a better kind of day.</text>`;
  }
  return `<text x="540" y="1040" text-anchor="middle" font-family="${FONT}" font-size="68" font-weight="900" letter-spacing="9" fill="${p.cream}">EDULABS<tspan fill="${p.gold}">AI</tspan></text><text x="540" y="1180" text-anchor="middle" font-family="${FONT}" font-size="68" font-weight="850" letter-spacing="-2" fill="${p.cream}">Teaching deserves</text><text x="540" y="1265" text-anchor="middle" font-family="${FONT}" font-size="68" font-weight="850" letter-spacing="-2" fill="${p.cream}">a better kind of day.</text>`;
}

async function createOpeningLayers(outputDirectory, format, brand) {
  const logoPath = path.join(outputDirectory, "01-logo.png");
  const copyPath = path.join(outputDirectory, "02-copy.png");
  const logoSize = format.id === "landscape" ? 900 : 720;
  const logoX = Math.round((format.width - logoSize) / 2);
  const logoY = format.id === "landscape" ? 170 : 210;
  const frame = { x: logoX, y: logoY, width: logoSize, height: logoSize, radius: format.id === "landscape" ? 205 : 165 };
  if (FORCE || !(await exists(logoPath))) {
    const logo = await roundedImage(brand.profile, logoSize, logoSize, format.id === "landscape" ? 205 : 165, { fit: "fill" });
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
  const definitions = [
    { label: "LESSON PLAN", sub: "Objectives and timing", color: p.coral, n: "01" },
    { label: "SLIDES", sub: "Visual teaching story", color: p.lilac, n: "02" },
    { label: "QUIZ", sub: "Questions and checks", color: p.gold, n: "03" },
    { label: "WORKSHEET", sub: "Focused practice", color: p.teal, n: "04" }
  ];
  const landscape = format.id === "landscape";
  const cards = definitions.map((card, index) => {
    if (landscape && connected) return { ...card, x: 1600 + index * 500, y: 1530, w: 470, h: 180 };
    if (landscape) return { ...card, x: 1600 + (index % 2) * 1020, y: 450 + Math.floor(index / 2) * 520, w: 980, h: 420 };
    if (connected) return { ...card, x: 90 + (index % 2) * 420, y: 1060 + Math.floor(index / 2) * 155, w: 400, h: 135 };
    return { ...card, x: 90, y: 650 + index * 175, w: 820, h: 150 };
  });
  const connector = connected
    ? (landscape
      ? `<path d="M1635 1620 H3565" stroke="${p.orange}" stroke-width="12" stroke-linecap="round" opacity=".5"/>`
      : `<path d="M290 1150 H710 M290 1310 H710 M500 1150 V1310" stroke="${p.orange}" stroke-width="9" stroke-linecap="round" opacity=".5"/>`)
    : (landscape
      ? `<path d="M2580 660 H2620 M2090 870 V970 M3110 870 V970" stroke="${p.coral}" stroke-width="14" stroke-linecap="round" stroke-dasharray="20 24"/><path d="M2578 625 L2622 695 M2622 625 L2578 695" stroke="${p.gold}" stroke-width="10" stroke-linecap="round"/>`
      : `<path d="M500 800 V825 M500 975 V1000 M500 1150 V1175" stroke="${p.coral}" stroke-width="10" stroke-linecap="round" stroke-dasharray="12 12"/><path d="M478 970 L522 1005 M522 970 L478 1005" stroke="${p.gold}" stroke-width="9" stroke-linecap="round"/>`);
  const cardMarkup = cards.map((card) => {
    const compact = connected;
    const bar = landscape ? (compact ? 12 : 18) : 12;
    const radius = landscape ? (compact ? 38 : 54) : (compact ? 32 : 38);
    const dotX = card.x + (compact ? (landscape ? 48 : 42) : (landscape ? 86 : 62));
    const dotY = card.y + (compact ? (landscape ? 52 : 45) : (landscape ? 94 : 54));
    const labelX = card.x + (compact ? (landscape ? 82 : 72) : (landscape ? 150 : 108));
    const labelY = card.y + (compact ? (landscape ? 64 : 55) : (landscape ? 112 : 65));
    const labelSize = landscape ? (compact ? 28 : 50) : (compact ? 23 : 31);
    const subX = card.x + (compact ? (landscape ? 40 : 34) : (landscape ? 78 : 54));
    const subY = card.y + (compact ? (landscape ? 126 : 105) : (landscape ? 238 : 116));
    const subSize = landscape ? (compact ? 21 : 38) : (compact ? 17 : 23);
    const numberSize = landscape ? (compact ? 32 : 66) : (compact ? 27 : 34);
    const numberY = card.y + (compact ? (landscape ? 62 : 52) : (landscape ? 342 : 62));
    return `<g filter="url(#cardShadow)"><rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="${radius}" fill="${p.white}"/><rect x="${card.x}" y="${card.y}" width="${bar}" height="${card.h}" rx="6" fill="${card.color}"/><circle cx="${dotX}" cy="${dotY}" r="${compact ? (landscape ? 18 : 15) : (landscape ? 36 : 25)}" fill="${card.color}" fill-opacity=".18"/><circle cx="${dotX}" cy="${dotY}" r="${compact ? (landscape ? 8 : 7) : (landscape ? 14 : 10)}" fill="${card.color}"/><text x="${labelX}" y="${labelY}" font-family="${FONT}" font-size="${labelSize}" font-weight="850" fill="${p.ink}">${card.label}</text><text x="${subX}" y="${subY}" font-family="${FONT}" font-size="${subSize}" font-weight="560" fill="${p.muted}">${card.sub}</text><text x="${card.x + card.w - (compact ? 28 : (landscape ? 78 : 36))}" y="${numberY}" text-anchor="end" font-family="${FONT}" font-size="${numberSize}" font-weight="850" fill="${card.color}" fill-opacity=".72">${card.n}</text></g>`;
  }).join("");
  return `<defs><filter id="cardShadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="${connected ? 12 : 18}" stdDeviation="${connected ? 16 : 22}" flood-color="#140B22" flood-opacity=".20"/></filter></defs>${connector}${cardMarkup}`;
}

function evidenceCardsSvg(format) {
  const p = campaign.palette;
  if (format.id === "landscape") {
    return `<g transform="translate(1600 1680)">${["REVIEW EVIDENCE", "SPOT THE GAP", "SHAPE NEXT MOVE"].map((label, index) => `<g transform="translate(${index * 690} 0)"><rect width="620" height="170" rx="46" fill="${p.white}"/><circle cx="66" cy="85" r="30" fill="${[p.coral, p.gold, p.teal][index]}"/><text x="120" y="99" font-family="${FONT}" font-size="34" font-weight="820" fill="${p.ink}">${label}</text></g>${index < 2 ? `<path d="M${620 + index * 690} 85 H${690 + index * 690}" stroke="${p.orange}" stroke-width="11" stroke-linecap="round"/>` : ""}`).join("")}</g>`;
  }
  return `<g transform="translate(90 1160)">${["REVIEW", "UNDERSTAND", "RESPOND"].map((label, index) => `<g transform="translate(${index * 285} 0)"><rect width="250" height="140" rx="36" fill="${p.white}"/><circle cx="125" cy="43" r="21" fill="${[p.coral, p.gold, p.teal][index]}"/><text x="125" y="104" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="820" fill="${p.ink}">${label}</text></g>${index < 2 ? `<path d="M${250 + index * 285} 70 H${285 + index * 285}" stroke="${p.orange}" stroke-width="8" stroke-linecap="round"/>` : ""}`).join("")}</g>`;
}

function exportBadgesSvg(format) {
  const p = campaign.palette;
  const badges = [
    { label: "PPTX", color: p.coral },
    { label: "PDF", color: p.gold },
    { label: "EDITABLE", color: p.teal }
  ];
  if (format.id === "landscape") {
    return `<g transform="translate(1600 1680)">${badges.map((badge, index) => `<g transform="translate(${index * 690} 0)"><rect width="620" height="156" rx="48" fill="${p.white}"/><circle cx="74" cy="78" r="27" fill="${badge.color}"/><text x="126" y="95" font-family="${FONT}" font-size="44" font-weight="850" fill="${p.ink}">${badge.label}</text></g>`).join("")}</g>`;
  }
  return `<g transform="translate(90 1180)">${badges.map((badge, index) => `<g transform="translate(${index * 285} 0)"><rect width="250" height="124" rx="36" fill="${p.white}"/><circle cx="47" cy="62" r="19" fill="${badge.color}"/><text x="82" y="76" font-family="${FONT}" font-size="24" font-weight="850" fill="${p.ink}">${badge.label}</text></g>`).join("")}</g>`;
}

function familyFlowSvg(format) {
  const p = campaign.palette;
  const labels = ["OPT IN", "TEACHER REVIEW", "PRIVATE EMAIL"];
  if (format.id === "landscape") {
    return `<g transform="translate(1600 1680)">${labels.map((label, index) => `<g transform="translate(${index * 690} 0)"><rect width="620" height="170" rx="46" fill="${p.white}"/><circle cx="70" cy="85" r="31" fill="${[p.lilac, p.coral, p.teal][index]}"/><text x="128" y="100" font-family="${FONT}" font-size="35" font-weight="830" fill="${p.ink}">${label}</text></g>${index < 2 ? `<path d="M${620 + index * 690} 85 H${690 + index * 690}" stroke="${p.orange}" stroke-width="11"/>` : ""}`).join("")}</g>`;
  }
  return `<g transform="translate(90 1160)">${labels.map((label, index) => `<g transform="translate(${index * 285} 0)"><rect width="250" height="140" rx="36" fill="${p.white}"/><circle cx="125" cy="44" r="21" fill="${[p.lilac, p.coral, p.teal][index]}"/><text x="125" y="104" text-anchor="middle" font-family="${FONT}" font-size="${index === 1 ? 18 : 21}" font-weight="830" fill="${p.ink}">${label}</text></g>`).join("")}</g>`;
}

function brokenLoopSvg(format) {
  const p = campaign.palette;
  if (format.id === "landscape") {
    return `<g transform="translate(1600 310)"><path d="M280 760 C280 330 650 80 1080 210 C1450 325 1580 700 1410 1030 C1240 1360 810 1450 490 1240" fill="none" stroke="${p.cream}" stroke-opacity=".46" stroke-width="22" stroke-linecap="round"/><path d="M450 1270 L515 1210 M460 1200 L525 1270" stroke="${p.gold}" stroke-width="24" stroke-linecap="round"/><g transform="translate(130 660)"><circle r="94" fill="${p.coral}"/><text y="18" text-anchor="middle" font-family="${FONT}" font-size="56" font-weight="900" fill="${p.white}">PLAN</text></g><g transform="translate(1100 145)"><circle r="94" fill="${p.lilac}"/><text y="18" text-anchor="middle" font-family="${FONT}" font-size="50" font-weight="900" fill="${p.white}">TEACH</text></g><g transform="translate(1460 1050)"><circle r="94" fill="${p.teal}"/><text y="18" text-anchor="middle" font-family="${FONT}" font-size="50" font-weight="900" fill="${p.white}">CHECK</text></g></g>`;
  }
  return `<g transform="translate(90 650)"><path d="M410 30 C690 30 850 245 775 490 C705 710 480 800 270 720 C80 645 0 420 85 220" fill="none" stroke="${p.cream}" stroke-opacity=".45" stroke-width="14" stroke-linecap="round"/><path d="M50 238 L105 190 M50 190 L105 238" stroke="${p.gold}" stroke-width="18" stroke-linecap="round"/><g transform="translate(82 215)"><circle r="65" fill="${p.coral}"/><text y="10" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="900" fill="${p.white}">PLAN</text></g><g transform="translate(680 92)"><circle r="65" fill="${p.lilac}"/><text y="10" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="900" fill="${p.white}">TEACH</text></g><g transform="translate(710 650)"><circle r="65" fill="${p.teal}"/><text y="10" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="900" fill="${p.white}">CHECK</text></g></g>`;
}

function connectedRailSvg(format) {
  const p = campaign.palette;
  const labels = ["PLAN", "BUILD", "TEACH", "CHECK", "CONNECT"];
  if (format.id === "landscape") {
    return `<g transform="translate(240 1680)"><path d="M40 70 H3320" stroke="${p.orange}" stroke-width="18" stroke-linecap="round"/>${labels.map((label, index) => `<g transform="translate(${40 + index * 820} 70)"><circle r="40" fill="${p.orange}"/><circle r="17" fill="${p.cream}"/><text x="0" y="105" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="850" fill="${p.cream}">${label}</text></g>`).join("")}</g>`;
  }
  return `<g transform="translate(90 1390)"><path d="M30 45 H790" stroke="${p.orange}" stroke-width="11" stroke-linecap="round"/>${labels.map((label, index) => `<g transform="translate(${30 + index * 190} 45)"><circle r="23" fill="${p.orange}"/><circle r="9" fill="${p.cream}"/><text x="0" y="64" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="850" fill="${p.cream}">${label}</text></g>`).join("")}</g>`;
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
    layers.push({ path: railPath, role: "vfx", delay: .92, enter: "rise", enterDuration: .48, bounds: format.id === "landscape" ? { x: 240, y: 1680, width: 3360, height: 180 } : { x: 90, y: 1390, width: 820, height: 110 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "classroom-context") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { tone: scene.tone, y: 640 });
    layers.push({ ...visual, role: "product", delay: .18, enter: "slide-right", enterDuration: .62, licenseId: "verified-product-stills" });
    if (format.id === "landscape") {
      const chipsPath = layer("02-context-chips.png");
      const chips = `<g transform="translate(240 1180)">${["CURRICULUM", "CLASS", "TOPIC", "LANGUAGE", "SOURCES"].map((label, index) => `<g transform="translate(${(index % 2) * 600} ${Math.floor(index / 2) * 142})"><rect width="560" height="108" rx="36" fill="${campaign.palette.cream}"/><circle cx="54" cy="54" r="18" fill="${[campaign.palette.coral, campaign.palette.gold, campaign.palette.teal, campaign.palette.lilac, campaign.palette.orange][index]}"/><text x="96" y="68" font-family="${FONT}" font-size="35" font-weight="820" fill="${campaign.palette.ink}">${label}</text></g>`).join("")}</g>`;
      await renderSvg(chipsPath, format, chips);
      layers.push({ path: chipsPath, role: "drawing", delay: 1.05, enter: "rise", enterDuration: .48, bounds: { x: 240, y: 1180, width: 1160, height: 392 }, licenseId: "campaign-motion-design" });
    }
  } else if (scene.id === "four-resources") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { tone: scene.tone, y: 640 });
    const cardsPath = layer("02-resource-cards.png");
    await renderSvg(cardsPath, format, toolCardsSvg(format, true));
    layers.push({ ...visual, role: "product", delay: .15, enter: "fade", enterDuration: .5, licenseId: "verified-product-stills" });
    layers.push({ path: cardsPath, role: "drawing", delay: 1.05, enter: "rise", enterDuration: .58, bounds: format.id === "landscape" ? { x: 1600, y: 1530, width: 1970, height: 180 } : { x: 90, y: 1060, width: 820, height: 290 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "teach-and-export") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { tone: scene.tone, y: format.id === "landscape" ? 480 : 640 });
    const badgePath = layer("02-export-badges.png");
    await renderSvg(badgePath, format, exportBadgesSvg(format));
    layers.push({ ...visual, role: "product", delay: .16, enter: "slide-right", enterDuration: .62, licenseId: "verified-product-stills" });
    layers.push({ path: badgePath, role: "drawing", delay: 1.08, enter: "rise", enterDuration: .5, bounds: format.id === "landscape" ? { x: 1600, y: 1680, width: 2000, height: 156 } : { x: 90, y: 1180, width: 820, height: 124 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "students-connected") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { tone: scene.tone, y: format.id === "landscape" ? 480 : 660 });
    layers.push({ ...visual, role: "product", delay: .2, enter: format.id === "landscape" ? "slide-right" : "rise", enterDuration: .58, licenseId: "verified-product-stills" });
  } else if (scene.id === "evidence-next-step") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { tone: scene.tone, y: format.id === "landscape" ? 520 : 640 });
    const flowPath = layer("02-evidence-flow.png");
    await renderSvg(flowPath, format, evidenceCardsSvg(format));
    layers.push({ ...visual, role: "product", delay: .15, enter: "fade", enterDuration: .52, licenseId: "verified-product-stills" });
    layers.push({ path: flowPath, role: "drawing", delay: 1.12, enter: "rise", enterDuration: .52, bounds: format.id === "landscape" ? { x: 1600, y: 1680, width: 2000, height: 170 } : { x: 90, y: 1160, width: 820, height: 140 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "families-connected") {
    const visual = await createProductLayer(layer("01-product.png"), format, stills[scene.still], scene.still, { tone: scene.tone, y: format.id === "landscape" ? 520 : 640 });
    const flowPath = layer("02-family-flow.png");
    await renderSvg(flowPath, format, familyFlowSvg(format));
    layers.push({ ...visual, role: "product", delay: .15, enter: "slide-right", enterDuration: .6, licenseId: "verified-product-stills" });
    layers.push({ path: flowPath, role: "drawing", delay: 1.08, enter: "rise", enterDuration: .5, bounds: format.id === "landscape" ? { x: 1600, y: 1680, width: 2000, height: 170 } : { x: 90, y: 1160, width: 820, height: 140 }, licenseId: "campaign-motion-design" });
  } else if (scene.id === "connected-loop-cta") {
    const human = await createIllustrationLayer(layer("01-classroom.png"), format, illustrations.classroom, scene.id, { y: 640, height: format.id === "landscape" ? 1220 : 700, position: "centre", stroke: campaign.palette.orange });
    const ctaPath = layer("02-cta.png");
    const cta = format.id === "landscape"
      ? `<g transform="translate(240 1200)"><rect width="1160" height="230" rx="66" fill="${campaign.palette.coral}"/><text x="580" y="96" text-anchor="middle" font-family="${FONT}" font-size="42" font-weight="850" fill="${campaign.palette.white}">CREATE YOUR FIRST LESSON FREE</text><text x="580" y="170" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="730" fill="${campaign.palette.white}">edulabsai.com</text></g>`
      : `<g transform="translate(90 1230)"><rect width="820" height="180" rx="54" fill="${campaign.palette.coral}"/><text x="410" y="75" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="850" fill="${campaign.palette.white}">CREATE YOUR FIRST LESSON FREE</text><text x="410" y="132" text-anchor="middle" font-family="${FONT}" font-size="29" font-weight="760" fill="${campaign.palette.white}">edulabsai.com</text></g>`;
    await renderSvg(ctaPath, format, cta);
    layers.push({ ...human, role: "illustration", delay: .1, enter: "fade", enterDuration: .54, licenseId: "fictional-classroom-artwork" });
    layers.push({ path: ctaPath, role: "cta", delay: .92, enter: "rise", enterDuration: .54, bounds: format.id === "landscape" ? { x: 240, y: 1200, width: 1160, height: 230 } : { x: 90, y: 1230, width: 820, height: 180 }, licenseId: "campaign-motion-design" });
  }

  const copyPath = layer(`${String(layers.length + 1).padStart(2, "0")}-copy.png`);
  await renderSvg(copyPath, format, sceneCopy(scene, format));
  layers.push({ path: copyPath, role: "copy", delay: .32, enter: "rise", enterDuration: .5, bounds: copyBounds(scene, format), licenseId: "campaign-motion-design" });
  return layers;
}

export async function prepareVisualAssets({ assetsRoot, sourceRoot, brandRoot, production }) {
  const brandDirectory = path.join(assetsRoot, "brand");
  const scenesDirectory = path.join(assetsRoot, "scenes-aligned");
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
