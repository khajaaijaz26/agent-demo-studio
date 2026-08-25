# Agent Demo Studio

Agent Demo Studio is an open-source MCP server, CLI, browser recorder, and video editor that lets Codex, Claude Code, and other AI agents produce polished product demos from the terminal.

It opens a real Chromium browser, performs the requested workflow live, records every action, and produces a high-quality MP4 with:

- 1920×1080 H.264 video
- Smooth agent cursor and click highlights
- Chapter cards and action annotations
- Cinematic gradient background and browser frame
- Branded intro and outro
- Burned-in narration captions
- Local system voice-over
- Generated royalty-free ambient music
- A local visual editor for previewing and restyling

No hosted account is required. Projects, recordings, voice-over, music, and rendered files stay on your machine.

## How it works

```text
Codex / Claude Code / any MCP client
                 │
            MCP tools
                 │
       Agent Demo Studio engine
       ├── Playwright live recorder
       ├── Semantic action timeline
       ├── Local TTS + generated music
       ├── Sharp design compositor
       └── FFmpeg 1080p renderer
                 │
        Local Studio + MP4 export
```

The MCP server is the agent control plane. Browser and media work run locally, and large media files are returned as file resources rather than sent through the model context.

## Requirements

- Node.js 20.12 or newer
- FFmpeg and FFprobe on `PATH`
- Codex and/or Claude Code for agent control

Install FFmpeg if needed:

```powershell
# Windows
winget install Gyan.FFmpeg
```

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt-get install ffmpeg
```

## Install from GitHub

```bash
npm install --global github:khajaaijaz26/agent-demo-studio
agent-demo setup
```

`agent-demo setup` installs Playwright Chromium if it is missing and registers the MCP server with every detected client:

- Codex CLI, Codex IDE extension, and Codex desktop configuration
- Claude Code at user scope

Run a health check at any time:

```bash
agent-demo doctor
```

To develop from source instead:

```bash
git clone https://github.com/khajaaijaz26/agent-demo-studio.git
cd agent-demo-studio
npm install
npm run build
npm link
agent-demo setup
```

## Ask an agent to create a demo

After setup, start Codex or Claude Code and ask:

```text
Create a 45-second product demo of https://my-product.example.
Show the sign-up and dashboard workflow in a visible browser.
Use a purple cinematic background, add this narration, generate music,
render a 1080p MP4, and give me the final file.
```

For a live adaptive recording, the agent will normally:

1. Call `demo_create_project`.
2. Call `demo_browser_start` to open the visible browser.
3. Call `demo_browser_snapshot` to inspect the current page.
4. Call `demo_browser_act` for each click, fill, scroll, navigation, or chapter.
5. Call `demo_browser_finish`.
6. Call `demo_generate_voice` when narration is requested.
7. Call `demo_render` and poll `demo_job_status`.
8. Return the final MP4 resource link.

If the workflow is already known, the agent can call `demo_record_flow` once with the complete action list.

## One-command CLI demo

Record a page for four seconds and render it with a cinematic frame and ambient music:

```bash
agent-demo quick https://example.com --title "Example product tour"
```

Add local voice-over:

```bash
agent-demo quick https://example.com \
  --title "Example product tour" \
  --narration "Meet the fastest way to launch your next project."
