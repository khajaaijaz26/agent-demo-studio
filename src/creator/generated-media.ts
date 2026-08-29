import type { CreatorMediaProvider, CreatorMediaTask } from "./types.js";

export interface GeneratedSceneMedia {
  path: string;
  kind: "image" | "video";
  sceneId?: string;
  model?: string;
  prompt?: string;
  rights?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface SceneMediaGenerationResult {
  provider: Exclude<CreatorMediaProvider, "auto" | "builtin">;
  local: boolean;
  task: Exclude<CreatorMediaTask, "auto">;
  qualityTier: "animated-2d" | "generative-video";
  durationMs: number;
  outputs: GeneratedSceneMedia[];
  qualityReportPath?: string;
  semanticReportPath?: string;
  backend?: {
    name: string;
    endpoint?: string;
    workflow?: string;
    mode?: "local" | "api";
  };
}

export function mediaTaskRequiresVideo(task: CreatorMediaTask): boolean {
  return task === "image-to-video"
    || task === "text-to-video"
    || task === "speech-to-video"
    || task === "character-animation";
}
