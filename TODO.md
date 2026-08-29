# Agent Demo Studio roadmap

This backlog records the work that follows the v0.4 local-Qwen, open-assets,
terminal-dashboard, prompt-video, ASMR, product-launch, and VFX milestone. It
includes a feature audit of [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) at commit `0df0ef4ac2d725c79fa53bfe072063ee9cdfba80` (2026-08-26).

The comparison is architectural and product research. No MoneyPrinterTurbo source or bundled media is copied into Agent Demo Studio. MoneyPrinterTurbo is MIT licensed, but any future direct code reuse must retain its copyright and license notice. External media, voice, music, model, and publishing providers keep their own terms and costs.

## P0 — shipped foundation

- [x] Make every prompt-video request produce requirements, visual direction, a
  storyboard, resource/provenance list, workflow, assumptions, and QA gates before
  it creates media or renders.
- [x] Finish Studio prompt controls and MCP/CLI parity.
- [x] Complete product-launch, cartoon, story, ASMR, and VFX templates.
- [x] Validate fictional presenter/character animation, video overlays, chroma key, image motion, transitions, captions, and layered audio with real renders.
- [x] Add generated-asset provenance, synthetic-character disclosure, examples, and manifest documentation.
- [x] Run unit, smoke, package, install, security, and visual QA checks.
- [x] Push, tag, and verify v0.3.0 plus the v0.3.1 dense-timeline compatibility patch; reinstall Codex and Claude Code integrations.
- [x] Align authored narration and captions to their matching scene starts,
  preserve locked uploaded plates, and rasterize SVG sources portably.

## Existing strengths to preserve

- [x] Native MCP tools for Codex, Claude Code, and compatible agents.
- [x] Live Playwright browser recording and semantic product-demo actions.
- [x] Portable, validated, non-destructive creator manifest.
- [x] Ten delivery profiles from 1080p and 4K YouTube to Shorts, Reels, TikTok, Stories, square, portrait, LinkedIn, and podcast vertical.
- [x] Twenty-eight transitions, image motion, animated overlays, fictional presenters, cartoon characters, video overlays, and chroma key.
- [x] Ten composable VFX looks: cinematic, glow, neon, glitch, VHS, dream, vintage, noir, comic, and ASMR soft.
- [x] Product launch, cartoon, narrated story, ASMR, VFX, browser demo, tutorial, podcast, testimonial, and social templates.
- [x] Layered narration, music, ambience, sound effects, ducking, loudness normalization, captions, chapters, thumbnails, packaging, and asset-rights reports.
- [x] Explicit publishing through official YouTube, TikTok, and Instagram APIs with confirmation and synthetic-media metadata.

## P1 — content intelligence and material pipeline

- [x] Add a zero-token loopback Ollama/Qwen planner with strict structured output,
  one-call fast mode, model keep-alive, transparent timing/token metadata, and an
  instant deterministic fallback.
- [x] Remove the fixed-cast assumption: accept unlimited authorized character and
  scene uploads, plus logos and music, across the shared prompt contract.
- [x] Add one-batch loopback handoff contracts for local text-to-image,
  image-to-video, and text-to-video engines while keeping rendering vendor-neutral.
- [x] Add an interactive free terminal dashboard and standalone original local
  ambient/ASMR music generation alongside MCP and visual Studio controls.
- [ ] Add a provider-neutral LLM interface for structured scripts, hooks, scenes, search terms, narration, CTAs, titles, descriptions, and hashtags.
- [ ] Support OpenAI-compatible endpoints first, then optional Anthropic, Gemini, Ollama, LiteLLM, Azure, Qwen, DeepSeek, Groq, and other adapters without coupling the core renderer to any vendor.
- [ ] Upgrade the deterministic three-act production plan into a provider-neutral,
  model-assisted detailed beat sheet and shot list with claim/evidence validation.
- [ ] Add multilingual script generation, language detection, translation variants, locale-aware voices, and right-to-left caption QA.
- [ ] Add Pexels, Pixabay, and Coverr search/download adapters with source-page, creator, license, rendition, and proof metadata.
- [ ] Add local media-library indexing, upload management, orientation/duration filters, deduplication, and reusable collections.
- [ ] Match footage to script order and individual narration beats; preserve a manual reorder override.
- [ ] Add material search/download caching, cache statistics, safe cleanup, proxy configuration, retry/backoff, and API-key rotation.
- [ ] Add optional semantic ranking and video QA adapters, including TwelveLabs-compatible reranking/analysis, behind explicit provider configuration.
- [ ] Add pluggable image-to-video and text-to-video providers, starting with a generic asynchronous job adapter and an optional WaveSpeed-compatible implementation.
- [x] Let local image/video-generation agents create per-shot art through a documented batch asset handoff instead of limiting prompt videos to bundled scenes.

## P2 — voice, captions, music, and audio direction

- [x] Add a loopback-only local voice-profile adapter with mandatory named-speaker
  consent metadata and support for uploaded reference audio.