```

The browser is visible by default. Use `--headless` for CI or unattended browser capture.

## Scripted demos

Recording scripts are portable JSON files:

```json
{
  "title": "Analytics in action",
  "subtitle": "From data to insight in seconds",
  "url": "http://localhost:3000",
  "narration": "Create a report and share clear insights in seconds.",
  "actions": [
    {
      "type": "chapter",
      "label": "Create a report",
      "description": "A complete workflow",
      "milliseconds": 1200
    },
    {
      "type": "click",
      "role": "button",
      "name": "Create report",
      "label": "Open the report builder"
    },
    {
      "type": "fill",
      "selector": "#report-name",
      "value": "Q3 Growth Brief",
      "label": "Name the report"
    },
    {
      "type": "click",
      "role": "button",
      "name": "Generate report"
    }
  ],
  "headless": false,
  "generateVoice": true,
  "autoRender": true
}
```

Run it with:

```bash
agent-demo record demo.json
```

Supported browser actions are:

- `navigate`
- `click`
- `fill`
- `press`
- `hover`
- `scroll`
- `wait`
- `chapter`

Prefer accessible `role` and `name` locators. CSS selectors and visible text are also supported.

## Visual Studio

Open the all-in-one local editor:

```bash
agent-demo studio
```

The Studio provides:

- Project browser
- Final video preview
- Semantic action timeline
- Title and subtitle editing
- Background, accent, and highlight colors
- Narration editor
- Local voice generation
- Music and caption controls
- One-click 1080p rerendering

The server binds only to `127.0.0.1`.

## MCP tools

| Tool | Purpose |
|---|---|
| `demo_create_project` | Create a portable demo project |
| `demo_browser_start` | Start a visible, high-quality live recording |
| `demo_browser_snapshot` | Inspect the current browser viewport |
| `demo_browser_act` | Perform and record one browser action |
| `demo_browser_finish` | Finalize the raw screencast |
| `demo_record_flow` | Run a complete scripted production job |
| `demo_generate_voice` | Create local system voice-over |
| `demo_render` | Edit and render the final MP4 |
| `demo_job_status` | Poll background recording/render jobs |
| `demo_get_project` | Read project state and output resources |
| `demo_list_projects` | List local projects |
| `demo_open_studio` | Open the visual editor |
| `demo_doctor` | Check the local installation |

For an MCP client that is not auto-detected:

```bash
agent-demo mcp-config
```

This prints a portable `mcpServers` configuration using the current Node executable and installed CLI path.

## Editing and audio

The renderer uses a portable JSON project manifest. Raw recordings are never permanently flattened into a single uneditable source: recorded browser events, narration, design settings, and audio references remain available for rerendering.

Default audio requires no API key:

- Windows uses `System.Speech`.
- macOS uses `say`.
- Linux uses `espeak` when installed.
- Ambient music is synthesized locally by Agent Demo Studio and is safe to use as an original generated asset.
- Existing WAV, MP3, or supported FFmpeg audio can be supplied with `--voice` or `--music`.

Example:

```bash
agent-demo voice my-project --text "Welcome to the product."
agent-demo render my-project --music ./assets/launch-track.mp3
```

## Project files

By default, projects are stored in `~/AgentDemoStudio/projects`:

```text
projects/my-demo/
├── project.json
├── raw/browser.webm
├── screenshots/latest.png
├── audio/
│   ├── voiceover.wav
│   └── ambient.wav
├── design/
├── captions/
└── exports/
    ├── my-demo.mp4
    └── my-demo-thumbnail.jpg
```

Set `AGENT_DEMO_HOME` or use `--root` to change the location.

## Privacy and safe usage

- The basic version records the controlled browser page, not the full desktop.
- Recording begins only after a project explicitly starts a recording session.
- Credentials should be entered manually into an already-open browser session and never placed in an action script or prompt.
- The generated Studio binds only to localhost.
- Publishing is intentionally not automatic in this release.
- Review a demo before sharing it if the product contains private or customer information.

## Current scope

This first open-source version focuses on website and web-product demos. It does not yet capture arbitrary native desktop windows, clone voices, upload to social platforms, or provide cloud collaboration.

Planned improvements include scene retakes, multiple aspect ratios, repository-driven storyboard generation, multilingual dubbing, team review links, and native desktop capture.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:smoke
```

The smoke test launches a real headless browser against the included sample product, records the workflow, renders the result, and verifies that the output is a 1920×1080 H.264 video.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before making a substantial change.

## License

MIT. See [LICENSE](LICENSE).
