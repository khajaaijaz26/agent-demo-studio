# Contributing

Thanks for helping improve Agent Demo Studio.

## Development setup

1. Install Node.js 20.12 or newer and FFmpeg.
2. Fork and clone the repository.
3. Run `npm install`.
4. Run `npm run check` before opening a pull request.
5. For creator timeline, caption, audio, or export changes, run `npm run test:creator`.
6. For browser recorder or classic demo renderer changes, run `npm run test:smoke`.

## Pull requests

- Keep changes focused and explain the user-facing outcome.
- Add or update tests for behavior changes.
- Preserve the portable `project.json` format or include an explicit migration.
- Preserve the creator manifest schema or include an explicit migration and changelog entry.
- Never add credentials, private recordings, or copyrighted music to fixtures.
- Keep MCP tool names and input schemas backward compatible within a minor release.
- Include screenshots or a short sample render for visual changes when practical.

## Architecture principles

- Local-first by default.
- MCP controls work; it does not carry large video files.
- Browser actions remain semantic and replayable.
- Rendering must be deterministic from the project manifest and artifacts.
- New delivery formats should be presets over the shared timeline, not separate renderers.
- Provider integrations must remain optional.
- External publishing must stay explicit, review-first, and credentialed at runtime.
- Agent-facing errors should include an actionable recovery step.

## Commit style

Clear imperative commit messages are preferred, for example:

```text
Add scene-level browser retakes
Fix Windows voice-over argument handling
```
