# Local AI, open assets, and fastest generation

Agent Demo Studio can run its planning, asset handoff, speech, music, editing,
VFX, captions, and rendering on the creator's machine. Hosted LLM keys are not
read by the local planner.

## Inspect before producing

Run the request-aware registry before a standard local render:

```bash
agent-demo capabilities
```

Agents use the equivalent `demo_capabilities` MCP tool and the Studio displays
the same gate beside the Qwen status. The report distinguishes ready, configured,
and unavailable planners, recording, visuals, voices, captions, music, renderers,
and agent integrations. It also identifies the exact selected blockers and setup
commands without probing generation endpoints, moving media, or exposing secrets.

Every smart `production-plan.json` embeds this report. A complete prompt job saves
the plan and stops before generation when a required selected capability is
unavailable; it never silently replaces a missing local tool with a hosted one.

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

This makes the ordinary prompt-video path usable without a media foundation
model: the plan drives original vector scenes, independently moving characters,
props, particles, effects, voice, captions, and music. Uploaded reference images
route to a configured true image-to-video backend. If the legacy still
compositor is explicitly selected, artwork stays locked; the system never shakes,
pans, or zooms a photograph and calls it generated character motion.

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

## True-video providers and hardware truth

The visual provider and visual-quality policy default to `auto`:

- Model-video wording such as “video”, “cartoon”, “advertisement”, “realistic”,
  “Wan”, or “LTX” selects a real generative provider. If none is ready, the plan
  is saved with a blocker; motion graphics are never substituted silently.
- `animated` is the explicit zero-download motion-graphics tier. It records actual
  1080p/30fps canvas animation with separate limbs, gestures, blinking, mouth
  motion, diagrams, open prompt-concept cards, particles, and stable backgrounds.
- `ltx-desktop` calls the [official LTX Desktop](https://github.com/Lightricks/ltx-desktop)
  loopback API for text-, image-,
  or audio-to-video. Local Windows generation requires a supported NVIDIA CUDA
  system. API-only mode is never used unless `--allow-cloud-media` is explicit.
- `comfyui` submits an exported API workflow through the
  [official server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
  and supports LTX, Wan, or another
  installed video graph without hard-coding a checkpoint into Agent Demo Studio.
- `local-adapter` implements the provider-neutral scene batch below.
- `builtin` is a legacy locked-still compositor and is never auto-selected.

All real-video routes require video files for video tasks and run a temporal
motion check. Frozen clips, isolated frame jumps, too-short clips, low frame rate,
and under-resolution output are rejected before timeline assembly.

The [official Wan-Animate-2 model](https://huggingface.co/Wan-AI/Wan2.2-Animate-2-14B)
is specialized character animation: it needs a reference character
image and a driving video. It is not a general topic-to-video model. Its official
full checkpoint is 82.5 GB and the published 720p default targets 8× A800 GPUs
(480p was tested on 2× A800), so Agent Demo Studio distinguishes a tiny
metadata-only Git/Xet clone from materialized weights and a ready loopback
runtime. Point a GPU workstation adapter at the Studio with:

```dotenv
AGENT_DEMO_WAN_ANIMATE_MODEL_PATH=C:/models/Wan2.2-Animate-2-14B
AGENT_DEMO_WAN_ANIMATE_ADAPTER_URL=http://127.0.0.1:9000/v1/media/generate
```

The status card will remain `configured`, not `ready`, when only model pointers
are present. This prevents an agent from silently downloading tens of gigabytes
or claiming generation succeeded on unsupported hardware.

For a general Wan text/image-to-video worker implementing the batch contract
below (distinct from the specialized Animate-2 model), use the descriptive alias:

```dotenv
AGENT_DEMO_WAN_VIDEO_ADAPTER_URL=http://127.0.0.1:9000/v1/media/generate
```

This alias and `AGENT_DEMO_MEDIA_ADAPTER_URL` are equivalent. The worker may wrap
Wan, LTX, ComfyUI, or another model, but it must return one unique moving video
with the matching `sceneId` for every planned scene.

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
Diffusion, Wan, or another installed generator, select `local-adapter`. Agent
Demo Studio sends one batch request so the backend can optimize its queue:

```bash
agent-demo creator prompt \
  "An original watercolor story about the water cycle" \
  --mode story \
  --media-provider local-adapter \
  --media-task text-to-image \
  --media-adapter-url http://127.0.0.1:8188/v1/media/generate \
  --render
```

Tasks are `text-to-image`, `image-to-video`, `text-to-video`, `speech-to-video`,
and `character-animation`. `auto` chooses image-to-video when source media exists
and text-to-video otherwise. A video task must return at least one real video per
planned scene; still output is rejected rather than animated with fake camera
motion.

The loopback adapter receives JSON shaped like:

```json
{
  "protocol": "agent-demo-local-media-v2",
  "task": "text-to-video",
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
      "onScreenText": "...",
      "audioPath": "C:/.../voiceover-scene-01.wav",
      "camera": "wide",
      "transition": "fade"
    }
  ],
  "characterReferences": [
    {
      "id": "character-1",
      "name": "Any authorized uploaded character",
      "sourcePath": "C:/.../character.png",
      "role": "character",
      "style": "user-defined"
    }
  ],
  "generation": {
    "visualQuality": "generative",
    "negativePrompt": "jitter, duplicate characters",
    "seed": 73,
    "language": "ar-AE",
    "outputPresets": ["youtube-1080p"],
    "visualStyle": "the planned unrestricted style"
  },
  "performance": "fast"
}
```

It writes files locally and responds with:

```json
{
  "outputs": [
    {
      "path": "C:/.../scene-1.mp4",
      "kind": "video",
      "sceneId": "scene-1",
      "model": "local-model-name",
      "prompt": "final generation prompt",
      "rights": "model and output license summary"
    }
  ]
}
```

Only loopback endpoints are accepted. Agent Demo Studio verifies that every
returned path is readable, remains inside the requested output directory, and
meets the task's media and motion requirements before adding it to the timeline.
For video tasks it also requires exact scene-ID coverage, rejects duplicate scene
files, and writes `motion-quality.json` after checking every clip.

Direct ComfyUI configuration uses:

```dotenv
AGENT_DEMO_COMFYUI_URL=http://127.0.0.1:8188
AGENT_DEMO_COMFYUI_WORKFLOW=C:/workflows/video-api.json
```

The API workflow may use `{{PROMPT}}`, `{{NEGATIVE_PROMPT}}`, `{{WIDTH}}`,
`{{HEIGHT}}`, `{{FPS}}`, `{{FRAMES}}`, `{{DURATION}}`, `{{SEED}}`,
`{{SCENE_ID}}`, `{{INPUT_IMAGE}}`, and `{{INPUT_AUDIO}}` placeholders. Agent
Demo Studio uploads supplied image/audio inputs, submits `/prompt`, follows
`/history`, downloads output through `/view`, and runs the same motion gate.

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
