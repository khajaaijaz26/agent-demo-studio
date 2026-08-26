import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

import { campaign } from "../campaign.mjs";

const FONT = "Segoe UI, Arial, sans-serif";

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function renderSvg(svg, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

function dimensions(format) {
  return format === "vertical" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

function seedDots(width, height, variant) {
  const dots = [];
  let state = 0x51f15e + variant * 17;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0xffff_ffff;
  };
  for (let index = 0; index < 34; index += 1) {
    const x = Math.round(random() * width);
    const y = Math.round(random() * height);
    const radius = 1.4 + random() * 4.2;
    const color = index % 4 === 0 ? campaign.palette.coral : index % 3 === 0 ? campaign.palette.gold : campaign.palette.lilac;
    dots.push(`<circle cx="${x}" cy="${y}" r="${radius.toFixed(1)}" fill="${color}" opacity="${(0.08 + random() * 0.18).toFixed(2)}"/>`);
  }
  return dots.join("");
}

export async function createBackground(outputDirectory, format, variant = 0) {
  const { width, height } = dimensions(format);
  const outputPath = path.join(outputDirectory, `background-${format}-${variant}.png`);
  const coralX = format === "vertical" ? width * 0.82 : width * (variant % 2 ? 0.78 : 0.88);
  const coralY = format === "vertical" ? height * 0.12 : height * 0.2;
  const tealX = format === "vertical" ? width * 0.12 : width * 0.18;
  const tealY = format === "vertical" ? height * 0.82 : height * 0.76;
  const gridStep = format === "vertical" ? 96 : 88;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="base" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#140823"/><stop offset="0.52" stop-color="#2D1B47"/><stop offset="1" stop-color="#140823"/></linearGradient>
      <radialGradient id="coral"><stop stop-color="${campaign.palette.coral}" stop-opacity=".35"/><stop offset="1" stop-color="${campaign.palette.coral}" stop-opacity="0"/></radialGradient>
      <radialGradient id="teal"><stop stop-color="${campaign.palette.teal}" stop-opacity=".22"/><stop offset="1" stop-color="${campaign.palette.teal}" stop-opacity="0"/></radialGradient>
      <pattern id="grid" width="${gridStep}" height="${gridStep}" patternUnits="userSpaceOnUse"><path d="M ${gridStep} 0 L 0 0 0 ${gridStep}" fill="none" stroke="#FFF8EF" stroke-opacity=".045" stroke-width="1"/></pattern>
      <filter id="blur"><feGaussianBlur stdDeviation="48"/></filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#base)"/>
    <circle cx="${coralX}" cy="${coralY}" r="${Math.round(Math.min(width, height) * 0.48)}" fill="url(#coral)" filter="url(#blur)"/>
    <circle cx="${tealX}" cy="${tealY}" r="${Math.round(Math.min(width, height) * 0.42)}" fill="url(#teal)" filter="url(#blur)"/>
    <rect width="100%" height="100%" fill="url(#grid)"/>
    <path d="M -80 ${height * 0.73} C ${width * 0.18} ${height * 0.58}, ${width * 0.44} ${height * 0.93}, ${width + 80} ${height * 0.66}" fill="none" stroke="${campaign.palette.coral}" stroke-opacity=".18" stroke-width="3"/>
    <path d="M -80 ${height * 0.78} C ${width * 0.24} ${height * 0.63}, ${width * 0.52} ${height * 0.96}, ${width + 80} ${height * 0.71}" fill="none" stroke="${campaign.palette.gold}" stroke-opacity=".13" stroke-width="2"/>
    ${seedDots(width, height, variant)}
  </svg>`;
  return renderSvg(svg, outputPath);
}

export async function createLogo(outputDirectory, variant = "light") {
  const outputPath = path.join(outputDirectory, `edulabsai-wordmark-${variant}.png`);
  const foreground = variant === "dark" ? campaign.palette.aubergine : campaign.palette.cream;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="280" viewBox="0 0 1120 280">
    <g transform="translate(10 18) scale(3.75)">
      <path d="M31.4 43 C18 41 12.5 30.5 14.6 18.5 C27 21.5 31.4 32 31.4 43 Z" fill="${foreground}"/>
      <path d="M32.6 43 C46 41 51.5 30.5 49.4 18.5 C37 21.5 32.6 32 32.6 43 Z" fill="${foreground}"/>
      <path d="M20.5 24.5 C24.5 28.5 27.5 33 29 37.5" stroke="${variant === "dark" ? campaign.palette.cream : campaign.palette.aubergine}" stroke-width="1.7" stroke-linecap="round" fill="none"/>
      <path d="M43.5 24.5 C39.5 28.5 36.5 33 35 37.5" stroke="${variant === "dark" ? campaign.palette.cream : campaign.palette.aubergine}" stroke-width="1.7" stroke-linecap="round" fill="none"/>
      <path d="M32 40 L32 51.5" stroke="${foreground}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="32" cy="53.5" r="5.4" fill="${campaign.palette.coral}"/>
    </g>
    <text x="286" y="185" fill="${foreground}" font-family="${FONT}" font-size="138" font-weight="800" letter-spacing="-6">Edulabs<tspan fill="${campaign.palette.gold}">AI</tspan></text>
  </svg>`;
  return renderSvg(svg, outputPath);
}

export async function createHeadline(outputDirectory, productionId, scene, format) {
  const vertical = format === "vertical";
  const width = vertical ? 980 : 790;
  const height = vertical ? 470 : 500;
  const outputPath = path.join(outputDirectory, "headlines", `${productionId}-${scene.id}-${format}.png`);
  const preferredHeadlineSize = vertical ? 92 : 86;
  const longestLine = Math.max(...scene.headline.map((line) => line.length));
  const fittedHeadlineSize = Math.floor((width - 34) / Math.max(1, longestLine * 0.57));
  const headlineSize = Math.max(vertical ? 58 : 56, Math.min(preferredHeadlineSize, fittedHeadlineSize));
  const headlineStart = vertical ? 130 : 126;
  const lineHeight = Math.round(headlineSize * 1.1);
  const subheadY = headlineStart + scene.headline.length * lineHeight + 34;
  const lines = scene.headline.map((line, index) => `<text x="12" y="${headlineStart + index * lineHeight}" fill="${index === scene.headline.length - 1 ? campaign.palette.gold : campaign.palette.cream}" font-family="${FONT}" font-size="${headlineSize}" font-weight="820" letter-spacing="-3">${esc(line)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="12" y="20" width="112" height="7" rx="3.5" fill="${campaign.palette.coral}"/>
    <text x="12" y="68" fill="${campaign.palette.coral}" font-family="${FONT}" font-size="24" font-weight="760" letter-spacing="5">${esc(scene.eyebrow)}</text>
    ${lines}
    <text x="12" y="${Math.min(height - 28, subheadY)}" fill="#FFF8EFC9" font-family="${FONT}" font-size="${vertical ? 31 : 29}" font-weight="520">${esc(scene.subhead)}</text>
  </svg>`;
  return renderSvg(svg, outputPath);
}

export async function createScreenFrame(outputDirectory, format) {
  const vertical = format === "vertical";
  const width = vertical ? 980 : 1160;
  const height = Math.round(width * 9 / 16);
  const outputPath = path.join(outputDirectory, `screen-frame-${format}.png`);
  const radius = vertical ? 34 : 28;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><filter id="shadow" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000000" flood-opacity=".58"/></filter></defs>
    <g filter="url(#shadow)">
      <rect x="9" y="9" width="${width - 18}" height="${height - 18}" rx="${radius}" fill="none" stroke="#FFF8EF" stroke-opacity=".9" stroke-width="18"/>
      <path d="M ${radius} 18 H ${width - radius} Q ${width - 18} 18 ${width - 18} ${radius} V 58 H 18 V ${radius} Q 18 18 ${radius} 18 Z" fill="#FFF8EF" fill-opacity=".96"/>
      <circle cx="48" cy="38" r="7" fill="${campaign.palette.coral}"/><circle cx="72" cy="38" r="7" fill="${campaign.palette.gold}"/><circle cx="96" cy="38" r="7" fill="${campaign.palette.teal}"/>
      <rect x="${Math.round(width * 0.36)}" y="29" width="${Math.round(width * 0.28)}" height="17" rx="8.5" fill="${campaign.palette.aubergine}" fill-opacity=".12"/>
    </g>
  </svg>`;
  return renderSvg(svg, outputPath);
}

function iconText(x, y, title, subtitle, color, width = 260) {
  return `<g transform="translate(${x} ${y})"><rect width="${width}" height="128" rx="30" fill="#FFF8EF" fill-opacity=".96" stroke="${color}" stroke-width="3"/><circle cx="46" cy="42" r="17" fill="${color}"/><text x="78" y="48" font-family="${FONT}" font-size="27" font-weight="780" fill="${campaign.palette.aubergine}">${esc(title)}</text><text x="28" y="91" font-family="${FONT}" font-size="19" font-weight="520" fill="#2D1B47B8">${esc(subtitle)}</text></g>`;
}

function artSvg(type, format) {
  const vertical = format === "vertical";
  const width = vertical ? 920 : 940;
  const height = vertical ? 720 : 650;
  const cx = width / 2;
  const cy = height / 2;
  const p = campaign.palette;
  if (type === "logo-orbit" || type === "finale") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs><radialGradient id="g"><stop stop-color="${p.coral}" stop-opacity=".32"/><stop offset="1" stop-color="${p.coral}" stop-opacity="0"/></radialGradient><filter id="glow"><feGaussianBlur stdDeviation="12" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <circle cx="${cx}" cy="${cy}" r="${Math.min(width, height) * 0.42}" fill="url(#g)"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${width * 0.36}" ry="${height * 0.24}" fill="none" stroke="${p.coral}" stroke-opacity=".45" stroke-width="4" transform="rotate(-12 ${cx} ${cy})"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${width * 0.29}" ry="${height * 0.34}" fill="none" stroke="${p.teal}" stroke-opacity=".34" stroke-width="3" transform="rotate(22 ${cx} ${cy})"/>
      <circle cx="${cx - width * 0.31}" cy="${cy - height * 0.1}" r="16" fill="${p.gold}" filter="url(#glow)"/><circle cx="${cx + width * 0.25}" cy="${cy + height * 0.2}" r="13" fill="${p.teal}" filter="url(#glow)"/><circle cx="${cx + width * 0.2}" cy="${cy - height * 0.27}" r="11" fill="${p.coral}" filter="url(#glow)"/>
      <g transform="translate(${cx - 128} ${cy - 128}) scale(4)"><path d="M31.4 43 C18 41 12.5 30.5 14.6 18.5 C27 21.5 31.4 32 31.4 43 Z" fill="${p.cream}"/><path d="M32.6 43 C46 41 51.5 30.5 49.4 18.5 C37 21.5 32.6 32 32.6 43 Z" fill="${p.cream}"/><path d="M32 40 L32 51.5" stroke="${p.cream}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="53.5" r="5.4" fill="${p.coral}"/></g>
    </svg>`;
  }
  if (type === "connected-loop") {
    const nodes = [
      [cx, 58, "PLAN", p.coral], [width - 280, cy - 40, "TEACH", p.gold], [width - 330, height - 170, "CHECK", p.teal], [72, height - 170, "RETEACH", p.lilac], [28, cy - 40, "CONNECT", p.coral],
    ];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="s"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity=".42"/></filter><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9Z" fill="${p.coral}"/></marker></defs><path d="M ${cx} 130 C ${width - 80} 120, ${width - 40} ${height - 80}, ${cx} ${height - 82} C 40 ${height - 80}, 48 120, ${cx - 16} 128" fill="none" stroke="${p.coral}" stroke-width="6" stroke-linecap="round" stroke-dasharray="16 12" marker-end="url(#arrow)" opacity=".72"/>${nodes.map(([x,y,label,color]) => `<g transform="translate(${x} ${y})" filter="url(#s)"><rect width="210" height="92" rx="28" fill="#FFF8EF"/><circle cx="42" cy="46" r="17" fill="${color}"/><text x="73" y="55" font-family="${FONT}" font-size="25" font-weight="820" fill="${p.aubergine}">${label}</text></g>`).join("")}<circle cx="${cx}" cy="${cy}" r="92" fill="${p.aubergine}" stroke="${p.cream}" stroke-opacity=".28" stroke-width="3"/><text x="${cx}" y="${cy - 4}" text-anchor="middle" font-family="${FONT}" font-size="29" font-weight="820" fill="${p.cream}">ONE</text><text x="${cx}" y="${cy + 34}" text-anchor="middle" font-family="${FONT}" font-size="25" font-weight="650" fill="${p.gold}">OBJECTIVE</text></svg>`;
  }
  if (type === "resource-orbit") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="s"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#000" flood-opacity=".42"/></filter></defs><path d="M ${cx} ${cy} L 150 110 M ${cx} ${cy} L ${width - 410} 78 M ${cx} ${cy} L 112 ${height - 210} M ${cx} ${cy} L ${width - 390} ${height - 190}" stroke="${p.cream}" stroke-opacity=".24" stroke-width="4" stroke-dasharray="8 10"/>${iconText(20,40,"LESSON PLAN","Objectives and sequence",p.coral,310)}${iconText(width-340,22,"SLIDES","A visual teaching story",p.gold,320)}${iconText(8,height-178,"QUIZ","Questions and explanations",p.teal,330)}${iconText(width-370,height-158,"WORKSHEET","Scaffold and extension",p.lilac,350)}<g filter="url(#s)"><circle cx="${cx}" cy="${cy}" r="92" fill="${p.coral}"/><text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="${FONT}" font-size="29" font-weight="840" fill="white">ONE</text><text x="${cx}" y="${cy + 35}" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="840" fill="white">BRIEF</text></g></svg>`;
  }
  if (type === "subject-diagrams") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="s"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000" flood-opacity=".4"/></filter></defs><g filter="url(#s)"><rect x="20" y="24" width="420" height="272" rx="34" fill="#FFF8EF"/><circle cx="150" cy="158" r="76" fill="${p.gold}"/><path d="M150 158 L150 82 A76 76 0 0 1 226 158 Z" fill="#E8DBFF"/><path d="M150 158 L226 158 A76 76 0 0 1 150 234 Z" fill="#E8DBFF"/><path d="M150 158 L150 234 A76 76 0 0 1 74 158 Z" fill="#E8DBFF"/><text x="268" y="150" font-family="${FONT}" font-size="62" font-weight="840" fill="${p.aubergine}">3/4</text><text x="268" y="190" font-family="${FONT}" font-size="21" font-weight="620" fill="#2D1B47B8">SHADE THE FRACTION</text></g><g filter="url(#s)"><rect x="486" y="24" width="430" height="272" rx="34" fill="#FFF8EF"/><path d="M585 218 L730 92 L858 218" fill="none" stroke="${p.aubergine}" stroke-width="13" stroke-linecap="round"/><path d="M585 218 A148 148 0 0 1 675 108" fill="none" stroke="${p.coral}" stroke-width="11" stroke-linecap="round"/><text x="708" y="208" font-family="${FONT}" font-size="55" font-weight="840" fill="${p.coral}">58°</text><text x="606" y="258" font-family="${FONT}" font-size="21" font-weight="620" fill="#2D1B47B8">MEASURE THE ANGLE</text></g><g filter="url(#s)"><rect x="82" y="344" width="776" height="260" rx="34" fill="#FFF8EF"/><circle cx="238" cy="468" r="62" fill="#95D5FF"/><path d="M238 402 C190 366 166 398 175 430 C140 438 138 490 184 497" fill="#FFFFFF" stroke="#B9D8E6" stroke-width="4"/><path d="M340 518 C382 470 411 435 420 386" fill="none" stroke="${p.teal}" stroke-width="10" stroke-linecap="round"/><path d="M420 386 L397 405 M420 386 L427 417" stroke="${p.teal}" stroke-width="10" stroke-linecap="round"/><path d="M560 396 C598 443 626 481 646 526" fill="none" stroke="${p.coral}" stroke-width="10" stroke-linecap="round"/><path d="M646 526 L619 508 M646 526 L651 494" stroke="${p.coral}" stroke-width="10" stroke-linecap="round"/><text x="468" y="450" font-family="${FONT}" font-size="43" font-weight="840" text-anchor="middle" fill="${p.aubergine}">WATER CYCLE</text><text x="468" y="493" font-family="${FONT}" font-size="23" font-weight="620" text-anchor="middle" fill="#2D1B47B8">THE LOOP ACTUALLY LOOPS</text></g></svg>`;
  }
  if (type === "chat-network") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="s"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity=".42"/></filter></defs><path d="M ${cx} 310 L 180 150 M ${cx} 310 L 760 130 M ${cx} 310 L 170 510 M ${cx} 310 L 770 500" stroke="${p.cream}" stroke-opacity=".22" stroke-width="5" stroke-dasharray="9 12"/><g filter="url(#s)"><rect x="${cx-160}" y="235" width="320" height="150" rx="38" fill="${p.coral}"/><text x="${cx}" y="298" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="840" fill="white">TEACHER ADMIN</text><text x="${cx}" y="340" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="620" fill="#FFFFFFD8">visible · in control</text></g>${iconText(35,70,"WHOLE CLASS","One shared channel",p.gold,300)}${iconText(width-340,52,"GROUP A","Named learning team",p.teal,310)}${iconText(24,height-180,"GROUP B","Teacher-managed",p.lilac,310)}${iconText(width-356,height-196,"ADMINS","Assigned visibly",p.coral,330)}</svg>`;
  }
  if (type === "evidence-pulse") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="s"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#000" flood-opacity=".42"/></filter><linearGradient id="scan" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${p.coral}" stop-opacity="0"/><stop offset=".5" stop-color="${p.coral}"/><stop offset="1" stop-color="${p.coral}" stop-opacity="0"/></linearGradient></defs><g filter="url(#s)"><rect x="48" y="58" width="310" height="490" rx="30" fill="#FFF8EF"/><rect x="92" y="120" width="220" height="18" rx="9" fill="${p.aubergine}" fill-opacity=".18"/><rect x="92" y="170" width="180" height="15" rx="7" fill="${p.aubergine}" fill-opacity=".12"/><rect x="92" y="242" width="220" height="110" rx="18" fill="#FFFFFF" stroke="${p.coral}" stroke-width="4"/><path d="M110 298 L156 328 L255 266" fill="none" stroke="${p.teal}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><rect x="82" y="393" width="242" height="12" rx="6" fill="${p.aubergine}" fill-opacity=".11"/><rect x="82" y="427" width="204" height="12" rx="6" fill="${p.aubergine}" fill-opacity=".11"/></g><rect x="32" y="300" width="348" height="18" rx="9" fill="url(#scan)"/><path d="M380 306 C 460 306 456 176 540 176" fill="none" stroke="${p.coral}" stroke-width="8" stroke-linecap="round"/><path d="M535 176 L510 157 M535 176 L507 193" stroke="${p.coral}" stroke-width="8" stroke-linecap="round"/><g filter="url(#s)"><rect x="538" y="82" width="362" height="456" rx="34" fill="#FFF8EF"/><text x="582" y="144" font-family="${FONT}" font-size="23" font-weight="780" fill="${p.coral}" letter-spacing="3">VERIFIED EVIDENCE</text><text x="582" y="215" font-family="${FONT}" font-size="42" font-weight="850" fill="${p.aubergine}">Misconception</text><text x="582" y="260" font-family="${FONT}" font-size="42" font-weight="850" fill="${p.aubergine}">found.</text><rect x="582" y="310" width="266" height="86" rx="24" fill="${p.aubergine}"/><text x="715" y="363" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="780" fill="white">OPEN RETEACH</text><circle cx="618" cy="462" r="14" fill="${p.teal}"/><text x="650" y="471" font-family="${FONT}" font-size="23" font-weight="650" fill="${p.aubergine}">Teacher approved</text></g></svg>`;
  }
  if (type === "family-signal") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="s"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#000" flood-opacity=".42"/></filter></defs><g filter="url(#s)"><circle cx="150" cy="325" r="102" fill="${p.aubergine}" stroke="${p.cream}" stroke-opacity=".32" stroke-width="4"/><path d="M150 255 L215 282 V332 C215 380 187 414 150 431 C113 414 85 380 85 332 V282 Z" fill="${p.coral}"/><path d="M116 331 L142 357 L190 306" fill="none" stroke="white" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><text x="150" y="477" text-anchor="middle" font-family="${FONT}" font-size="23" font-weight="700" fill="${p.cream}">TEACHER APPROVED</text></g><path d="M270 325 C355 325 356 183 447 183 M270 325 C355 325 356 466 447 466" fill="none" stroke="${p.gold}" stroke-opacity=".8" stroke-width="7" stroke-linecap="round" stroke-dasharray="12 12"/><g filter="url(#s)"><rect x="442" y="82" width="450" height="216" rx="34" fill="#FFF8EF"/><circle cx="502" cy="150" r="26" fill="${p.gold}"/><text x="550" y="159" font-family="${FONT}" font-size="31" font-weight="830" fill="${p.aubergine}">Report comment</text><rect x="492" y="203" width="345" height="13" rx="6" fill="${p.aubergine}" fill-opacity=".12"/><rect x="492" y="237" width="282" height="13" rx="6" fill="${p.aubergine}" fill-opacity=".12"/></g><g filter="url(#s)"><rect x="442" y="352" width="450" height="216" rx="34" fill="#FFF8EF"/><circle cx="502" cy="420" r="26" fill="${p.teal}"/><text x="550" y="429" font-family="${FONT}" font-size="31" font-weight="830" fill="${p.aubergine}">Family Digest</text><rect x="492" y="473" width="345" height="13" rx="6" fill="${p.aubergine}" fill-opacity=".12"/><rect x="492" y="507" width="250" height="13" rx="6" fill="${p.aubergine}" fill-opacity=".12"/></g></svg>`;
  }
  return artSvg("logo-orbit", format);
}

export async function createArt(outputDirectory, type, format) {
  const outputPath = path.join(outputDirectory, "art", `${type}-${format}.png`);
  return renderSvg(artSvg(type, format), outputPath);
}

export async function prepareVisualAssets(outputDirectory, production) {
  const format = production.format;
  const assets = {
    backgrounds: [],
    logo: await createLogo(outputDirectory, "light"),
    frame: await createScreenFrame(outputDirectory, format),
    art: {},
    headlines: {},
  };
  for (let variant = 0; variant < 4; variant += 1) assets.backgrounds.push(await createBackground(outputDirectory, format, variant));
  for (const scene of production.scenes) {
    assets.headlines[scene.id] = await createHeadline(outputDirectory, production.id, scene, format);
    if (scene.art && !assets.art[scene.art]) assets.art[scene.art] = await createArt(outputDirectory, scene.art, format);
  }
  return assets;
}
