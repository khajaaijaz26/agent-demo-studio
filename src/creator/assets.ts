import { fileURLToPath } from "node:url";
import type { CreatorAssetLicense } from "./types.js";

export type CreatorBundledAssetKind = "presenter" | "character" | "scene";

export interface CreatorBundledAsset {
  id: string;
  source: string;
  label: string;
  kind: CreatorBundledAssetKind;
  style: "photorealistic" | "cartoon-3d" | "cinematic" | "macro";
  description: string;
  synthetic: true;
  relativePath: string;
}

export const CREATOR_BUNDLED_ASSETS: readonly CreatorBundledAsset[] = [
  {
    id: "aria",
    source: "builtin:presenter/aria",
    label: "Aria",
    kind: "presenter",
    style: "photorealistic",
    description: "Fictional woman product presenter with an open-hand demonstration pose.",
    synthetic: true,
    relativePath: "../../assets/presenters/aria.png",
  },
  {
    id: "leo",
    source: "builtin:presenter/leo",
    label: "Leo",
    kind: "presenter",
    style: "photorealistic",
    description: "Fictional man product presenter with an open-hand demonstration pose.",
    synthetic: true,
    relativePath: "../../assets/presenters/leo.png",
  },
  {
    id: "nova",
    source: "builtin:character/nova",
    label: "Nova",
    kind: "character",
    style: "cartoon-3d",
    description: "Original fictional cartoon inventor and story host.",
    synthetic: true,
    relativePath: "../../assets/characters/nova.png",
  },
  {
    id: "milo",
    source: "builtin:character/milo",
    label: "Milo",
    kind: "character",
    style: "cartoon-3d",
    description: "Original fictional cartoon maker and story host.",
    synthetic: true,
    relativePath: "../../assets/characters/milo.png",
  },
  {
    id: "launch-stage",
    source: "builtin:scene/launch-stage",
    label: "Launch Stage",
    kind: "scene",
    style: "cinematic",
    description: "Original premium technology stage for product reveals.",
    synthetic: true,
    relativePath: "../../assets/scenes/launch-stage.png",
  },
  {
    id: "cartoon-workshop",
    source: "builtin:scene/cartoon-workshop",
    label: "Cartoon Workshop",
    kind: "scene",
    style: "cartoon-3d",
    description: "Original whimsical technology workshop background.",
    synthetic: true,
    relativePath: "../../assets/scenes/cartoon-workshop.png",
  },
  {
    id: "story-forest",
    source: "builtin:scene/story-forest",
    label: "Story Forest",
    kind: "scene",
    style: "cinematic",
    description: "Original magical forest background for narrated stories.",
    synthetic: true,
    relativePath: "../../assets/scenes/story-forest.png",
  },
  {
    id: "asmr-glass",
    source: "builtin:scene/asmr-glass",
    label: "ASMR Glass",
    kind: "scene",
    style: "macro",
    description: "Original calming macro scene with glass, water, and ceramic textures.",
    synthetic: true,
    relativePath: "../../assets/scenes/asmr-glass.png",
  },
] as const;

const assetBySource = new Map(CREATOR_BUNDLED_ASSETS.map((asset) => [asset.source, asset]));
const assetById = new Map(CREATOR_BUNDLED_ASSETS.map((asset) => [asset.id, asset]));

export function listCreatorAssets(): Array<Omit<CreatorBundledAsset, "relativePath">> {
  return CREATOR_BUNDLED_ASSETS.map(({ relativePath: _relativePath, ...asset }) => ({ ...asset }));
}

export function getCreatorAsset(id: string): CreatorBundledAsset {
  const asset = assetById.get(id);
  if (!asset) throw new Error(`Unknown bundled creator asset '${id}'.`);
  return asset;
}

export function resolveBundledCreatorAsset(source: string): string | undefined {
  const asset = assetBySource.get(source);
  return asset ? fileURLToPath(new URL(asset.relativePath, import.meta.url)) : undefined;
}

export function bundledAssetLicense(source: string): CreatorAssetLicense | undefined {
  const asset = assetBySource.get(source);
  if (!asset) return undefined;
  return {
    id: `agent-demo-${asset.id}`,
    source: asset.source,
    title: asset.label,
    creator: "Agent Demo Studio contributors",
    license: "MIT (bundled project asset)",
    attribution: "Original fictional synthetic asset created for Agent Demo Studio; not a real person or existing character.",
  };
}
