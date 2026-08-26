# Publishing

Agent Demo Studio separates **rendering** from **external publishing**. Installing the CLI or MCP server can never post by itself. A publish call requires:

1. A completed, reviewed creator export.
2. A platform access token stored in an environment variable.
3. An explicit `--confirm` flag or `confirmPublish: true` MCP field.

Use a package-first workflow for teams:

```bash
agent-demo creator render creator-project.json
agent-demo creator package creator-project.json creator-output/creator-render-result.json
```

The package contains separate platform folders with video, thumbnail, caption/chapters when available, `publishing-plan.json`, and the asset-license report.

## YouTube

The adapter uses a resumable `videos.insert` upload and bounded memory chunks. After the video succeeds, it sets the rendered thumbnail and adds the SRT/VTT caption track when present. A supplemental failure is returned as a warning so a retry cannot accidentally create a duplicate video. New or unaudited API projects may be limited by Google's current policies, so the default privacy is `private`.

```bash
agent-demo creator publish-youtube creator-output/creator-render-result.json youtube \
  --title "Product tour" --privacy private --confirm
```

The token needs an appropriate YouTube upload scope. CLI flags expose synthetic-media and made-for-kids declarations, subscriber notification behavior, caption language, and optional thumbnail/caption suppression.

## TikTok

The adapter first calls Query Creator Info, validates the creator's current privacy choices and maximum duration, initializes a `FILE_UPLOAD`, follows TikTok's whole-file/5–64 MB chunk rules, and returns the publish ID for status polling. CLI flags expose comments, Duet, Stitch, cover time, organic-brand, and AI-generated-content declarations.

```bash
agent-demo creator publish-tiktok creator-output/creator-render-result.json tiktok \
  --title "New workflow" --privacy SELF_ONLY --confirm
```

TikTok requires an approved app, an authorized user, and `video.publish`. Unaudited clients can be restricted to private visibility.

## Instagram Reels

Meta's Reel container flow fetches media from a public HTTPS URL. The local MP4 must therefore be hosted at a URL Meta can reach. The adapter creates a `REELS` container, polls until processing finishes, then publishes it.

```bash
agent-demo creator publish-instagram creator-output/creator-render-result.json reels \
  --account-id 123456789 \
  --public-video-url https://media.example/reviewed-reel.mp4 \
  --title "Product tour" --confirm
```

Use a professional account and a Meta app with the current content-publishing permission. Keep token values out of manifests, prompts, shell history, issue reports, and MCP arguments.

## MCP publishing

`demo_creator_publish` never accepts an access-token value. It reads only the fixed variable for the selected platform: `YOUTUBE_ACCESS_TOKEN`, `TIKTOK_ACCESS_TOKEN`, or `INSTAGRAM_ACCESS_TOKEN`. Set that token in the MCP server process environment, pass `confirmPublish: true`, and use a private or test visibility while validating a new app integration.

Platform APIs can change independently of this project. If an adapter begins returning a platform error, verify the linked official documentation, the app's review status, the requested scopes, and creator-specific limits before changing an export.
