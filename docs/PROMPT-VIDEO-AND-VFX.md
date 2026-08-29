# Plan-first prompt video, characters, and VFX

Agent Demo Studio turns a short creative brief into a transparent local production
project. It deliberately writes the plan before it writes or renders the timeline.
This prevents an agent from treating an underspecified prompt as a finished script.

## The production contract

Every `creator prompt` job produces these artifacts in order:

1. `production-plan.json` — interpreted requirements, request-aware capability
   gate, creative direction, timed storyboard, narration intent,
   resource/provenance list, workflow, assumptions, and QA checklist.
2. Generated voice, captions, music, or ASMR ambience when enabled.
3. `creator-project.json` — the editable schema-v2 timeline derived from the plan.
4. `renders/` — platform videos, thumbnails, captions, chapters, validation data,
   and `ASSET-LICENSES.md` when `--render` is selected.

Agents should inspect the plan, replace generic assumptions when the brief provides
better information, resolve every missing or external resource, and then build the
timeline scene by scene. Interactive users can use `creator plan` or the Studio's
**Review plan** action. Fully autonomous jobs still persist the plan and use it as
the build contract; no approval prompt is required merely to continue locally.

The plan also contains non-modifiable production rules for open asset selection,
rights and consent, scene-to-narration alignment, safe layout, natural audio,
local-first execution, and review-before-publish. Optional local Qwen intelligence
can refine the audience and story beats, but it cannot replace or bypass those
rules.

```bash
agent-demo creator plan \
  "Launch a privacy-first lesson planner for busy teachers" \
  --mode product-launch --duration 45

agent-demo creator prompt \
  "Launch a privacy-first lesson planner for busy teachers" \
  --mode product-launch --presenter aria \
  --presets youtube-1080p,shorts,reels --render
```

Equivalent MCP tools are `demo_capabilities`, `demo_creator_plan`, and
`demo_creator_from_prompt`. The latter completes capability discovery and the same
planning stage before creating any media, stops after saving the plan if a selected
tool is missing, and returns the plan and local artifact resource links.

## Prompt modes

| Mode | Default direction | Bundled visual | Typical audio |
|---|---|---|---|
| `product-launch` | Cinematic reveal, benefit, proof, CTA | Launch stage plus optional Aria or Leo | Narration and procedural score |
| `cartoon` | Playful setup, exchange, resolution | Workshop plus Nova and Milo | Narration, speech bubbles, score |
| `story` | Atmospheric opening, discovery, reflection | Story forest plus optional narrator | Narration and gentle score |
| `asmr` | Slow tactile progression, minimal text | Macro glass/water scene | Procedural stereo soundscape, no default voice |
| `vfx` | Fast transformation and final reveal | Supplied media or launch stage | Narration and cinematic score |

The included characters and scenes are optional offline starters documented in
[`assets/README.md`](../assets/README.md). A `builtin:` URI resolves inside both a
source checkout and the packaged CLI, so agents do not need to locate installation
paths. They are not a fixed cast: prompt jobs accept any number of authorized
character images and scene images/videos. The Studio can upload these files into
its own local data directory.

## Animation and compositing

- Image motion: static, Ken Burns in/out, and four directional pans.
- Overlay entrances/exits: fade, four slides, pop, rise, and drop.
- Continuous loops: float, bounce, drift, shake, pulse, and subtle talk motion.
- Overlay layers: text, lower third, CTA, speech bubble, image, watermark,
  fictional presenter, cartoon character, and video.
- Video layers can loop, flip horizontally, change opacity, and remove a configured
  chroma-key color.
- Twenty-eight clip transitions cover fades, wipes, slides, smooth motion, shapes,
  zoom, squeeze, diagonal, blur, and directional reveals.

Still presenter/character assets receive 2D/2.5D cutout motion. A loopback local
media adapter can instead supply text-to-image, image-to-video, or text-to-video
outputs from an installed generation backend. Agent Demo Studio does not label
Qwen as the media generator. See [`LOCAL-AI.md`](LOCAL-AI.md) for the batch
adapter contract and fastest-path recommendations.

## VFX looks

The ten presets are `cinematic`, `glow`, `neon`, `glitch`, `vhs`, `dream`,
`vintage`, `noir`, `comic`, and `asmr-soft`. They compile to local FFmpeg filters
and can be stacked per clip in `effects.vfx`. The result is deterministic filter
compositing rather than a generative video foundation model.

```json
{
  "id": "reveal",
  "source": "./media/product.mp4",
  "reframe": "fill",
  "effects": { "vfx": ["cinematic", "glow"] },
  "transition": { "type": "zoom-in", "durationSeconds": 0.35 }
}
```

## Resource and rights workflow

The plan labels every resource as `provided`, `bundled`, `generated`, or `optional`.
User-supplied and downloaded media must receive a manifest license record. Bundled
fictional synthetic artwork receives an automatic record. Local procedural music
and ASMR ambience are generated from code and are not sampled recordings.

Before publishing, verify that visuals match their active narration beat; titles,
captions, characters, and CTAs do not overlap; safe zones and delivery profiles
pass; audio is intelligible and naturally paced; and synthetic-media disclosures
are present where required.

## Current scope

The built-in path covers local planning, recording, stable uploaded-image scenes,
editing, animation, compositing, system speech, procedural audio, and delivery.
Optional loopback adapters connect installed text-to-image, image-to-video,
text-to-video, and consented voice-profile engines without a hosted token. Large
diffusion checkpoints are not bundled, and no identity can be cloned without
named authorization metadata. See [`LOCAL-AI.md`](LOCAL-AI.md) and the
provider-neutral backlog in [`TODO.md`](../TODO.md).
