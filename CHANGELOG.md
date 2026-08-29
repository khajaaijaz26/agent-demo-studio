# Changelog

All notable changes to Agent Demo Studio are documented here.

## 0.6.2 - 2026-08-29

### Changed

- Made the visual Studio start with its truthful, immediately available local
  animation engine; Wan/LTX-class generation remains an explicit model-backed
  quality choice.
- Made explicit YouTube Shorts, Instagram Reels, TikTok, vertical, and square
  wording select the matching export rather than leaving the default at 16:9.
- Added portrait-safe character staging and native 1080×1920 local animation
  plates for vertical-only Shorts, Reels, and TikTok productions.

### Fixed

- Kept short status and help follow-ups such as `what happened` in the Studio
  conversation instead of creating a second malformed video project.
- Replaced the raw missing-LTX blocker with a plain-language explanation,
  preserved technical details and plan path, and added a one-click local
  animation retry.
- Preserved compound animals, planted objects, plural lanterns, and recurring
  cast in cartoon scene graphs; concrete scenes no longer show redundant
  placeholder concept cards.
- Prevented multi-character portrait scenes from covering their focal story
  props by assigning props and cast to separate mobile-safe visual bands.
- Corrected the water-cycle keyword matcher so `rainbow` can never be mistaken
  for `rain` and produce an unrelated precipitation caption.

## 0.6.1 - 2026-08-29

### Added

- An honest visual-quality contract: generative requests now require LTX,
  ComfyUI/Wan, or a model-backed loopback worker and never silently become the
  deterministic motion-graphics renderer.
- Open prompt concepts and semantic scene graphs so explicit laptop motion
  graphics remain scene-specific even when a subject is outside the bundled
  starter vocabulary.
- Automatic production-treatment inference across Studio, CLI, and MCP while
  retaining unrestricted prompts, uploaded casts, and media-model inputs.
- BCP-47 narration/caption language selection and automatic multilingual neural
  voice defaults while keeping arbitrary provider voice names and consented local
  clones available.
- A general `AGENT_DEMO_WAN_VIDEO_ADAPTER_URL` alias and expanded scene-batch
  request containing character references, style, negative prompt, seed,
  language, audio, camera, transitions, and export targets.

### Fixed

- Replaced the repeated mode-level cartoon/story loop with prompt-conditioned
  settings, articulated people and animals, planned actions, moving props, open
  concept visuals, and scene semantic QA.
- Prevented running characters from leaving the frame, strengthened celebration
  and treasure motion, and faded title ribbons clear of scene transitions.
- Required local generative workers to return exactly one uniquely addressed,
  moving, non-duplicate video per planned scene before timeline assembly.
- Forwarded uploaded character references to LTX Desktop and ComfyUI instead of
  dropping them from model generation.
- Rejected local-Qwen scenes whose visual and narration disagree or whose content
  belongs to a different storyboard beat, while preserving useful single-topic
  expansions such as evaporation, clouds, and rain.
- Brought the terminal dashboard to parity with universal auto-treatment,
  model-engine/task selection, language, and arbitrary provider voice names.

## 0.6.0 - 2026-08-29

### Added

- Chat-first responsive Studio with one-prompt creation, attachment uploads,
  sidebar production tools, engine status, in-chat plan/progress, preview,
  downloads, and artifact paths.
- Real local 1080p vector video generation with articulated characters, blinking,
  gestures, mouth motion, moving props/particles, stable backgrounds, editable
  scene HTML, and education-aware animated diagrams.
- Official LTX Desktop localhost integration for text-, image-, and audio-to-video
  with local/API-only detection and explicit paid-mode opt-in.
- ComfyUI API-workflow integration with prompt/input placeholders, image/audio
  upload, queue/history handling, and local output download.
- Temporal motion QA that rejects frozen, low-resolution, low-frame-rate,
  too-short, and isolated-jump outputs before timeline assembly.
