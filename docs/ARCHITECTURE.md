# Architecture

Agent Demo Studio is local-first and has one engine behind three control surfaces.

```mermaid
flowchart LR
  A[Codex / Claude Code / MCP client] --> M[MCP tools]
  B[Terminal] --> C[CLI]
  U[Local browser] --> S[Studio UI]
  M --> Q[Pre-production planner]
  C --> Q
  Q --> E[Shared TypeScript engine]
  S --> J[Local job server]
  J --> Q
  E --> R[Playwright recorder]
  E --> T[Creator timeline]
  E --> V[Voice and captions]
  E --> P[Packaging and publishers]
  R --> F[FFmpeg + Sharp]
  T --> F
  V --> F
  F --> O[Local media outputs]
  O --> P
```

## Main boundaries

| Area | Location | Responsibility |
|---|---|---|
| Browser capture | `src/browser/recorder.ts` | Visible/headless Chromium sessions, semantic actions, raw screencast |
| Demo workflow | `src/workflow.ts` | Project creation, capture, voice, and classic polished demo render |
| Pre-production | `src/creator/prompt.ts`, `assets.ts` | Requirements, storyboard, resources/provenance, prompt modes, and plan-first project creation |
| Classic renderer | `src/render/` | Branded browser frame, design assets, synchronized scene narration |
| Creator contract | `src/creator/types.ts`, `schema.ts` | Portable timeline, validation, and versioning |
| Creator renderer | `src/creator/renderer.ts` | Clip normalization, speed, transitions, compositing, audio, exports |
| Automation | `src/creator/media.ts`, `captions.ts` | Probe, silence/scenes, highlights, SRT/VTT/ASS, optional Whisper |
| Delivery | `src/creator/social.ts`, `publish.ts` | Profile checks, packages, and explicit platform adapters |
| Control surfaces | `src/cli.ts`, `src/mcp/server.ts`, `src/studio/` | Equivalent terminal, agent, and visual workflows |

## Render stages

1. For a prompt request, write requirements, creative direction, timed storyboard,
   resource/provenance list, assumptions, workflow, and QA gates to
   `production-plan.json` before media creation.
2. Resolve supplied, bundled, generated, and optional resources; generate enabled
   narration, captions, score, ambience, or ASMR audio.
3. Build, parse, and semantically validate the editable schema-v2 manifest.
4. Resolve sources relative to the manifest or through stable `builtin:` URIs.
5. Probe streams, duration, frame rate, and audio availability.
6. Normalize each clip to the selected canvas, 48 kHz stereo, and a common frame rate.
7. Apply trim, stepped speed ramp, reframe, freeze, image motion, VFX, and clip gain.
8. Compose clips with 28 video transitions and matching audio transitions.
9. Rasterize timed design/character assets, composite animated image/video/chroma
   layers, and compile captions to ASS.
10. Mix clip audio, layered voices, music, ambience, and SFX with optional ducking.
11. Normalize/limit audio, encode MP4, and add fast-start metadata.
12. Extract a thumbnail, write captions/chapters, validate the result, and emit rights metadata.

Intermediate media lives under the selected output's `.work` directory and is removed after a successful or failed run unless `keepWork` is enabled. Source media is never overwritten.

## Extension rules

- Add a new delivery shape in `presets.ts`; do not fork the renderer.
- Add an editing operation to the creator schema and compile it in the segment or final-composite stage.
- Keep the plan as the contract between an ambiguous prompt and a concrete timeline; never silently discard its resource or QA requirements.
- Keep provider integrations optional and isolated from the local rendering path.
- Never carry large media through model context; MCP returns local resource links.
- Preserve schema compatibility within a minor version or include an explicit migration.
