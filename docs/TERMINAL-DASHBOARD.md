# Free terminal dashboard

Run the interactive dashboard from any terminal:

```bash
agent-demo dashboard
```

It uses the same engine as the MCP server and browser Studio. The menu can:

1. plan, build, and render a complete video;
2. review the fixed production plan without generating media;
3. generate original ambient music or an ASMR soundscape;
4. scan every installed or configured production capability;
5. warm the fastest installed local Qwen model;
6. show how to open the visual Studio.

The video wizard covers mode, duration, an optional exact narration script,
fast/quality/instant planning, scene image/video paths, any authorized character
images, a logo, supplied or generated music, built-in versus local generation,
text/image/video task, local or consented-clone voice, free procedural music,
export profiles, and output directory. Local jobs continue from the saved plan
without asking for another approval.

For scripts or an AI agent, use the equivalent non-interactive commands:

```bash
agent-demo capabilities

agent-demo creator local-ai --warm --profile fast

agent-demo creator plan \
  "Teach equivalent fractions with colorful paper circles" \
  --mode cartoon --planner auto --planner-profile fast

agent-demo creator prompt \
  "Teach equivalent fractions with colorful paper circles" \
  --mode cartoon --duration 45 \
  --presets youtube-1080p,shorts --render

agent-demo creator music \
  --style ambient --duration 45 \
  --out ./creator-output/fractions-music.wav
```

## Install on another laptop

Install Node.js 20.12 or newer and FFmpeg/FFprobe, then:

```bash
npm install --global github:khajaaijaz26/agent-demo-studio
agent-demo setup
agent-demo doctor
agent-demo capabilities
agent-demo dashboard
```

For local language intelligence, install Ollama and the small model once:

```bash
ollama pull qwen3.5:0.8b
agent-demo creator local-ai --warm --profile fast
```

Ollama is optional because the deterministic planner is built in. Agent Demo
Studio itself requires no subscription, hosted account, or paid API token.
Procedural music contains no downloaded samples. FFmpeg, local system speech,
uploaded media motion, bundled starter art, and the Studio/CLI/MCP controls all run
on the laptop.

Full diffusion text-to-video and voice cloning require a compatible model/backend
installed by the creator. Agent Demo Studio connects them only through the
loopback contracts in [LOCAL-AI.md](LOCAL-AI.md); it does not silently use a paid
cloud provider. Diffusion speed and hardware requirements depend on that backend.

## Portable project data

Use `AGENT_DEMO_HOME` or command-specific output directories to keep work in a
known folder. Copy that folder together with any licensed source media to move a
project. Manifests store ordinary local paths, resource provenance, rights, fixed
production rules, and render settings; they never store hosted-model API keys.