- Wan-Animate-2 discovery that distinguishes metadata-only Git/Xet clones,
  materialized 82.5 GB weights, and loopback adapter configuration.

### Changed

- Automatic media routing now prefers true video for generative or reference-
  image requests and uses the moving-vector engine as the ordinary-laptop
  fallback. The legacy still compositor is explicit-only.
- Local media protocol v2 supports text/image/speech-to-video and character
  animation, scene audio inputs, and requires one real video per scene for video
  tasks.
- Authored narration now controls visible teaching copy; scene duration expands
  around natural speech instead of accelerating narration.
- Landscape captions are larger and character staging reserves their safe zone.
- Audio limiting disables auto-level compensation and reserves AAC codec
  headroom so decoded delivery masters respect the configured true-peak ceiling.

### Fixed

- Removed duplicated opening titles over provider-owned scene typography.
- Prevented prompt production directions from appearing as lesson-board copy.
- Removed camera-shake and pan/zoom substitution from still-image video requests.
- Corrected LTX API-mode provenance so cloud generations are not labeled local.

## 0.5.0 - 2026-08-29

### Added

- Provider-neutral capability registry for planners, browser recording, built-in
  and loopback visual engines, local/neural/cloned voices, captions, procedural
  music, FFmpeg/FFprobe, and Codex/Claude integrations.
- Request-aware readiness, local/network/cost classification, exact blockers,
  and setup guidance through `agent-demo capabilities`, `demo_capabilities`, the
  terminal dashboard, the Studio API, and the visual Creator panel.
- Capability snapshots inside every smart `production-plan.json` so agents can
  prove that selected resources are available before creating media.

### Changed

- Complete prompt jobs now save the production plan and stop before generation
  when a selected required capability is unavailable. Missing local tools are
  never silently replaced with hosted or paid providers.
- MCP agent instructions now require capability discovery before production
  planning, while the deterministic local planner remains the guaranteed
  zero-token fallback for automatic planning.

## 0.4.0 - 2026-08-29

### Added

- Zero-token loopback Ollama/Qwen planning with a speed-first 0.8B profile, one
  structured generation call, 30-minute keep-alive, quality profile, diagnostics,
  warmup, and an instant deterministic fallback across CLI, MCP, and Studio.
- Open prompt assets: unlimited uploaded scene and character media, logos, music,
  image-to-video motion, resource provenance, and optional bundled starter assets.
- Loopback batch adapter contract for locally installed text-to-image,
  image-to-video, and text-to-video engines.
- Consent-gated local voice-profile adapter and Studio reference-audio uploads.
- Interactive free terminal dashboard plus standalone ambient/ASMR music creation
  through CLI, MCP, Studio, and the dashboard.
- Machine-readable fixed production rules covering plan-first creation, open
  assets, rights, scene/audio alignment, safe layout, natural audio, local-first
  execution, QA, and review-before-publish.

### Changed

- Prompt narration is now derived from the locally refined scene plan and that
  same plan is retimed after speech synthesis instead of being regenerated.
- Narration is synthesized per scene and placed at the matching visual beat;
  captions use those same scene offsets, and authored scripts remain locked.
- Bundled characters are optional starters; prompt creation defaults to no fixed
  host and accepts an open cast.
- Uploaded scene plates remain stable by default so authored UI, labels, and
  faces are not cropped by automatic pan or zoom motion.

### Fixed

- Preserve explicitly authored image-overlay dimensions up to the full export
  canvas instead of applying decorative-overlay size caps. This keeps native
  scene plates, product screens, and brand artwork locked to their designed
  positions in the encoded video.
- Rasterize SVG scene inputs automatically before FFmpeg encoding for consistent
  Windows, macOS, and Linux rendering.

## 0.3.1 - 2026-08-26

### Fixed

- Write dense final-composite filter graphs to UTF-8 script files so animated,
  multi-layer timelines do not exceed Windows command-line limits.
