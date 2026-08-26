import path from "node:path";
import { writeFile } from "node:fs/promises";
import { bundledAssetLicense } from "./assets.js";
import type { CreatorManifest } from "./types.js";

export async function writeLicenseReport(manifest: CreatorManifest, outputDirectory: string): Promise<string> {
  const reportPath = path.join(outputDirectory, "ASSET-LICENSES.md");
  const used = [
    ...manifest.clips.map((clip) => ({ role: `clip:${clip.id}`, source: clip.source, licenseId: clip.licenseId })),
    ...(manifest.brand?.logo ? [{ role: "brand:logo", source: manifest.brand.logo, licenseId: manifest.brand.logoLicenseId }] : []),
    ...(manifest.overlays ?? []).filter((item) => item.source).map((item) => ({ role: `overlay:${item.id}`, source: item.source!, licenseId: item.licenseId })),
    ...(manifest.audio?.voice ? [{ role: "audio:voice", source: manifest.audio.voice.source, licenseId: manifest.audio.voice.licenseId }] : []),
    ...(manifest.audio?.voices ?? []).map((item, index) => ({ role: `audio:voice-${index + 1}`, source: item.source, licenseId: item.licenseId })),
    ...(manifest.audio?.music ? [{ role: "audio:music", source: manifest.audio.music.source, licenseId: manifest.audio.music.licenseId }] : []),
    ...(manifest.audio?.ambience ? [{ role: "audio:ambience", source: manifest.audio.ambience.source, licenseId: manifest.audio.ambience.licenseId }] : []),
    ...(manifest.audio?.soundEffects ?? []).map((item, index) => ({ role: `audio:sfx-${index + 1}`, source: item.source, licenseId: item.licenseId })),
  ];
  const declared = [...(manifest.licenses ?? [])];
  for (const asset of used) {
    const bundled = bundledAssetLicense(asset.source);
    if (bundled && !declared.some((item) => item.id === bundled.id)) declared.push(bundled);
  }
  const lines = [
    "# Asset license report",
    "",
    `Generated for **${manifest.title}**. Agent Demo Studio's source code is MIT-licensed; that does not change the license of media supplied to a project.`,
    "",
    "## Assets used",
    "",
    "| Role | Source | License record |",
    "|---|---|---|",
    ...used.map((asset) => `| ${asset.role.replaceAll("|", "\\|")} | ${asset.source.replaceAll("|", "\\|")} | ${asset.licenseId ?? bundledAssetLicense(asset.source)?.id ?? "Not declared — review before publishing"} |`),
    "",
    "## Declared licenses",
    "",
  ];
  if (!declared.length) lines.push("No license records were declared.", "");
  for (const item of declared) {
    lines.push(`### ${item.title ?? item.id}`, "", `- Source: ${item.source}`, `- License: ${item.license}${item.licenseUrl ? ` (${item.licenseUrl})` : ""}`, `- Creator: ${item.creator ?? "Not specified"}`, `- Attribution: ${item.attribution ?? "Not specified"}`, `- Proof: ${item.proofUrl ?? "Not supplied"}`, "");
  }
  lines.push("## Publishing check", "", "Confirm that every third-party clip, image, logo, font, voice, and music track is owned, licensed, public domain, or otherwise authorized for the intended platform and territory.", "");
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}
