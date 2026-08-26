# Creator manifest reference

The creator manifest is Agent Demo Studio's portable, non-destructive edit format. Source media is referenced rather than modified. The same timeline can render one or many aspect ratios.

Start from a maintained template:

```bash
agent-demo creator init product-demo --source ./recording.mp4 --title "Product tour"
agent-demo creator validate creator-project.json
agent-demo creator render creator-project.json
```

See [`examples/creator-project.json`](../examples/creator-project.json) for a complete project.

## Top-level fields

| Field | Required | Purpose |
|---|---:|---|
| `schemaVersion` | yes | Manifest contract version; currently `2` |
| `title` | yes | Human-readable project title and default metadata title |
| `description` | no | Default publishing description |
| `outputDirectory` | no | Output folder, resolved from the manifest directory |
| `brand` | no | Name, logo, logo license ID, colors, and font family used by generated graphics |
| `clips` | yes | Ordered visual timeline |
| `overlays` | no | Timed text, speech bubbles, images, video, fictional characters/presenters, and watermarks |
| `captions` | no | SRT/VTT input, sidecar, burn-in, language, and styling |
| `audio` | no | Clip audio, layered voices, music, ambience, SFX, ducking, pan, and loudness settings |
| `chapters` | no | Explicit chapter markers; clip chapter labels are used otherwise |
| `exports` | no | One or more platform profiles; defaults to YouTube 1080p |
| `licenses` | no | Rights and attribution records for project media |
| `metadata` | no | Project-defined data, including saved analysis output |

## Clips

Every clip needs a stable `id` and `source`. Supported source images include PNG, JPEG, WebP, AVIF, GIF, and SVG; other visual sources are handled as video by FFmpeg.

```json
{
  "id": "dashboard",
  "source": "./media/dashboard.mp4",
  "trimStartSeconds": 1.2,
  "trimEndSeconds": 8.4,
  "speedRamp": { "from": 1, "to": 1.6, "steps": 8 },
  "reframe": "blur-background",
  "focusX": 0.5,
  "focusY": 0.42,
  "freezeAfterSeconds": 0.5,
  "motion": "ken-burns-in",
  "transition": { "type": "slide-left", "durationSeconds": 0.35 },
  "effects": {
    "brightness": 0.02,
    "saturation": 1.08,
    "sharpen": 0.4,
    "vfx": ["cinematic", "glow"]
  },
  "chapter": "Dashboard",
  "licenseId": "original-recording"
}
```

Editing controls:

- `trimStartSeconds` / `trimEndSeconds`: choose a source range.
- `durationSeconds`: required for image clips.
- `speed`: constant speed from `0.1` to `16`.
- `speedRamp`: stepped, audio-synchronized ramp with 2–16 stages.
- `volume` / `muted`: clip-audio gain.
- `reframe`: `fit`, `fill`, or `blur-background`.
- `focusX` / `focusY`: normalized crop focus from `0` to `1`.
- `freezeAfterSeconds`: clone the final frame and extend audio with silence.
- `motion`: for images, `none`, Ken Burns in/out, or a directional pan.
- `effects`: brightness, contrast, saturation, gamma, blur, sharpen, vignette, fades, and ordered VFX presets.

VFX values are `cinematic`, `glow`, `neon`, `glitch`, `vhs`, `dream`, `vintage`,
`noir`, `comic`, and `asmr-soft`. They are local deterministic filter treatments;
they do not call a generative video model.

The transition on a clip connects the previous clip into that clip. Available values are:

`cut`, `fade`, `dissolve`, `wipe-left`, `wipe-right`, `wipe-up`, `wipe-down`,
`slide-left`, `slide-right`, `slide-up`, `slide-down`, `smooth-left`,
`smooth-right`, `circle-open`, `circle-close`, `radial`, `pixelize`,
`fade-black`, `fade-white`, `zoom-in`, `squeeze-horizontal`,
`squeeze-vertical`, `diagonal`, `blur`, `reveal-left`, `reveal-right`,
`reveal-up`, and `reveal-down`.

## Overlays

Overlay `x` and `y` values are normalized center coordinates. Width and height are output pixels; defaults adapt to each export canvas.

| Type | Use |
|---|---|
| `text` | Hook, headline, or section label |
| `lower-third` | Speaker, feature, or brand identification |
| `cta` | Centered call to action |
| `speech-bubble` | Character dialogue or short callout |
| `image` | Screenshot, cutout, badge, or picture-in-picture graphic |
| `watermark` | Smaller, semi-transparent brand image |
| `presenter` | Fictional or authorized presenter cutout |
| `character` | Original or authorized illustrated character cutout |
| `video` | Timed video/alpha/chroma-key layer |

