# EdulabsAI premium launch campaign

This campaign supersedes the earlier slideshow-led launch exports. It uses the
expanded Agent Demo Studio creator engine, the verified browser recordings from
`test-output/edulabs-v2`, scene-specific neural narration, original music and
sound effects, animated brand graphics, native landscape and vertical layouts,
captions, thumbnails, delivery manifests, and automated media QA.

## Deliverables

- `01-meet-edulabsai-launch-film` — the primary fully animated launch film.
- `02-one-lesson-everything-connected` — the teacher workflow product story.
- `03-see-learning-act-next` — assessment, Snap & Mark, insights, and reteaching.
- `04-classroom-community` — student experience, managed chat, and family updates.
- Five original vertical reels, each with a separate hook and edit.

See `MASTER-FILES.md` for exact device paths, `PUBLISHING-PLAYBOOK.md` for the
recommended release order, `CAMPAIGN-SUMMARY.json` for the complete build index,
and `QA-REPORT.md` for the final 9/9 media check. `BUILD-SUMMARY.json` records the
most recent targeted render command and is not the campaign-wide index.

The two nine-minute complete tours are reference material only. They are not
copied into this campaign and are not used as the creative structure.

## Build

From the Agent Demo Studio repository root:

```powershell
npm run build
node campaigns/edulabsai-premium-launch-2026/build.mjs --only 01-meet-edulabsai-launch-film
node campaigns/edulabsai-premium-launch-2026/build.mjs --all
```

The source browser scenes must exist at `test-output/edulabs-v2/scenes`. The
build never changes those recordings. Intermediate speech, music, graphics, and
trimmed media are written to `.work/`; reviewed final packages go to
`deliverables/`.
