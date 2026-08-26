import { CREATOR_SCHEMA_VERSION, type CreatorManifest, type CreatorTemplate, type CreatorTemplateId } from "./types.js";
import { createPromptVideoManifest } from "./prompt.js";

interface TemplateOptions {
  title?: string;
  source?: string;
  secondarySource?: string;
  outputDirectory?: string;
}

function base(title: string, source: string, outputDirectory: string): CreatorManifest {
  return {
    schemaVersion: CREATOR_SCHEMA_VERSION,
    title,
    outputDirectory,
    clips: [{ id: "main", source, reframe: "blur-background", transition: { type: "fade", durationSeconds: 0.35 } }],
    captions: { burn: true, sidecar: true, language: "en", style: { position: "bottom", accent: "#22D3EE" } },
    audio: { keepClipAudio: true, clipVolume: 1, duckMusic: true, targetLufs: -14, truePeak: -1.5 },
    exports: [{ id: "youtube", preset: "youtube-1080p" }, { id: "shorts", preset: "shorts" }, { id: "reels", preset: "reels" }, { id: "tiktok", preset: "tiktok" }],
  };
}

export function createTemplateManifest(id: CreatorTemplateId, options: TemplateOptions = {}): CreatorManifest {
  const title = options.title ?? "Untitled creator project";
  const source = options.source ?? "./media/main.mp4";
  const output = options.outputDirectory ?? "./creator-output";
  const manifest = base(title, source, output);
  switch (id) {
    case "product-demo":
      manifest.description = "A polished browser or product walkthrough with a lower third and call to action.";
      manifest.clips[0]!.reframe = "fit";
      manifest.overlays = [
        { id: "brand", type: "lower-third", text: title, subtitle: "Product tour", startSeconds: 0.4, endSeconds: 5, x: 0.3, y: 0.78 },
        { id: "cta", type: "cta", text: "Try it today", startSeconds: 20, endSeconds: 25, x: 0.5, y: 0.82 },
      ];
      return manifest;
    case "product-launch": {
      const launch = createPromptVideoManifest({
        prompt: "Introduce the product, reveal the core benefit, show proof, and close with a clear call to action.",
        mode: "product-launch",
        title,
        source: options.source,
        presenter: "aria",
      });
      launch.outputDirectory = output;
      return launch;
    }
    case "cartoon-story": {
      const cartoon = createPromptVideoManifest({
        prompt: "Nova discovers a creative idea, Milo helps test it, and together they share what they learned.",
        mode: "cartoon",
        title,
        source: options.source,
        presenter: "nova",
      });
      cartoon.outputDirectory = output;
      return cartoon;
    }
    case "narrated-story": {
      const story = createPromptVideoManifest({
        prompt: "A curious traveler follows a glowing path, overcomes a challenge, and returns with a hopeful lesson.",
        mode: "story",
        title,
        source: options.source,
        presenter: "nova",
      });
      story.outputDirectory = output;
      return story;
    }
    case "asmr": {
      const asmr = createPromptVideoManifest({
        prompt: "A calming glass-and-water sensory sequence with gentle movement, spacious sound, and no narration.",
        mode: "asmr",
        title,
        source: options.source,
        presenter: "none",
      });
      asmr.outputDirectory = output;
      return asmr;
    }
    case "vfx-showcase": {
      const vfx = createPromptVideoManifest({
        prompt: "Transform the footage through cinematic color, neon energy, analog texture, and a glitch finale.",
        mode: "vfx",
        title,
        source: options.source,
        presenter: "none",
      });
      vfx.outputDirectory = output;
      return vfx;
    }
    case "feature-reel":
      manifest.description = "A fast feature montage designed for several social outputs.";
      manifest.clips = [0, 1, 2].map((index) => ({ id: `feature-${index + 1}`, source: index ? `./media/feature-${index + 1}.mp4` : source, speed: 1.08, reframe: "fill", transition: { type: index % 2 ? "slide-left" : "dissolve", durationSeconds: 0.3 }, chapter: `Feature ${index + 1}` }));
      return manifest;
    case "launch-short":
      manifest.description = "A vertical launch video with an immediate hook and CTA.";
      manifest.exports = [{ id: "shorts", preset: "shorts" }, { id: "reels", preset: "reels" }, { id: "tiktok", preset: "tiktok" }];
      manifest.overlays = [
        { id: "hook", type: "text", text: "Meet the faster way", startSeconds: 0, endSeconds: 2.8, x: 0.5, y: 0.18, fontSize: 72 },
        { id: "cta", type: "cta", text: "See it in action", startSeconds: 8, endSeconds: 12, x: 0.5, y: 0.78 },
      ];
      return manifest;
    case "tutorial":
      manifest.description = "A paced educational tutorial with chapters and accessible captions.";
      manifest.clips[0]!.reframe = "fit";
      manifest.chapters = [{ title: "Introduction", startSeconds: 0 }];
      return manifest;
    case "talking-head":
      manifest.description = "A clean presenter edit with punch-in reframing and captions.";
      manifest.clips[0]!.reframe = "fill";
      manifest.exports = [{ id: "youtube", preset: "youtube-1080p" }, { id: "vertical", preset: "shorts" }];
      return manifest;
    case "podcast-clip":
      manifest.description = "A voice-forward podcast excerpt formatted for vertical platforms.";
      manifest.exports = [{ id: "podcast", preset: "podcast-vertical" }, { id: "square", preset: "square" }];
      manifest.captions!.style = { position: "middle", fontSize: 58, accent: "#A78BFA", maxCharactersPerLine: 30, maxLines: 3 };
      return manifest;
    case "testimonial":
      manifest.description = "A customer quote with branded lower-third attribution.";
      manifest.overlays = [{ id: "speaker", type: "lower-third", text: "Customer name", subtitle: "Role · Company", startSeconds: 1, endSeconds: 7, x: 0.3, y: 0.78 }];
      return manifest;
    case "before-after":
      manifest.description = "A two-part comparison with a visual transition between states.";
      manifest.clips = [
        { id: "before", source, reframe: "fill", chapter: "Before" },
        { id: "after", source: options.secondarySource ?? "./media/after.mp4", reframe: "fill", chapter: "After", transition: { type: "wipe-left", durationSeconds: 0.5 } },
      ];
      manifest.overlays = [
        { id: "before-label", type: "text", text: "BEFORE", startSeconds: 0, endSeconds: 4, x: 0.5, y: 0.12 },
        { id: "after-label", type: "text", text: "AFTER", startSeconds: 4, endSeconds: 9, x: 0.5, y: 0.12 },
      ];
      return manifest;
  }
}

