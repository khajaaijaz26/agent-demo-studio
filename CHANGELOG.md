# Changelog

All notable changes to Agent Demo Studio are documented here.

## Unreleased

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
