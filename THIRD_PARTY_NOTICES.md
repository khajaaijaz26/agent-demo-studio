# Third-party notices

Agent Demo Studio is MIT-licensed. Its source distribution depends on open-source packages and system tools that retain their own licenses.

| Component | Used for | Project/license source |
|---|---|---|
| FFmpeg / FFprobe | Media probing, editing, compositing, audio, and encoding | <https://ffmpeg.org/legal.html> |
| Playwright | Chromium browser automation and screencast capture | <https://github.com/microsoft/playwright> |
| Sharp | Locally rendered design and overlay assets | <https://github.com/lovell/sharp> |
| Model Context Protocol TypeScript SDK | Agent-facing MCP server | <https://github.com/modelcontextprotocol/typescript-sdk> |
| Commander | Command-line interface | <https://github.com/tj/commander.js> |
| Zod | Creator manifest validation | <https://github.com/colinhacks/zod> |
| OpenAI Whisper (optional) | Local speech-to-text adapter | <https://github.com/openai/whisper> |
| edge-tts (optional) | Scene-synchronized neural narration | <https://github.com/rany2/edge-tts> |

The npm package does not bundle FFmpeg, FFprobe, Whisper, edge-tts, or platform publishing credentials. A Playwright browser may be downloaded separately by `agent-demo setup` and is governed by its upstream terms.

The npm package does bundle original fictional synthetic artwork created for Agent
Demo Studio with Codex's built-in image-generation mode. It is project content, not
a third-party runtime dependency. Prompt provenance and hashes are in
[`assets/README.md`](assets/README.md).

Creators remain responsible for the rights to source footage, fonts, logos, music, narration, and other media used in a project. Every creator render emits an asset-rights report; see [docs/LICENSING.md](docs/LICENSING.md).
