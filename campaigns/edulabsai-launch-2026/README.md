# EdulabsAI launch campaign

This reproducible campaign uses Agent Demo Studio to create four landscape product advertisements and five vertical reels from EdulabsAI-owned brand, launch-deck and product artwork.

## Build

```powershell
npm run build
npm run campaign:edulabsai
```

Useful options:

```powershell
node campaigns/edulabsai-launch-2026/build.mjs --prepare-only
node campaigns/edulabsai-launch-2026/build.mjs --campaign=reel-03-paper-to-next-step
node campaigns/edulabsai-launch-2026/build.mjs --force
```

Set `EDULABSAI_SOURCE` only when the EdulabsAI repository is not in a neighbouring project directory.

## Output

- `assets/` contains a campaign-local snapshot of the approved source artwork.
- `manifests/` contains editable synchronized-narration and creator manifests.
- `deliverables/` contains the upload-ready packages, thumbnails, captions, publishing metadata and QA report.
- `.work/` contains reproducible intermediates and is intentionally ignored.

The build does not publish to an external account. Each platform package remains reviewable before an account owner chooses to upload it.