- Select the compatible FFmpeg file-loading option for both FFmpeg 6 and FFmpeg
  7 or newer.
- Centralize the CLI, MCP, and Studio version reported by the package.

## 0.3.0 - 2026-08-26

Plan-first prompt-video, animation, character, audio, and VFX release.

### Added

- Mandatory pre-production plan for prompt jobs with requirements, creative
  direction, timed storyboard, resource/provenance list, workflow, assumptions,
  and quality gates written before media generation
- Product-launch, cartoon, narrated-story, ASMR, and VFX prompt modes across CLI,
  MCP, and Studio, bringing the maintained template catalog to 13
- Eight original bundled synthetic assets: fictional presenters Aria and Leo,
  original cartoon hosts Nova and Milo, and four scene environments
- Stable `builtin:` asset URIs plus catalog discovery, automatic licensing records,
  checksums, source prompts, and synthetic-character disclosure metadata
- Nine overlay entrance/exit animations, seven continuous loops, seven image-motion
  options, fictional presenter/character and speech-bubble layers, and video layers
  with loop, flip, opacity, and chroma key
- Eleven additional transitions for a total of 28 and ten composable local VFX looks
- Layered voices, ambience, sound effects, stereo pan, mix modes, and a procedural
  local ASMR soundscape generator
- `creator plan`, `creator assets`, and `creator prompt` commands plus matching
  `demo_creator_plan`, `demo_creator_assets`, and `demo_creator_from_prompt` tools
- Studio plan review, prompt controls, characters, voices, modes, resources, and
  build/render workflow
- MoneyPrinterTurbo feature comparison and provider-neutral parity roadmap

### Changed

- Creator manifest contract increased to schema version 2
- Image cutouts are normalized to their natural alpha bounds before compositing,
  preventing transparent padding from becoming black bands during animation
- Prompt timelines account for transition overlap and narration duration so speech
  is not accelerated merely to meet a requested target
- Package and MCP version increased to 0.3.0

## 0.2.0 - 2026-08-26

Creator-engine release.

### Added

- Portable non-destructive creator manifest with semantic validation
- Eight editable project templates and ten export presets for YouTube, Shorts, Reels, TikTok, Stories, square, portrait, LinkedIn, podcasts, and 4K
- Multi-clip FFmpeg timeline with trims, images, constant speed, stepped speed ramps, freeze frames, reframing, focus points, effects, and 17 transitions
- Matching audio crossfades, clip/voice/music buses, music ducking, fades, gain, 48 kHz stereo output, loudness normalization, and limiting
- Timed text, lower-third, CTA, image, and watermark graphics rendered with Sharp
- SRT/WebVTT parsing, scalable ASS burn-in, SRT sidecars, and optional local Whisper transcription
- Silence and scene-change analysis with suggested highlight ranges
- Multi-format remix command, output validation, thumbnails, chapters, and asset-rights reports
- Reviewed publishing packages and explicit credentialed adapters for YouTube, TikTok, and Instagram
- Creator commands and nine creator tools across the CLI and MCP server
- Redesigned local Studio with demo/creator workspaces, JSON timeline editor, templates, presets, jobs, preview, and packaging
- Real FFmpeg creator smoke test, expanded unit coverage, release automation, Dependabot, and third-party notices

### Changed

- Package and MCP version increased to 0.2.0
- README and contributor documentation rewritten around the unified recorder and creator workflow
- Scene-synchronized neural narration remains available for natural-rate, multi-voice demo masters

## 0.1.0 - 2026-08-25

Initial open-source browser-first release.

- Codex and Claude Code MCP setup
- Live Playwright screencast sessions
- Scripted end-to-end recording jobs
- Semantic actions, chapters, cursor, and click annotations
- Cinematic 1080p H.264 rendering
- Branded browser frame, intro, outro, and captions
- Local system voice-over
- Generated royalty-free ambient music
- Local visual Studio
- Portable project manifests and media artifacts
- Automated unit and real browser-to-video smoke tests