- [ ] Introduce a TTS provider registry with voice discovery, preview, credential checks, retries, and normalized rate/pitch/volume controls.
- [ ] Keep local OS speech and Edge TTS, then add optional Azure Speech, Gemini TTS, ElevenLabs, Fish Audio, Chatterbox-compatible, SiliconFlow, MiniMax, and MiMo adapters.
- [ ] Use provider speech-boundary timestamps when available and forced alignment/Whisper when they are not.
- [ ] Add word-level animated captions, karaoke highlighting, outline/shadow, rounded backgrounds, custom fonts, exact positioning, safe-zone collision checks, and reusable caption themes.
- [ ] Add dialogue tracks with per-character voices, scene-level casting, conversational pacing, pauses, breaths, and speaker-aware captions.
- [ ] Add a music provider registry: bundled royalty-cleared library, user uploads, procedural local score, Sonilo-compatible generation, and ElevenLabs video-to-music.
- [ ] Add automatic score structure, beat markers, beat-synced cuts, loop-point detection, stems, side-chain ducking presets, and loudness profiles per platform.
- [ ] Add an SFX library/search layer with license metadata, scene cues, spatial pan, ambience beds, and ASMR-specific close-mic sound recipes.
- [ ] Add optional phoneme/viseme timelines and provider-neutral lip-sync for compatible animated or video avatars; never imply lip-sync for still-image motion.

## P3 — batch production, reliability, and deployment

- [ ] Generate multiple creative variants from one brief with deterministic seeds, shared assets, per-variant manifests, comparison previews, and a selection workflow.
- [ ] Add persistent jobs, concurrency limits, cancellation, retries, resumable stages, task history, artifact retention, and failed-stage diagnostics.
- [ ] Add SQLite as the default job store and an optional Redis queue/worker backend for teams.
- [ ] Add production REST endpoints with OpenAPI, authentication, request limits, safe file streaming/ranges, webhook callbacks, and the same contracts as MCP/CLI.
- [ ] Add a provider/credential settings UI with connection tests, environment-variable references, redacted export, and encrypted local storage.
- [ ] Export/import non-secret creator presets. Never place raw API keys in ordinary preset or project files.
- [ ] Add asset upload validation, safe path handling, MIME probing, quotas, cleanup policies, and an auditable project media bin.
- [ ] Add hardware encoder detection and graceful fallback for NVENC, AMF, Quick Sync, Media Foundation, and VideoToolbox.
- [ ] Add CPU/GPU capability reporting, render benchmarking, proxy renders, render cache reuse, and interrupted-render recovery.
- [ ] Provide Docker and Docker Compose images, optional GPU worker profiles, a headless server image, and a documented Colab/notebook path.
- [ ] Ship signed Windows/macOS installers after the npm/MCP workflow remains the canonical portable installation.
- [ ] Expand automated tests across Windows, macOS, and Linux plus representative FFmpeg builds and hardware encoders.

## P4 — delivery, analytics, and ecosystem

- [ ] Generate platform-aware titles, descriptions, captions, hashtags, chapters, thumbnails, disclosure text, and posting schedules from the approved project content.
- [ ] Add reviewed batch publishing and cross-post status tracking while retaining explicit user confirmation; do not enable silent auto-publishing by default.
- [ ] Add an optional Upload-Post-compatible adapter alongside the existing official platform integrations.
- [ ] Add upload retry/resume, rate-limit handling, scheduled release jobs, webhook status updates, and immutable publishing receipts.
- [ ] Add accessibility QA: caption coverage, contrast, reading speed, flashing-risk checks, audio peaks, silence, and safe-zone checks.
- [ ] Add content QA: duplicate shots, mismatched narration/visuals, spelling, logo visibility, CTA timing, synthetic-media disclosures, and rights completeness.
- [ ] Add project-level cost estimates and actual usage accounting for paid LLM, TTS, music, stock, semantic-analysis, and generated-video providers.
- [ ] Add a plugin SDK for asset sources, script models, voices, music, image/video generation, VFX, exporters, and publishing destinations.
- [x] Add a provider capability registry so agents can discover what is local,
  installed, configured, network-dependent, governed by provider terms, or
  unavailable before planning a render; persist the request-aware gate in every
  smart production plan and expose it through CLI, MCP, Studio, and dashboard.

## Deliberate product differences

- Publishing stays reviewable and explicitly confirmed, even when batch and scheduled workflows are added.
- Secrets stay outside portable manifests; exports contain references and redacted diagnostics only.
- Every downloaded or generated asset must carry provenance and license/terms metadata.
- Realistic presenters must be authorized or fictional synthetic assets and must support disclosure metadata. Identity impersonation is out of scope.
- Cloud generation is optional. The editor, renderer, manifest, bundled assets, procedural audio, and browser recorder continue to work locally.

## Completion definition for the parity backlog

- [ ] Each provider family has a documented interface, at least one tested implementation, an offline fallback where practical, and clear cost/terms messaging.
- [ ] CLI, MCP, Studio, and REST expose the same core workflow and return stable artifact paths.
- [ ] A topic-only request can produce a script, sourced or generated shots, narration, captions, music, multiple variants, QA results, and reviewed delivery packages.
- [ ] A browser-demo request can combine live capture with stock/generated B-roll, presenters, VFX, and platform-specific social derivatives in the same project.
- [ ] All output includes machine-readable provenance, synthetic-media flags, and a human-readable asset-rights report.
