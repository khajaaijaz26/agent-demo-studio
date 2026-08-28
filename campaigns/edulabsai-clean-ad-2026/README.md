# EdulabsAI clean advertisement

This is a separate stability-first advertisement for EdulabsAI. It intentionally does not reuse the motion treatment, music, transitions, or sound effects from the earlier launch ad.

## Master

- 1920×1080, 30 fps, H.264/AAC
- Approximately 45–55 seconds, paced from scene-locked narration
- Fixed product screenshots extracted from verified EdulabsAI recordings
- Full-canvas transparent animation layers so positions cannot drift
- Cut-only scene changes; layouts never transform between scenes
- One intentional opening motion: the orange EdulabsAI mark drops once and settles
- No Ken Burns, zoom, pan, float, drift, shake, video loops, or sound effects
- Natural neural narration at a slower rate
- Original soft score with smooth sine-based pads and no percussion

## Build

From the repository root:

```powershell
npm run build
node campaigns/edulabsai-clean-ad-2026/build.mjs
node campaigns/edulabsai-clean-ad-2026/qa.mjs
```

The final package is written to `deliverables/edulabsai-one-learning-loop-clean-ad/`.