Text graphics are rendered locally to lossless RGBA assets before FFmpeg compositing. This prevents platform-dependent font filter escaping and keeps placement deterministic.

All overlay kinds support timed placement, opacity, and an optional `animation`.
Entrance/exit presets are `none`, `fade`, four directional slides, `pop`, `rise`,
and `drop`. Continuous loops are `none`, `float`, `bounce`, `drift`, `shake`,
`pulse`, and `talk`. `talk` is subtle still-cutout motion, not phoneme lip sync.

```json
{
  "id": "host",
  "type": "presenter",
  "source": "builtin:presenter/aria",
  "startSeconds": 1,
  "endSeconds": 8,
  "x": 0.77,
  "y": 0.66,
  "animation": {
    "enter": "slide-right",
    "exit": "fade",
    "loop": "talk",
    "durationSeconds": 0.5
  }
}
```

Video overlays may set `loop`, `flipHorizontal`, and `chromaKey`. Chroma-key color
uses a hex value such as `"#00FF00"`; `similarity` and `blend` tune removal. Record
rights for every non-bundled source through `licenseId`.

## Captions

Caption input may be SRT or WebVTT. Sidecars are normalized to SRT. Burn-in uses an ASS track sized to each output, so a long video does not create hundreds of FFmpeg image inputs.

```json
{
  "captions": {
    "source": "./narration.srt",
    "burn": true,
    "sidecar": true,
    "language": "en",
    "style": {
      "position": "bottom",
      "fontSize": 52,
      "color": "#FFFFFF",
      "background": "#050711D9",
      "accent": "#22D3EE",
      "maxCharactersPerLine": 34,
      "maxLines": 3
    }
  }
}
```

Generate captions with an installed local Whisper CLI:

```bash
agent-demo creator transcribe ./video.mp4 --model turbo --format srt
```

## Audio

Voice, music, ambience, and sound-effect tracks can be trimmed, delayed, looped,
faded, panned, and given independent volume. `voice` supports the common single-host
case; `voices` adds layered speakers; `soundEffects` accepts timed cues. Clip audio
and voices form the speech bus. When music ducking is enabled, that bus drives a
side-chain compressor before the final mix. Mix modes are `standard`, `voice`,
`cinematic`, and `asmr`.

```json
{
  "audio": {
    "voices": [
      { "source": "./voice/nova.wav", "startSeconds": 0.5, "volume": 1 },
      { "source": "./voice/milo.wav", "startSeconds": 4.2, "volume": 0.95 }
    ],
    "music": { "source": "./audio/score.wav", "loop": true, "volume": 0.12 },
    "ambience": { "source": "./audio/room.wav", "loop": true, "volume": 0.08 },
    "soundEffects": [
      { "source": "./audio/reveal.wav", "startSeconds": 3.8, "pan": 0.2 }
    ],
    "mode": "cinematic",
    "duckMusic": true,
    "targetLufs": -14
  }
}
```

The final audio chain resamples to 48 kHz stereo, normalizes to the requested integrated loudness, and applies a limiter. Defaults are `-14 LUFS` and `-1.5 dBTP`; change these for a delivery contract when needed.

## Exports

Each export chooses a built-in preset and may override title, description, tags, quality, codec, thumbnail time, and caption burn-in.

```json
{
  "exports": [
    { "id": "youtube", "preset": "youtube-1080p", "quality": 18 },
    { "id": "short", "preset": "shorts", "quality": 19 },
    { "id": "reel", "preset": "reels", "quality": 19 }
  ]
}
```

H.264 is the interoperable default. HEVC is available with `"videoCodec": "hevc"` when the installed FFmpeg build includes `libx265` and the destination accepts it.

## Path resolution

Relative paths in a saved manifest resolve from the manifest's directory. Inline manifests from MCP or Studio resolve from the supplied `baseDirectory`, or the process working directory when omitted.

Bundled synthetic artwork uses stable URIs such as `builtin:presenter/aria` and
`builtin:scene/story-forest`. These resolve from a source checkout or installed npm
package and automatically receive license records. See
[`assets/README.md`](../assets/README.md).

Prompt-created manifests also embed their `productionPlan` in `metadata` and link
to `./production-plan.json`. The plan is written first and remains independently
reviewable; see [the prompt-video guide](PROMPT-VIDEO-AND-VFX.md).
