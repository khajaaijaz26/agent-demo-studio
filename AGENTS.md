# Video-production rules for AI agents

These rules apply when Codex, Claude Code, or another agent uses this repository or
its MCP server to create a video.

## Never create blindly

Before recording, generating audio, assembling a timeline, or rendering, create a
production plan from the user's request. Use `demo_creator_plan`,
`agent-demo creator plan`, or the equivalent library function. The plan must cover:

1. The goal, intended audience, duration, output formats, narration, and source
   strategy.
2. Visual style, pacing, composition, characters, animation, transitions, and VFX.
3. A timed, scene-by-scene storyboard whose visuals match the active narration or
   sensory beat.
4. A complete resource list identifying supplied, bundled, generated, optional,
   and missing media plus its provenance and rights status.
5. The step-by-step production workflow, assumptions, and quality gates.

Persist the plan as `production-plan.json`. `demo_creator_from_prompt` and
`agent-demo creator prompt` do this automatically before media generation.

## Build from the plan

- Resolve required resources before the scene that needs them.
- Treat bundled characters and scenes as optional starters, never a fixed cast.
  Accept any authorized uploaded or locally generated characters and scene media
  required by the brief, and record their provenance.
- Build the editable manifest scene by scene; do not discard plan requirements.
- Keep narration at a natural pace and adjust scene duration instead of speeding
  speech unnaturally.
- Keep captions, titles, characters, lower thirds, and CTAs in separate readable
  regions and within each export's safe zones.
- Inspect representative frames and transitions for overlap, clipping, black bands,
  mismatched narration, and disclosure issues before declaring completion.
- Use a voice clone only through a loopback local adapter and only when the plan
  records the authorized speaker's name, confirmed consent, and intended scope.
- Prefer the smallest suitable local Qwen model for speed, make at most one
  planning inference per video, and preserve the deterministic fallback and fixed
  production rules.
- Return the plan, manifest, videos, captions, thumbnails, chapters, and rights
  report as local artifact paths.

Local planning, recording, generation, editing, and rendering may proceed as one
autonomous job when the user asks for a complete video. External publishing remains
an explicit, credentialed, reviewable action. Never place secrets in a prompt,
manifest, or production plan.