export function listCreatorTemplates(): CreatorTemplate[] {
  const descriptions: Record<CreatorTemplateId, string> = {
    "product-demo": "Browser and SaaS walkthroughs with brand cards and CTA.",
    "feature-reel": "Fast multi-clip feature montage for a product launch.",
    "launch-short": "Hook-first vertical launch video.",
    tutorial: "Long-form educational walkthrough with chapters.",
    "talking-head": "Presenter video with captions and multi-format exports.",
    "podcast-clip": "Caption-led vertical or square podcast excerpt.",
    testimonial: "Customer story with speaker attribution.",
    "before-after": "Two-state comparison with a wipe reveal.",
    "product-launch": "Cinematic launch narrative with a synthetic presenter, reveal, proof, and CTA.",
    "cartoon-story": "Animated character story with speech bubbles, motion, narration, and music.",
    "narrated-story": "Illustrated story video with narration, captions, and atmospheric motion.",
    asmr: "Calm sensory video with original local soundscape generation and soft visual treatment.",
    "vfx-showcase": "Multi-look VFX sequence with glow, neon, glitch, VHS, grading, and transitions.",
  };
  const presets: Record<CreatorTemplateId, CreatorTemplate["recommendedPresets"]> = {
    "product-demo": ["youtube-1080p", "shorts"],
    "feature-reel": ["reels", "shorts", "tiktok"],
    "launch-short": ["reels", "shorts", "tiktok"],
    tutorial: ["youtube-1080p", "youtube-4k"],
    "talking-head": ["youtube-1080p", "shorts"],
    "podcast-clip": ["podcast-vertical", "square"],
    testimonial: ["portrait", "reels"],
    "before-after": ["reels", "shorts", "square"],
    "product-launch": ["youtube-1080p", "reels", "shorts"],
    "cartoon-story": ["youtube-1080p", "shorts"],
    "narrated-story": ["youtube-1080p", "reels"],
    asmr: ["youtube-1080p", "reels"],
    "vfx-showcase": ["youtube-1080p", "reels", "shorts"],
  };
  return (Object.keys(descriptions) as CreatorTemplateId[]).map((id) => ({
    id,
    label: id.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "),
    description: descriptions[id],
    recommendedPresets: presets[id],
    manifest: createTemplateManifest(id),
  }));
}
