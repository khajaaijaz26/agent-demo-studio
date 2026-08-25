import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import type { DemoProject } from "../types.js";
import { escapeXml, splitNarration, wrapText } from "../utils/text.js";
import { projectDirectory } from "../project-store.js";

export interface CaptionAsset {
  path: string;
  startSeconds: number;
  endSeconds: number;
}

function textLines(lines: string[], startY: number, lineHeight: number, fontSize: number): string {
  return lines
    .map(
      (line, index) =>
        `<text x="960" y="${startY + index * lineHeight}" text-anchor="middle" fill="#F8FAFC" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join("");
}

export async function renderDesignAssets(
  project: DemoProject,
  root?: string,
): Promise<{ frame: string; intro: string; outro: string }> {
  const designDirectory = path.join(projectDirectory(project.id, root), "design");
  await mkdir(designDirectory, { recursive: true });
  const frame = path.join(designDirectory, "frame.png");
  const intro = path.join(designDirectory, "intro.png");
  const outro = path.join(designDirectory, "outro.png");
  const theme = project.theme;
  const title = escapeXml(project.title);
  const subtitle = escapeXml(project.subtitle);
  const url = escapeXml(project.url.replace(/^https?:\/\//, ""));

  const sharedDefs = `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${theme.backgroundStart}"/>
        <stop offset="100%" stop-color="${theme.backgroundEnd}"/>
      </linearGradient>
      <radialGradient id="glow">
        <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.48"/>
        <stop offset="100%" stop-color="${theme.accent}" stop-opacity="0"/>
      </radialGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
        <feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#000000" flood-opacity="0.55"/>
      </filter>
    </defs>`;

  const frameSvg = `
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}
      <rect width="1920" height="1080" fill="url(#bg)"/>
      <circle cx="180" cy="80" r="460" fill="url(#glow)"/>
      <circle cx="1750" cy="1040" r="560" fill="url(#glow)" opacity="0.55"/>
      <rect x="72" y="60" width="1776" height="960" rx="22" fill="${theme.frame}" stroke="${theme.frameBorder}" stroke-width="2" filter="url(#shadow)"/>
      <path d="M72 92 Q72 60 104 60 H1816 Q1848 60 1848 92 V114 H72 Z" fill="#0C1021"/>
      <circle cx="108" cy="87" r="7" fill="#FF5F57"/>
      <circle cx="132" cy="87" r="7" fill="#FEBC2E"/>
      <circle cx="156" cy="87" r="7" fill="#28C840"/>
      <rect x="604" y="73" width="712" height="30" rx="15" fill="#FFFFFF0E" stroke="#FFFFFF12"/>
      <circle cx="629" cy="88" r="5" fill="${theme.highlight}"/>
      <text x="648" y="94" fill="${theme.mutedText}" font-family="Arial, Helvetica, sans-serif" font-size="15">${url}</text>
      <rect x="1588" y="73" width="220" height="30" rx="15" fill="${theme.accent}" fill-opacity="0.16" stroke="${theme.accent}" stroke-opacity="0.35"/>
      <text x="1698" y="94" text-anchor="middle" fill="${theme.text}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" letter-spacing="1.4">${escapeXml(theme.badge)}</text>
    </svg>`;

  const introTitle = wrapText(project.title, 30).slice(0, 3);
  const introSvg = `
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}
      <rect width="1920" height="1080" fill="url(#bg)"/>
      <circle cx="220" cy="120" r="620" fill="url(#glow)"/>
      <circle cx="1720" cy="940" r="680" fill="url(#glow)" opacity="0.58"/>
      <rect x="790" y="260" width="340" height="48" rx="24" fill="${theme.accent}" fill-opacity="0.2" stroke="${theme.accent}" stroke-opacity="0.55"/>
      <text x="960" y="291" text-anchor="middle" fill="${theme.text}" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" letter-spacing="3">${escapeXml(theme.badge)}</text>
      ${textLines(introTitle, 450, 98, 82)}
      <text x="960" y="${490 + introTitle.length * 98}" text-anchor="middle" fill="${theme.mutedText}" font-family="Arial, Helvetica, sans-serif" font-size="30">${subtitle}</text>
      <rect x="840" y="${565 + introTitle.length * 98}" width="240" height="6" rx="3" fill="${theme.highlight}"/>
    </svg>`;

  const outroSvg = `
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}
      <rect width="1920" height="1080" fill="url(#bg)"/>
      <circle cx="960" cy="540" r="690" fill="url(#glow)" opacity="0.64"/>
      <rect x="850" y="326" width="220" height="220" rx="56" fill="${theme.accent}" filter="url(#shadow)"/>
      <path d="M918 390 L1018 436 L918 482 Z" fill="#FFFFFF"/>
      <text x="960" y="660" text-anchor="middle" fill="${theme.text}" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="800">Made with Agent Demo Studio</text>
      <text x="960" y="724" text-anchor="middle" fill="${theme.mutedText}" font-family="Arial, Helvetica, sans-serif" font-size="26">Open source · MCP-native · Built for AI agents</text>
    </svg>`;

  await Promise.all([
    sharp(Buffer.from(frameSvg)).png().toFile(frame),
    sharp(Buffer.from(introSvg)).png().toFile(intro),
    sharp(Buffer.from(outroSvg)).png().toFile(outro),
  ]);
  return { frame, intro, outro };
}

export async function renderCaptionAssets(
  project: DemoProject,
  contentDuration: number,
  root?: string,
): Promise<CaptionAsset[]> {
  if (!project.render.captions || !project.audio.narration?.trim()) return [];
  const sentences = splitNarration(project.audio.narration);
  if (!sentences.length) return [];
  const captionDirectory = path.join(projectDirectory(project.id, root), "captions");
  await mkdir(captionDirectory, { recursive: true });
  const totalWeight = sentences.reduce((total, sentence) => total + Math.max(12, sentence.length), 0);
  const assets: CaptionAsset[] = [];
  let cursor = project.render.introSeconds;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    const share = Math.max(12, sentence.length) / totalWeight;
    const duration = contentDuration * share;
    const lines = wrapText(sentence, 58).slice(0, 3);
    const height = 54 + lines.length * 46;
    const svg = `
      <svg width="1320" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="1318" height="${height - 2}" rx="24" fill="#050711DD" stroke="#FFFFFF25" stroke-width="2"/>
        <rect x="24" y="20" width="6" height="${height - 40}" rx="3" fill="${project.theme.highlight}"/>
        ${lines
          .map(
            (line, lineIndex) =>
              `<text x="60" y="${48 + lineIndex * 46}" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="650">${escapeXml(line)}</text>`,
          )
          .join("")}
      </svg>`;
    const captionPath = path.join(captionDirectory, `caption-${String(index + 1).padStart(2, "0")}.png`);
    await sharp(Buffer.from(svg)).png().toFile(captionPath);
    assets.push({
      path: captionPath,
      startSeconds: cursor,
      endSeconds: Math.min(project.render.introSeconds + contentDuration, cursor + duration),
    });
    cursor += duration;
  }
  return assets;
}
