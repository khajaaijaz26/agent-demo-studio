import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import sharp from "sharp";

import { campaign } from "../campaign.mjs";

const WIDTH = 1920;
const HEIGHT = 1080;
const FONT = "Segoe UI, Arial, sans-serif";

const stillDefinitions = {
  "lesson-brief": { file: "09-teacher-lesson-brief.webm", at: 11.4 },
  "lesson-overview": { file: "10-lesson-overview.webm", at: 0.8 },
  "teaching-slides": { file: "18-resource-pptx-original.webm", at: 3.2 },
  "student-dashboard": { file: "33-student-dashboard.webm", at: 1.2 },
  "snap-mark": { file: "28-teacher-snap-mark.webm", at: 1.2 },
  "learning-insights": { file: "27-teacher-learning-insights.webm", at: 1.2 },
  "family-digest": { file: "30-teacher-family-digests.webm", at: 1.2 },
};

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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

function logo(light = false) {
  const ink = light ? campaign.palette.cream : campaign.palette.aubergine;
  const ai = light ? campaign.palette.gold : campaign.palette.gold;
  return `<g transform="translate(96 58)">
    <g transform="translate(0 2) scale(.74)">
      <path d="M31 43 C18 41 12 30 15 18 C27 21 31 32 31 43 Z" fill="${ink}"/>
      <path d="M33 43 C46 41 52 30 49 18 C37 21 33 32 33 43 Z" fill="${ink}"/>
      <path d="M32 40 V53" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="32" cy="56" r="6" fill="${campaign.palette.coral}"/>
    </g>
    <text x="58" y="42" font-family="${FONT}" font-size="38" font-weight="760" fill="${ink}">Edulabs<tspan fill="${ai}">AI</tspan></text>
  </g>`;
}

