# The Journey of a Raindrop

An original vertical animated classroom mini-lesson created for both YouTube Shorts and Instagram Reels. Ms. Maya teaches four fictional students the water cycle through evaporation, condensation, precipitation, and collection.

## Finished master

- Video: `deliverables/final/shorts-master/raindrop-classroom-cartoon-short-mp4.mp4`
- Thumbnail: `deliverables/final/shorts-master/raindrop-classroom-cartoon-short-mp4-thumbnail.jpg`
- Editable captions: `deliverables/final/shorts-master/raindrop-classroom-cartoon-short-mp4.srt`
- Duration: 71.048 seconds
- Verification: 19/19 automated checks plus manual opening, title, mobile, lesson, and ending frame inspection

## Output contract

- Native 1080×1920 vertical composition
- Approximately 60–75 seconds at 30 fps
- H.264 video with AAC stereo audio
- Natural teacher and student neural voices
- Original procedural classroom music with no samples
- Burned captions plus editable SRT sidecar
- Six original generated story plates with a consistent fictional cast
- No real pupils, downloaded stock media, copyrighted characters, or logos

## Rebuild

From the repository root:

```powershell
npm run campaign:cartoon-classroom
node campaigns\cartoon-classroom-reel-2026\qa.mjs
```

The build writes the final social package to `deliverables/final/`. The production plan is the source of truth for the lesson, cast, scene order, resources, timing assumptions, and quality gates. `IMAGE-ASSET-PROVENANCE.md` records the generated-art prompt set and `MANUAL-VISUAL-QA.md` records the final human-viewing inspection.
