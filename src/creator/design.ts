import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { escapeXml, wrapText } from "../utils/text.js";
import type { CaptionCue, CreatorBrand, CreatorCaptionStyle, CreatorChromaKey, CreatorOverlay, CreatorOverlayAnimation, CreatorPreset } from "./types.js";

export interface TimedVisualAsset {
  id: string;
  kind: "raster" | "video";
  path: string;
  startSeconds: number;
  endSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  animation?: CreatorOverlayAnimation;
  flipHorizontal?: boolean;
  loop?: boolean;
  chromaKey?: CreatorChromaKey;
}

export type TimedRasterAsset = TimedVisualAsset;

function textElements(lines: string[], x: number, startY: number, lineHeight: number, options: {
  size: number;
  color: string;
  weight?: number;
  anchor?: "start" | "middle";
  family?: string;
}): string {
  return lines.map((line, index) => `<text x="${x}" y="${startY + index * lineHeight}" text-anchor="${options.anchor ?? "start"}" fill="${options.color}" font-family="${escapeXml(options.family ?? "Arial, Helvetica, sans-serif")}" font-size="${options.size}" font-weight="${options.weight ?? 700}">${escapeXml(line)}</text>`).join("");
}

function safeFileId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "asset";
}

function elementBox(overlay: CreatorOverlay, preset: CreatorPreset): { x: number; y: number; width: number; height: number } {
  const visualCharacter = overlay.type === "presenter" || overlay.type === "character";
  const defaultWidth = visualCharacter
    ? preset.width * (preset.height > preset.width ? 0.58 : 0.32)
    : overlay.type === "video"
      ? preset.width * (preset.height > preset.width ? 0.82 : 0.42)
      : overlay.type === "cta"
        ? preset.width * 0.46
        : overlay.type === "lower-third" || overlay.type === "speech-bubble"
          ? preset.width * 0.54
          : preset.width * 0.82;
  const width = Math.min(preset.width * 0.92, overlay.width ?? defaultWidth);
  const defaultHeight = visualCharacter
    ? preset.height * (preset.height > preset.width ? 0.54 : 0.72)
    : overlay.type === "video"
      ? width * 9 / 16
      : overlay.type === "text" ? preset.height * 0.17 : overlay.subtitle ? preset.height * 0.13 : preset.height * 0.1;
  const height = Math.min(preset.height * 0.82, overlay.height ?? defaultHeight);
  const centerX = (overlay.x ?? 0.5) * preset.width;
  const defaultY = visualCharacter ? 0.64 : overlay.type === "lower-third" ? 0.8 : 0.2;
  const centerY = (overlay.y ?? defaultY) * preset.height;
  return {
    x: Math.round(Math.max(0, Math.min(preset.width - width, centerX - width / 2))),
    y: Math.round(Math.max(0, Math.min(preset.height - height, centerY - height / 2))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

async function renderImageOverlay(overlay: CreatorOverlay, preset: CreatorPreset, sourcePath: string, outputPath: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const character = overlay.type === "presenter" || overlay.type === "character";
  const defaultWidth = overlay.type === "watermark"
    ? preset.width * 0.16
    : character
      ? preset.width * (preset.height > preset.width ? 0.58 : 0.32)
      : preset.width * 0.38;
  const targetWidth = Math.round(Math.min(preset.width * 0.92, overlay.width ?? defaultWidth));
  const metadata = await sharp(sourcePath).metadata();
  const ratio = metadata.width && metadata.height ? metadata.height / metadata.width : 1;
  const targetHeight = Math.round(Math.min(preset.height * (character ? 0.78 : 0.62), overlay.height ?? targetWidth * ratio));
  const opacity = overlay.opacity ?? (overlay.type === "watermark" ? 0.78 : 1);
  // `inside` avoids adding transparent padding. FFmpeg alpha fades can expose the
  // RGB values of padded pixels as black bands, while natural image bounds keep
  // the original cutout alpha intact throughout animation.
  let pipeline = sharp(sourcePath).resize({ width: targetWidth, height: targetHeight, fit: "inside" }).ensureAlpha();
  if (overlay.flipHorizontal) pipeline = pipeline.flop();
  const prepared = await pipeline.raw().toBuffer({ resolveWithObject: true });
  if (opacity < 1) {
    for (let index = 3; index < prepared.data.length; index += 4) prepared.data[index] = Math.round(prepared.data[index]! * opacity);
  }
  await sharp(prepared.data, { raw: prepared.info }).png().toFile(outputPath);
  const width = prepared.info.width;
  const height = prepared.info.height;
  const watermarkX = (preset.width - preset.safeZone.right - width / 2) / preset.width;
  const watermarkY = (preset.safeZone.top + height / 2) / preset.height;
  const defaultX = overlay.type === "watermark" ? watermarkX : character ? (preset.height > preset.width ? 0.7 : 0.82) : 0.5;
  const defaultY = overlay.type === "watermark" ? watermarkY : character ? 0.64 : 0.5;
  const x = Math.round(Math.max(0, Math.min(preset.width - width, (overlay.x ?? defaultX) * preset.width - width / 2)));
  const y = Math.round(Math.max(0, Math.min(preset.height - height, (overlay.y ?? defaultY) * preset.height - height / 2)));
  return { x, y, width: prepared.info.width, height: prepared.info.height };
}

function fittedText(value: string, availableWidth: number, availableHeight: number, preferredSize: number, maxLines: number): { lines: string[]; fontSize: number; lineHeight: number } {
  let fontSize = Math.round(preferredSize);
  let lines: string[] = [];
  let maxCharacters = 12;
  while (fontSize >= 18) {
    maxCharacters = Math.max(12, Math.floor(availableWidth / (fontSize * 0.55)));
    lines = wrapText(value, maxCharacters);
    const lineHeight = Math.round(fontSize * 1.16);
    if (lines.length <= maxLines && lines.length * lineHeight <= availableHeight) return { lines, fontSize, lineHeight };
    fontSize -= 2;
  }
  lines = wrapText(value, maxCharacters);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    const remaining = lines.slice(maxLines - 1).join(" ");
    visible[maxLines - 1] = remaining.length > maxCharacters ? `${remaining.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…` : remaining;
  }
  return { lines: visible, fontSize: 18, lineHeight: 21 };
}

function fittedSingleLine(value: string, availableWidth: number, preferredSize: number): { text: string; fontSize: number } {
  let fontSize = Math.round(preferredSize);
  while (fontSize > 14 && value.length * fontSize * 0.55 > availableWidth) fontSize -= 1;
  const maxCharacters = Math.max(1, Math.floor(availableWidth / (fontSize * 0.55)));
  return { text: value.length > maxCharacters ? `${value.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…` : value, fontSize };
}

async function renderTextOverlay(overlay: CreatorOverlay, preset: CreatorPreset, brand: CreatorBrand | undefined, outputPath: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const placement = elementBox(overlay, preset);
  const box = { ...placement, x: 0, y: 0 };
  const preferredFontSize = Math.round(overlay.fontSize ?? Math.max(28, Math.min(76, preset.width / 20)));
  const horizontalPadding = Math.max(36, Math.round(preferredFontSize * 1.4));
  const textAreaHeight = overlay.subtitle ? box.height * 0.58 : box.height * 0.74;
  const layout = fittedText(overlay.text ?? "", box.width - horizontalPadding, textAreaHeight, preferredFontSize, overlay.subtitle ? 2 : 3);
  const { lines, fontSize, lineHeight } = layout;
  const foreground = overlay.color ?? brand?.text ?? "#FFFFFF";
  const background = overlay.background ?? (overlay.type === "text" ? "#070A15D9" : "#11152AF2");
  const accent = overlay.accent ?? brand?.primary ?? "#8B5CF6";
  const radius = overlay.cornerRadius ?? Math.max(18, Math.round(box.height * 0.18));
  const textX = box.x + Math.max(26, Math.round(fontSize * 0.72));
  const alignMiddle = overlay.type === "cta";
  const anchorX = alignMiddle ? box.x + box.width / 2 : textX;
  const totalTextHeight = Math.max(lineHeight, lines.length * lineHeight);
  const textRegionTop = box.y + (overlay.subtitle ? box.height * 0.08 : (box.height - totalTextHeight) / 2);
  const textStart = textRegionTop + fontSize;
  const subtitle = overlay.subtitle ? fittedSingleLine(overlay.subtitle, box.width - horizontalPadding, fontSize * 0.48) : undefined;
  const subtitleY = box.y + box.height - Math.max(16, Math.round((subtitle?.fontSize ?? fontSize * 0.48) * 0.72));
  const speechTail = overlay.type === "speech-bubble" ? `<path d="M ${Math.round(box.width * 0.22)} ${box.height - 2} L ${Math.round(box.width * 0.31)} ${box.height - 2} L ${Math.round(box.width * 0.24)} ${box.height + Math.min(34, Math.round(box.height * 0.28))} Z" fill="${background}"/>` : "";
  const svgHeight = box.height + (overlay.type === "speech-bubble" ? Math.min(36, Math.round(box.height * 0.3)) : 0);
  const svg = `<svg width="${box.width}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="shadow" x="-40%" y="-60%" width="180%" height="220%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.46"/></filter></defs>
    <g opacity="${overlay.opacity ?? 1}" filter="url(#shadow)">
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${radius}" fill="${background}" stroke="#FFFFFF20" stroke-width="2"/>
      ${speechTail}
      <rect x="${box.x}" y="${box.y}" width="${alignMiddle ? box.width : Math.max(8, Math.round(box.width * 0.016))}" height="${alignMiddle ? Math.max(8, Math.round(box.height * 0.08)) : box.height}" rx="${Math.max(4, Math.round(radius / 2))}" fill="${accent}"/>
      ${textElements(lines, anchorX, textStart, lineHeight, { size: fontSize, color: foreground, weight: 800, anchor: alignMiddle ? "middle" : "start", family: brand?.fontFamily })}
      ${subtitle ? `<text x="${alignMiddle ? box.x + box.width / 2 : textX}" y="${subtitleY}" text-anchor="${alignMiddle ? "middle" : "start"}" fill="#CBD5E1" font-family="${escapeXml(brand?.fontFamily ?? "Arial, Helvetica, sans-serif")}" font-size="${subtitle.fontSize}" font-weight="500">${escapeXml(subtitle.text)}</text>` : ""}
    </g>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return { ...placement, height: svgHeight };
}

export async function renderOverlayAssets(overlays: CreatorOverlay[], preset: CreatorPreset, outputDirectory: string, brand?: CreatorBrand, resolveSource: (source: string) => string = (source) => source): Promise<TimedVisualAsset[]> {
  await mkdir(outputDirectory, { recursive: true });
  const assets: TimedVisualAsset[] = [];
  for (const [index, overlay] of overlays.entries()) {
    if (overlay.type === "video") {
      const placement = elementBox(overlay, preset);
      assets.push({
        id: overlay.id,
        kind: "video",
        path: resolveSource(overlay.source!),
        startSeconds: overlay.startSeconds,
        endSeconds: overlay.endSeconds,
        ...placement,
        opacity: overlay.opacity ?? 1,
        animation: overlay.animation,
        flipHorizontal: overlay.flipHorizontal,
        loop: overlay.loop,
        chromaKey: overlay.chromaKey,
      });
      continue;
    }
    const outputPath = path.join(outputDirectory, `${String(index + 1).padStart(3, "0")}-${safeFileId(overlay.id)}.png`);
    const placement = ["image", "watermark", "presenter", "character"].includes(overlay.type)
      ? await renderImageOverlay(overlay, preset, resolveSource(overlay.source!), outputPath)
      : await renderTextOverlay(overlay, preset, brand, outputPath);
    assets.push({
      id: overlay.id,
      kind: "raster",
      path: outputPath,
      startSeconds: overlay.startSeconds,
      endSeconds: overlay.endSeconds,
      ...placement,
      opacity: 1,
      animation: overlay.animation,
      loop: true,
    });
  }
  return assets;
}

export async function renderCaptionOverlayAssets(cues: CaptionCue[], preset: CreatorPreset, style: CreatorCaptionStyle | undefined, outputDirectory: string): Promise<TimedVisualAsset[]> {
  await mkdir(outputDirectory, { recursive: true });
  const fontSize = Math.round(style?.fontSize ?? (preset.height > preset.width ? 54 : 44));
  const maxChars = style?.maxCharactersPerLine ?? (preset.height > preset.width ? 30 : 54);
  const maxLines = style?.maxLines ?? 3;
  const lineHeight = Math.round(fontSize * 1.18);
  const foreground = style?.color ?? "#FFFFFF";
  const background = style?.background ?? "#050711E8";
  const accent = style?.accent ?? "#22D3EE";
  const margin = Math.round(style?.margin ?? preset.safeZone.bottom);
  const assets: TimedRasterAsset[] = [];
  for (const [index, cue] of cues.entries()) {
    const lines = wrapText(cue.text.replaceAll("\n", " "), maxChars).slice(0, maxLines);
    const width = Math.round(preset.width * (preset.height > preset.width ? 0.82 : 0.74));
    const height = Math.round(44 + lines.length * lineHeight);
    const x = Math.round((preset.width - width) / 2);
    const y = style?.position === "top" ? preset.safeZone.top : style?.position === "middle" ? Math.round((preset.height - height) / 2) : Math.max(preset.safeZone.top, preset.height - margin - height);
    const svg = `<svg width="${preset.width}" height="${preset.height}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="shadow"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.62"/></filter></defs>
      <g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24" fill="${background}" stroke="#FFFFFF22" stroke-width="2"/><rect x="${x + 18}" y="${y + 16}" width="7" height="${height - 32}" rx="4" fill="${accent}"/>${textElements(lines, x + 48, y + 42 + fontSize * 0.32, lineHeight, { size: fontSize, color: foreground, weight: 750 })}</g>
    </svg>`;
    const outputPath = path.join(outputDirectory, `${String(index + 1).padStart(4, "0")}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outputPath);
    assets.push({ id: `caption-${cue.index}`, kind: "raster", path: outputPath, startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, x: 0, y: 0, width: preset.width, height: preset.height, opacity: 1, loop: true });
  }
  return assets;
}
