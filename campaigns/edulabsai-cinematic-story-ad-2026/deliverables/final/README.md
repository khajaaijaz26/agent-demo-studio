# EdulabsAI — Built for Teachers cinematic advertisement

This is the complete production and release package for a 95.87-second story-led EdulabsAI advertisement. It begins with the fragmented reality of teacher workflows, introduces EdulabsAI as the connected alternative, and proves the journey through lesson creation, aligned resources, export, student practice, evidence, and teacher-approved family communication.

## Final masters

- 4K landscape: `deliverables/final/landscape/youtube-4k-master/edulabsai-ad-4k.mp4`
- Mobile vertical: `deliverables/final/vertical/reels-master/edulabsai-ad-vertical.mp4`
- Captions, thumbnails, publishing plans, animation audits, and release manifests sit beside each master.

The landscape master is authored natively at 3840×2160. The mobile master is independently composed at 1080×1920; it is not a center crop. Both are 30 fps H.264/AAC with burn-in captions and SRT sidecars.

## Creative system

- Original fictional teacher and classroom artwork
- Verified EdulabsAI product recordings with fictional demonstration data
- Stable high-contrast backgrounds with no camera shake or continuous drift
- One-time logo drops, card assemblies, line traces, masked reveals, and scale resolves
- Large mobile-safe headlines, product close-ups, captions, and calls to action
- Natural measured synthetic narration using Andrew at a relaxed `-7%` rate
- Original procedural score, **Connected Light**, with no samples, isolated effects, harsh stingers, or percussion hits
- Controlled-beta labels and teacher-review language for Snap-and-Mark and Family Learning Digest

## Rebuild

From the repository root:

```powershell
npm run build
node campaigns\edulabsai-cinematic-story-ad-2026\build.mjs
node campaigns\edulabsai-cinematic-story-ad-2026\qa.mjs
```

Set `REBUILD_VISUALS=1` only when the native scene plates need to be regenerated. Brand assets are resolved from `C:\Users\khaja\EduLabsAI99\public\brand` by default or from the repository named by `EDULABSAI_SOURCE`. The owner-provided browser recordings are intentionally not duplicated in this campaign; place them in `test-output/edulabs-v2/scenes` or set `EDULABSAI_RECORDINGS` to their directory. The three original fictional illustration sources are included.

## Verification

`qa/QA-REPORT.json` is the machine-readable release gate. It validates resolution, frame rate, codecs, duration, loudness, true peak, black holds, long silence, file size, checksums, 24 layout-safe-zone assertions, and 24 source-to-encoded midpoint comparisons. Every encoded comparison passes, with visual similarity from 99.48% to 99.85%, proving that the full-canvas logo and product compositions survive export without shrinking or shifting. `MANUAL-VISUAL-QA.md` records the encoded-frame review. The final contact sheets, opening sequence, representative full-resolution frames, waveform, and spectrogram are in `qa/`.

## Rights and privacy

See `RESOURCE-LIST.md`, `IMAGE-ASSET-PROVENANCE.md`, and the per-format `ASSET-LICENSES.md` files. The artwork depicts invented people, product recordings use fictional/demo information, and no real learner identity or personal data appears. Repository code is covered by the root MIT license; EdulabsAI brand assets remain the property of their owner.

Publishing is intentionally a separate opt-in action because platform accounts and final campaign approval are external to this build.
