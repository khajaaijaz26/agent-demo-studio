# Local AI, open assets, and fastest generation

Agent Demo Studio can run its planning, asset handoff, speech, music, editing,
VFX, captions, and rendering on the creator's machine. Hosted LLM keys are not
read by the local planner.

## Fast path

The default `auto` / `fast` path is intentionally bounded:

1. Create the complete deterministic production contract.
2. Make at most one structured call to the smallest useful installed Qwen model.
3. Keep resource selection, rights, timing, layout, transitions, and QA rules
   deterministic so the model cannot invent file paths or bypass a gate.
4. Keep the model loaded for 30 minutes.
5. Cache successful plans in memory for 30 minutes, so the normal review-plan
   then build/render flow does not run Qwen twice.
6. Fall back to the instant deterministic planner if Ollama is missing, slow, or
   returns invalid JSON.
7. Generate local speech and procedural music, then render with FFmpeg.

This makes the ordinary text-to-video path usable without a media foundation
model: the plan drives bundled or uploaded visuals, typography, animation,
characters, effects, voice, captions, and music. Uploaded still images become
stable image-to-video shots through reframing, transitions, and VFX; optional
timeline motion can be enabled for art that has no locked text, faces, or UI.

Narration is synthesized into separate scene tracks and placed at the start of
the matching visual beat. Captions use the same offsets. If an exact narration
script is provided, its sentences are distributed across the planned scenes and
the local planner may not rewrite them.

Install and inspect the recommended local planner:

```bash
ollama pull qwen3.5:0.8b
agent-demo creator local-ai
agent-demo creator local-ai --warm --profile fast
```

`qwen3.5:0.8b` is the speed default. `--planner-profile quality` prefers an
installed `qwen3.5:4b`. Use `--planner deterministic` for an immediate plan with
no model inference. Ollama is accepted only on `localhost`, `127.0.0.1`, or
`::1`; model names containing `cloud` are rejected.

```bash
agent-demo creator prompt \
  "Create a one-minute animated lesson about fractions for ages eight to ten" \
  --mode cartoon --planner auto --planner-profile fast --render
```

Environment settings:

```dotenv
AGENT_DEMO_PLANNER_PROVIDER=auto
AGENT_DEMO_PLANNER_PROFILE=fast
AGENT_DEMO_OLLAMA_URL=http://127.0.0.1:11434
AGENT_DEMO_OLLAMA_MODEL=qwen3.5:0.8b
AGENT_DEMO_OLLAMA_KEEP_ALIVE=30m
```

Qwen supplies text planning only. It is not presented as an image, animation,
voice-cloning, or diffusion-video model.

## No fixed cast or subject

Aria, Leo, Nova, Milo, and the bundled scenes are optional offline starter
assets. They are not a closed character list. A prompt job can take any number
of local scene images/videos and authorized character images, plus a logo and
music:

```bash
agent-demo creator prompt \
  "Teacher Sam and a fox helper explain equivalent fractions" \
  --mode cartoon \
  --scene-sources ./board.png,./paper-shapes.png \
  --characters ./teacher-sam.png,./fraction-fox.png \
  --logo ./school-logo.png \
  --music-source ./gentle-score.wav \
  --render
```

The local Studio supports the same inputs through file uploads. Uploads are
stored below the selected Agent Demo Studio home, never in a connected product
repository. Each external asset receives a resource and rights record.

## Local text/image/video generation adapter

For Stable Diffusion, FLUX, ComfyUI workflows, AnimateDiff, Stable Video
Diffusion, or another installed generator, select `local-adapter`. Agent Demo
Studio sends one batch request so the backend can optimize its queue:

```bash
agent-demo creator prompt \
  "An original watercolor story about the water cycle" \
  --mode story \
  --media-provider local-adapter \
  --media-task text-to-image \
  --media-adapter-url http://127.0.0.1:8188/v1/media/generate \
  --render
```

Tasks are `text-to-image`, `image-to-video`, and `text-to-video`. `auto` chooses
image-to-video when source media exists and text-to-image otherwise. The fast
recommendation is text-to-image plus Agent Demo Studio motion; full diffusion
video is available through the adapter but is normally much slower.

The loopback adapter receives JSON shaped like:

```json
{
  "protocol": "agent-demo-local-media-v1",
  "task": "text-to-image",
  "outputDirectory": "C:/.../generated-media",
  "title": "Fraction Friends",
  "mode": "cartoon",
  "brief": "...",
  "targetDurationSeconds": 36,
  "sourcePaths": [],
  "scenes": [
    {
      "id": "scene-1",
      "title": "Hook",
      "visual": "...",
      "durationSeconds": 10.08,
      "narration": "...",
      "onScreenText": "..."
    }
  ],
  "performance": "fast"
}
```

It writes files locally and responds with:

```json
{
  "outputs": [
    {
      "path": "C:/.../scene-1.png",
      "kind": "image",
      "model": "local-model-name",
      "prompt": "final generation prompt",
      "rights": "model and output license summary"
    }
  ]
}
```

Only loopback endpoints are accepted. Agent Demo Studio verifies that every
returned path is readable before adding it to the timeline.

## Consented local voice profiles

System voices remain the fastest built-in choice. An optional loopback adapter
can wrap a locally installed XTTS, F5-TTS, OpenVoice, or equivalent engine. A
voice reference, named speaker, and confirmed authorization are mandatory:

```bash
agent-demo creator prompt \
  "Create a narrated lesson introduction" \
  --mode story \
  --voice-provider local-clone \
  --voice-reference ./teacher-reference.wav \
  --voice-speaker "Teacher Amina" \
  --voice-consent \
  --voice-clone-url http://127.0.0.1:8020/v1/voice/clone \
  --render
```

The adapter receives `text`, `outputPath`, `referenceAudioPath`, `speakerName`,
`consentScope`, `voice`, `rate`, and `language`. It may return audio bytes,
`audioBase64`, or a readable local `outputPath`. Remote endpoints and cloning
without recorded speaker authorization are rejected. Reference recordings stay
local and are never included in publishing packages.

## Non-negotiable production rules

Every production plan contains machine-readable rules that the local Qwen pass
cannot modify:

- plan and persist before media work;
- allow open supplied/generated assets instead of forcing bundled characters;
- track provenance, rights, consent, and synthetic disclosure;
- align visuals, captions, effects, and character action with narration;
- enforce safe zones and prevent overlap in every aspect ratio;
- keep speech natural and music/effects below narration;
- prefer on-device providers and require no paid model token;
- complete visual/technical QA before a separate publishing operation.

Local creation proceeds autonomously after the request. External publishing is a
separate explicit operation because it changes third-party state.