function background(theme) {
  const p = campaign.palette;
  if (theme === "dark") {
    return `<defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.midnight}"/><stop offset="1" stop-color="${p.aubergine}"/></linearGradient>
      <pattern id="dots" width="42" height="42" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="${p.cream}" fill-opacity=".035"/></pattern>
    </defs><rect width="1920" height="1080" fill="url(#bg)"/><rect width="1920" height="1080" fill="url(#dots)"/>
    <circle cx="1780" cy="-40" r="380" fill="${p.coral}" fill-opacity=".07"/><circle cx="120" cy="1040" r="330" fill="${p.teal}" fill-opacity=".055"/>`;
  }
  if (theme === "finale") {
    return `<defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.midnight}"/><stop offset=".58" stop-color="${p.aubergine}"/><stop offset="1" stop-color="#512349"/></linearGradient>
      <radialGradient id="halo"><stop stop-color="${p.coral}" stop-opacity=".28"/><stop offset="1" stop-color="${p.coral}" stop-opacity="0"/></radialGradient>
    </defs><rect width="1920" height="1080" fill="url(#bg)"/><circle cx="960" cy="500" r="660" fill="url(#halo)"/>`;
  }
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.paper}"/><stop offset="1" stop-color="#F7EDDF"/></linearGradient>
    <pattern id="dots" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="${p.aubergine}" fill-opacity=".035"/></pattern>
  </defs><rect width="1920" height="1080" fill="url(#bg)"/><rect width="1920" height="1080" fill="url(#dots)"/>
  <circle cx="1780" cy="-40" r="390" fill="${p.gold}" fill-opacity=".11"/><circle cx="90" cy="1040" r="320" fill="${p.coral}" fill-opacity=".06"/>`;
}

function progressRail(scene, light) {
  const ids = ["real-classroom-context", "four-aligned-resources", "teach-and-practice", "evidence-to-reteach", "teacher-approved-connection"];
  const labels = ["PLAN", "BUILD", "TEACH", "CHECK", "CONNECT"];
  const active = ids.indexOf(scene.id);
  if (active < 0) return "";
  const base = light ? campaign.palette.cream : campaign.palette.aubergine;
  return `<g transform="translate(1340 76)">
    ${labels.map((label, index) => `<g transform="translate(${index * 104} 0)"><circle cx="7" cy="7" r="7" fill="${index === active ? campaign.palette.coral : base}" fill-opacity="${index === active ? 1 : .18}"/><text x="20" y="13" font-family="${FONT}" font-size="15" font-weight="760" letter-spacing="1.1" fill="${base}" fill-opacity="${index === active ? .96 : .45}">${label}</text></g>`).join("")}
  </g>`;
}

function baseLayout(scene) {
  const light = scene.theme === "dark" || scene.theme === "finale";
  const ink = light ? campaign.palette.cream : campaign.palette.ink;
  const sub = light ? "#FFF8EFC4" : "#4B3F58C7";
  let x = 96;
  let eyebrowY = 178;
  let headlineY = 248;
  let size = 76;
  let lineHeight = 82;
  let subheadY = headlineY + scene.headline.length * lineHeight + 34;
  let anchor = "start";

  if (scene.id === "one-clear-idea") {
    x = 960; eyebrowY = 154; headlineY = 682; size = 76; lineHeight = 84; subheadY = 862; anchor = "middle";
  } else if (["four-aligned-resources", "teach-and-practice", "evidence-to-reteach"].includes(scene.id)) {
    eyebrowY = 154; headlineY = 208; size = 61; lineHeight = 67; subheadY = scene.id === "four-aligned-resources" ? 320 : 345;
  } else if (scene.id === "start-free") {
    x = 960; eyebrowY = 228; headlineY = 330; size = 82; lineHeight = 93; subheadY = 570; anchor = "middle";
  }

  const title = scene.headline.map((line, index) => `<tspan x="${x}" y="${headlineY + index * lineHeight}">${esc(line)}</tspan>`).join("");
  const primaryCopy = scene.id === "one-clear-idea" ? "" : `
    <text text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="820" letter-spacing="-2.2" fill="${ink}">${title}</text>
    <text x="${x}" y="${subheadY}" text-anchor="${anchor}" font-family="${FONT}" font-size="27" font-weight="520" fill="${sub}">${esc(scene.subhead)}</text>`;
  return `${background(scene.theme)}${scene.id === "one-clear-idea" ? "" : logo(light)}${progressRail(scene, light)}
    <text x="${x}" y="${eyebrowY}" text-anchor="${anchor}" font-family="${FONT}" font-size="20" font-weight="800" letter-spacing="4.2" fill="${campaign.palette.coral}">${esc(scene.eyebrow)}</text>
    ${primaryCopy}
    <rect x="96" y="916" width="1728" height="2" rx="1" fill="${light ? campaign.palette.cream : campaign.palette.aubergine}" fill-opacity=".09"/>`;
}

async function renderSvg(svgBody, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${svgBody}</svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outputPath);
  return outputPath;
}

async function extractStill(sourceRoot, outputDirectory, id, definition) {
  const outputPath = path.join(outputDirectory, "stills", `${id}.png`);
  if (await exists(outputPath)) return outputPath;
  const inputPath = path.join(sourceRoot, definition.file);
  if (!(await exists(inputPath))) throw new Error(`Missing verified product source: ${inputPath}`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(definition.at), "-i", inputPath,
    "-frames:v", "1", "-vf", "scale=1920:1080:flags=lanczos",
    outputPath,
  ]);
  return outputPath;
}

function screenShadowSvg(cards, light) {
  const stroke = light ? campaign.palette.cream : campaign.palette.aubergine;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#0D0718" flood-opacity=".28"/></filter></defs>
    ${cards.map((card) => `<rect x="${card.x - 6}" y="${card.y - 6}" width="${card.width + 12}" height="${card.height + 12}" rx="${card.radius + 6}" fill="${light ? "#FFF8EF" : "#FFFFFF"}" filter="url(#shadow)"/><rect x="${card.x - 4}" y="${card.y - 4}" width="${card.width + 8}" height="${card.height + 8}" rx="${card.radius + 4}" fill="none" stroke="${stroke}" stroke-opacity="${light ? .62 : .25}" stroke-width="8"/>`).join("")}
  </svg>`);
}

async function roundedScreenshot(inputPath, width, height, radius) {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="white"/></svg>`);
  return sharp(inputPath)
    .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function createScreenLayer(outputPath, cards, stills, light) {
  const composites = [{ input: screenShadowSvg(cards, light), left: 0, top: 0 }];
  for (const card of cards) {
    composites.push({
      input: await roundedScreenshot(stills[card.still], card.width, card.height, card.radius),
      left: card.x,
      top: card.y,
    });
  }
  const border = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${cards.map((card) => `<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="${card.radius}" fill="none" stroke="${light ? campaign.palette.cream : campaign.palette.white}" stroke-opacity=".74" stroke-width="4"/>`).join("")}</svg>`);
  composites.push({ input: border, left: 0, top: 0 });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return outputPath;
}

function pill(x, y, width, label, color, light = true) {
  const fill = light ? campaign.palette.cream : campaign.palette.white;
  return `<g transform="translate(${x} ${y})"><rect width="${width}" height="72" rx="24" fill="${fill}" fill-opacity=".98"/><circle cx="36" cy="36" r="12" fill="${color}"/><text x="62" y="45" font-family="${FONT}" font-size="24" font-weight="760" fill="${campaign.palette.aubergine}">${esc(label)}</text></g>`;
}

function artBody(type, stage = 1) {
  const p = campaign.palette;
  if (type === "brand-drop") {
    if (stage === 1) return `<defs><linearGradient id="orange" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.coral}"/><stop offset="1" stop-color="${p.orange}"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#090411" flood-opacity=".36"/></filter></defs><g transform="translate(820 220)" filter="url(#s)"><rect width="280" height="280" rx="78" fill="url(#orange)"/><g transform="translate(76 62) scale(2)"><path d="M31 43 C18 41 12 30 15 18 C27 21 31 32 31 43 Z" fill="${p.cream}"/><path d="M33 43 C46 41 52 30 49 18 C37 21 33 32 33 43 Z" fill="${p.cream}"/><path d="M32 40 V53" stroke="${p.cream}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="56" r="6" fill="#FF8A62"/></g></g>`;
    return `<text x="960" y="596" text-anchor="middle" font-family="${FONT}" font-size="58" font-weight="820" letter-spacing="7" fill="${p.cream}">EDULABS<tspan fill="${p.gold}">AI</tspan></text><text x="960" y="682" text-anchor="middle" font-family="${FONT}" font-size="76" font-weight="820" letter-spacing="-2.2" fill="${p.cream}">Every next step</text><text x="960" y="766" text-anchor="middle" font-family="${FONT}" font-size="76" font-weight="820" letter-spacing="-2.2" fill="${p.cream}">connected.</text><text x="960" y="862" text-anchor="middle" font-family="${FONT}" font-size="27" font-weight="520" fill="#FFF8EFC4">A calmer way to plan, teach, check, and respond.</text>`;
  }
  if (type === "opening-loop") {
    if (stage === 1) return `<defs><filter id="s"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#170C29" flood-opacity=".19"/></filter></defs>
      <g filter="url(#s)"><circle cx="1380" cy="535" r="148" fill="${p.aubergine}"/><circle cx="1380" cy="535" r="118" fill="none" stroke="${p.cream}" stroke-opacity=".18" stroke-width="3"/><text x="1380" y="520" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="760" fill="${p.gold}">ONE</text><text x="1380" y="563" text-anchor="middle" font-family="${FONT}" font-size="31" font-weight="820" fill="${p.cream}">LESSON</text></g>
      <path d="M1266 438 C1170 330 1125 340 1080 350 M1495 438 C1585 330 1645 343 1700 360 M1264 635 C1164 726 1118 728 1060 714 M1496 635 C1592 728 1646 730 1712 700" fill="none" stroke="${p.coral}" stroke-width="5" stroke-linecap="round" stroke-dasharray="10 12"/>`;
    return `${pill(930,265,300,"LESSON PLAN",p.coral)}${pill(1490,275,280,"SLIDES",p.gold)}${pill(920,690,270,"QUIZ",p.teal)}${pill(1490,680,320,"WORKSHEET",p.lilac)}`;
  }
  if (type === "context-pills") return `${pill(96,600,310,"CURRICULUM",p.coral)}${pill(96,692,250,"CLASS",p.gold)}${pill(96,784,270,"TOPIC",p.teal)}<path d="M430 636 H610 M366 728 H610 M386 820 H610" stroke="${p.cream}" stroke-opacity=".24" stroke-width="4" stroke-linecap="round"/><circle cx="632" cy="728" r="66" fill="${p.coral}"/><path d="M602 728 L623 749 L664 706" fill="none" stroke="white" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (type === "resource-cards") {
    return `<defs><filter id="s"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#170C29" flood-opacity=".14"/></filter></defs>
      ${[[1160,388,"01","LESSON PLAN",p.coral],[1510,388,"02","SLIDES",p.gold],[1160,610,"03","QUIZ",p.teal],[1510,610,"04","WORKSHEET",p.lilac]].map(([x,y,num,label,color]) => `<g transform="translate(${x} ${y})" filter="url(#s)"><rect width="300" height="176" rx="28" fill="${p.white}"/><circle cx="48" cy="48" r="24" fill="${color}"/><text x="48" y="57" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="800" fill="white">${num}</text><text x="30" y="116" font-family="${FONT}" font-size="24" font-weight="800" fill="${p.aubergine}">${label}</text><rect x="30" y="136" width="190" height="8" rx="4" fill="${p.aubergine}" fill-opacity=".1"/></g>`).join("")}
      <path d="M1118 520 H1146 M1468 520 H1496 M1118 742 H1146 M1468 742 H1496" stroke="${p.coral}" stroke-width="5" stroke-linecap="round"/>`;
  }
  if (type === "teach-practice") return `<g>${pill(154,355,330,"VISUAL TEACHING",p.gold,false)}${pill(1080,355,410,"FOCUSED STUDENT WORK",p.teal,false)}<path d="M922 630 H994" stroke="${p.coral}" stroke-width="8" stroke-linecap="round"/><path d="M980 610 L1002 630 L980 650" fill="none" stroke="${p.coral}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  if (type === "evidence-arrow") return `<g>${pill(150,355,320,"REVIEW EVIDENCE",p.coral,false)}${pill(1080,355,350,"FOCUSED RETEACH",p.lilac,false)}<path d="M920 630 H995" stroke="${p.coral}" stroke-width="8" stroke-linecap="round"/><path d="M981 610 L1003 630 L981 650" fill="none" stroke="${p.coral}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><rect x="735" y="810" width="450" height="62" rx="22" fill="${p.aubergine}"/><circle cx="777" cy="841" r="12" fill="${p.teal}"/><text x="806" y="850" font-family="${FONT}" font-size="23" font-weight="700" fill="${p.cream}">Teacher reviewed · teacher controlled</text></g>`;
  if (type === "approved-signal") return `<defs><filter id="s"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity=".25"/></filter></defs><g transform="translate(150 600)" filter="url(#s)"><circle cx="180" cy="120" r="120" fill="${p.cream}"/><path d="M180 38 L260 71 V133 C260 195 225 237 180 258 C135 237 100 195 100 133 V71 Z" fill="${p.coral}"/><path d="M139 136 L169 166 L225 108" fill="none" stroke="white" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><text x="340" y="102" font-family="${FONT}" font-size="26" font-weight="780" fill="${p.gold}">TEACHER APPROVED</text><text x="340" y="150" font-family="${FONT}" font-size="24" font-weight="560" fill="${p.cream}" fill-opacity=".8">Clear context.</text><text x="340" y="184" font-family="${FONT}" font-size="24" font-weight="560" fill="${p.cream}" fill-opacity=".8">Shared carefully.</text></g>`;
  if (type === "finale-loop") {
    if (stage === 1) return `<g fill="none" stroke-linecap="round"><ellipse cx="960" cy="500" rx="610" ry="330" stroke="${p.coral}" stroke-opacity=".34" stroke-width="5"/><ellipse cx="960" cy="500" rx="440" ry="420" stroke="${p.teal}" stroke-opacity=".2" stroke-width="4" transform="rotate(18 960 500)"/><circle cx="376" cy="438" r="12" fill="${p.gold}" stroke="none"/><circle cx="1486" cy="322" r="11" fill="${p.teal}" stroke="none"/><circle cx="1320" cy="800" r="10" fill="${p.coral}" stroke="none"/></g>`;
    return `<g><rect x="610" y="690" width="700" height="106" rx="34" fill="${p.coral}"/><text x="960" y="756" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="820" letter-spacing="1.2" fill="white">START FREE DURING BETA →</text><text x="960" y="852" text-anchor="middle" font-family="${FONT}" font-size="29" font-weight="650" fill="${p.cream}">edulabsai.com</text></g>`;
  }
  return "";
}

function cardsForScene(scene) {
  if (scene.id === "real-classroom-context") return [{ still: scene.still, x: 760, y: 260, width: 1060, height: 596, radius: 28 }];
  if (scene.id === "four-aligned-resources") return [{ still: scene.still, x: 96, y: 350, width: 920, height: 518, radius: 26 }];
  if (scene.id === "teacher-approved-connection") return [{ still: scene.still, x: 780, y: 255, width: 1044, height: 587, radius: 28 }];
  if (scene.secondaryStill) return [
    { still: scene.still, x: 96, y: 410, width: 804, height: 452, radius: 24 },
    { still: scene.secondaryStill, x: 1020, y: 410, width: 804, height: 452, radius: 24 },
  ];
  return [];
}

export async function prepareVisualAssets(outputDirectory, sourceRoot, production) {
  await mkdir(outputDirectory, { recursive: true });
  const stills = {};
  for (const [id, definition] of Object.entries(stillDefinitions)) {
    stills[id] = await extractStill(sourceRoot, outputDirectory, id, definition);
  }

  const scenes = {};
  for (const scene of production.scenes) {
    const sceneDirectory = path.join(outputDirectory, "scenes", scene.id);
    const base = await renderSvg(baseLayout(scene), path.join(sceneDirectory, "00-base.png"));
    const layers = [];
    const cards = cardsForScene(scene);
    if (cards.length) {
      layers.push(await createScreenLayer(path.join(sceneDirectory, "01-product.png"), cards, stills, scene.theme === "dark" || scene.theme === "finale"));
      if (scene.art) layers.push(await renderSvg(artBody(scene.art, 2), path.join(sceneDirectory, "02-art.png")));
    } else if (scene.art) {
      layers.push(await renderSvg(artBody(scene.art, 1), path.join(sceneDirectory, "01-art.png")));
      layers.push(await renderSvg(artBody(scene.art, 2), path.join(sceneDirectory, "02-detail.png")));
    }
    scenes[scene.id] = { base, layers };
  }

  const alignmentSpec = {
    canvas: { width: WIDTH, height: HEIGHT, fps: production.fps },
    safeMarginPixels: 96,
    contentBottomPixels: 900,
    overlayPlacement: { x: 0.5, y: 0.5, width: WIDTH, height: HEIGHT },
    allowedOverlayEntrance: "fade",
    allowedOverlayLoop: "none",
    allowedTransitions: ["cut"],
    positionalMotionException: "opening orange logo drop only",
    stillFrames: Object.fromEntries(Object.entries(stillDefinitions).map(([id, item]) => [id, { source: item.file, timestampSeconds: item.at }])),
  };
  await writeFile(path.join(outputDirectory, "ALIGNMENT-SPEC.json"), `${JSON.stringify(alignmentSpec, null, 2)}\n`, "utf8");
  return { scenes, stills, alignmentSpec };
}
