# Platform profiles

Profiles are versioned encoding and layout defaults, not promises that a platform will accept every account or post. Platform rules and creator-specific limits change. Agent Demo Studio therefore treats duration limits as advisories and validates again before a credentialed publish.

| Preset | Canvas | Ratio | Default use | Advisory duration |
|---|---:|---:|---|---:|
| `youtube-1080p` | 1920×1080 | 16:9 | YouTube, tutorials, product demos | — |
| `youtube-4k` | 3840×2160 | 16:9 | Ultra-HD master | — |
| `shorts` | 1080×1920 | 9:16 | YouTube Shorts | 180 seconds |
| `reels` | 1080×1920 | 9:16 | Instagram Reels | account/platform validation |
| `tiktok` | 1080×1920 | 9:16 | TikTok | creator API validation |
| `story` | 1080×1920 | 9:16 | Mobile stories | platform validation |
| `square` | 1080×1080 | 1:1 | Cross-platform feed | — |
| `portrait` | 1080×1350 | 4:5 | Portrait feed | — |
| `linkedin` | 1920×1080 | 16:9 | Professional feed and explainers | — |
| `podcast-vertical` | 1080×1920 | 9:16 | Caption-forward podcast clips | — |

Every profile includes conservative UI safe-zone insets. Generated captions use those insets automatically. Custom overlays remain editable because platform UI placement changes frequently.

All standard profiles render:

- MP4 container
- H.264 High-compatible video by default
- AAC, 48 kHz stereo audio
- YUV 4:2:0 pixel format
- Fast-start metadata for progressive playback
- Configurable CRF quality
- Platform-sized JPEG thumbnail
- Optional SRT captions and FFmetadata chapters

Run `agent-demo creator presets` or call `demo_creator_presets` to retrieve the machine-readable values used by the installed version.
