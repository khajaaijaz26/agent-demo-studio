const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  chat: $("#chat-stream"),
  starters: $("#starter-grid"),
  prompt: $("#prompt-text"),
  generate: $("#generate-button"),
  drawer: $("#tool-drawer"),
  drawerTitle: $("#drawer-title"),
  drawerKicker: $("#drawer-kicker"),
  attachmentStrip: $("#attachment-strip"),
  quickFile: $("#quick-file-input"),
  mode: $("#prompt-mode"),
  duration: $("#prompt-duration"),
  narration: $("#prompt-narration"),
  plannerProfile: $("#prompt-planner-profile"),
  generateVoice: $("#prompt-voice"),
  generateMusic: $("#prompt-generate-music"),
  musicMirror: $("#music-toggle-mirror"),
  voiceProvider: $("#prompt-voice-provider"),
  voiceName: $("#voice-name"),
  voiceSpeaker: $("#voice-speaker"),
  voiceConsent: $("#voice-consent"),
  mediaProvider: $("#prompt-media-provider"),
  mediaTask: $("#prompt-media-task"),
  ltxUrl: $("#ltx-url"),
  allowCloudMedia: $("#allow-cloud-media"),
  comfyUiUrl: $("#comfyui-url"),
  comfyUiWorkflow: $("#comfyui-workflow"),
  mediaAdapterUrl: $("#media-adapter-url"),
  negativePrompt: $("#negative-prompt"),
  seed: $("#generation-seed"),
  soundDirection: $("#sound-direction"),
  engineCards: $("#engine-cards"),
  uploadState: $("#upload-state"),
  mediaCount: $("#media-count"),
};

const initialChat = elements.chat.innerHTML;
const state = {
  sceneSources: [],
  characters: [],
  logoSource: undefined,
  musicSource: undefined,
  voiceReference: undefined,
  attachments: [],
  currentJobId: undefined,
  busy: false,
  formatIndex: 0,
  formats: [
    { label: "16:9", presets: ["youtube-1080p"] },
    { label: "9:16", presets: ["reels", "shorts", "tiktok"] },
    { label: "1:1", presets: ["square"] },
  ],
};

const toolLabels = {
  create: ["CREATE", "Video setup"],
  projects: ["WORKSPACE", "Projects"],
  website: ["CAPTURE", "Website demos"],
  media: ["PRODUCTION", "Media & characters"],
  voice: ["PRODUCTION", "Voice"],
  music: ["PRODUCTION", "Music & sound"],
  engines: ["LOCAL STACK", "AI engines"],
  advanced: ["CONTROL", "Advanced"],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asError(payload, fallback) {
  const raw = payload?.error;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") return raw.message || raw.detail || JSON.stringify(raw);
  return fallback;
}

async function api(route, options = {}) {
  const response = await fetch(route, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!response.ok) throw new Error(asError(payload, `Request failed with HTTP ${response.status}.`));
  return payload;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    elements.chat.scrollTop = elements.chat.scrollHeight;
  });
}

function appendUserMessage(text) {
  const article = document.createElement("article");
  article.className = "message user";
  article.innerHTML = `
    <div class="avatar">YOU</div>
    <div class="message-body">
      <div class="message-meta"><b>You</b><span></span></div>
      <p>${escapeHtml(text)}</p>
    </div>`;
  elements.chat.append(article);
  scrollToBottom();
}

function appendAssistantShell() {
  const article = document.createElement("article");
  article.className = "message assistant";
  article.innerHTML = `
    <div class="avatar studio-avatar">✦</div>
    <div class="message-body">
      <div class="message-meta"><b>Agent Demo Studio</b><span>working</span></div>
      <div class="progress-card">
        <div class="progress-head"><b>Planning before production</b><span>0%</span></div>
        <p>Turning the request into requirements, a timed storyboard, resources, rights, workflow, and quality gates.</p>
        <progress class="progress-track" max="100" value="0"></progress>
        <div class="stage-steps"><span class="active">Plan</span><span>Voice</span><span>Motion</span><span>Audio</span><span>Edit</span><span>QA</span></div>
      </div>
    </div>`;
  elements.chat.append(article);
  scrollToBottom();
  return article;
}

function updateProgress(article, progress, message) {
  const value = Math.max(0, Math.min(100, Number(progress) || 0));
  const progressNode = article.querySelector("progress");
  const percentNode = article.querySelector(".progress-head span");
  const titleNode = article.querySelector(".progress-head b");
  const copyNode = article.querySelector(".progress-card p");
  if (progressNode) progressNode.value = value;
  if (percentNode) percentNode.textContent = `${Math.round(value)}%`;
  if (copyNode) copyNode.textContent = message || "Working locally…";
  if (titleNode) {
    titleNode.textContent = value < 8 ? "Planning before production"
      : value < 25 ? "Creating natural scene-aligned narration"
        : value < 68 ? "Generating moving scenes"
          : value < 72 ? "Mixing music and sound"
            : value < 99 ? "Editing, rendering, and validating"
              : "Finishing quality checks";
  }
  const thresholds = [2, 8, 25, 68, 72, 95];
  article.querySelectorAll(".stage-steps span").forEach((node, index) => {
    node.classList.toggle("active", value >= thresholds[index]);
  });
  scrollToBottom();
}

function planCard(result) {
  const plan = result?.plan;
  if (!plan) return "";
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  const motion = plan.requirements?.motionStandard || "planned";
  const engine = plan.capabilities?.capabilities?.find((item) => item.category === "visuals" && item.selected)?.label || "Automatic";
  return `
    <section class="plan-card">
      <h3>Production plan completed</h3>
      <p>${escapeHtml(plan.requirements?.objective || plan.originalPrompt)}</p>
      <div class="plan-summary">
        <div><b>${escapeHtml(engine)}</b><small>Visual engine</small></div>
        <div><b>${escapeHtml(motion)}</b><small>Motion standard</small></div>
        <div><b>${escapeHtml(plan.requirements?.targetDurationSeconds || "—")} seconds</b><small>Planned duration</small></div>
      </div>
      <div class="scene-list">
        ${scenes.map((scene, index) => `
          <div class="scene-line">
            <i>${String(index + 1).padStart(2, "0")}</i>
            <div><b>${escapeHtml(scene.title)}</b><small>${escapeHtml(scene.visual)}</small></div>
            <span>${escapeHtml(scene.durationSeconds)}s</span>
          </div>`).join("")}
      </div>
    </section>`;
}

function outputVideoUrl(jobId, outputId) {
  return `/api/creator/jobs/${encodeURIComponent(jobId)}/outputs/${encodeURIComponent(outputId)}/video`;
}

function resultCard(jobId, result) {
  const render = result?.renderResult;
  const outputs = Array.isArray(render?.outputs) ? render.outputs : [];
  const output = outputs[0];
  if (!output) {
    return `
      <section class="result-card">
        <div class="result-copy">
          <h3>Editable project is ready</h3>
          <p>Rendering was disabled or no rendered output was returned.</p>
          <div class="result-meta">
            <div><span>Plan</span><b title="${escapeHtml(result?.planPath)}">${escapeHtml(result?.planPath || "—")}</b></div>
            <div><span>Manifest</span><b title="${escapeHtml(result?.manifestPath)}">${escapeHtml(result?.manifestPath || "—")}</b></div>
          </div>
        </div>
      </section>`;
  }
  const videoUrl = outputVideoUrl(jobId, output.id);
  const sizeMb = Number.isFinite(output.fileSizeBytes) ? (output.fileSizeBytes / 1024 / 1024).toFixed(1) : "—";
  return `
    <section class="result-card" data-job-id="${escapeHtml(jobId)}">
      <div class="result-video"><video controls playsinline preload="metadata" src="${videoUrl}"></video></div>
      <div class="result-copy">
        <h3>${escapeHtml(result.title || render.title || "Video ready")}</h3>
        <p>Rendered locally and checked for dimensions, motion, audio, captions, and delivery settings.</p>
        <div class="result-meta">
          <div><span>Output</span><b>${escapeHtml(output.id)}</b></div>
          <div><span>Format</span><b>${escapeHtml(output.width)}×${escapeHtml(output.height)} · ${escapeHtml(output.fps)} fps</b></div>
          <div><span>Duration</span><b>${Number(output.durationSeconds || 0).toFixed(1)} sec</b></div>
          <div><span>File size</span><b>${sizeMb} MB</b></div>
          <div><span>Saved at</span><b title="${escapeHtml(output.videoPath)}">${escapeHtml(output.videoPath)}</b></div>
        </div>
        <div class="result-actions">
          <a class="primary" href="${videoUrl}" download>Download MP4</a>
          <button type="button" data-action="show-path">Show artifact paths</button>
        </div>
      </div>
    </section>
    ${outputs.length > 1 ? `<div class="result-actions output-switcher">${outputs.map((item, index) => `<button type="button" data-output-id="${escapeHtml(item.id)}" data-job-id="${escapeHtml(jobId)}">${index + 1}. ${escapeHtml(item.id)}</button>`).join("")}</div>` : ""}`;
}

function showCompleted(article, job) {
  const result = job.result || {};
  const body = article.querySelector(".message-body");
  const meta = article.querySelector(".message-meta span");
  if (meta) {
    meta.textContent = "complete";
    meta.style.color = "#74dcb7";
  }
  body.querySelector(".progress-card")?.remove();
  body.insertAdjacentHTML("beforeend", planCard(result) + resultCard(job.id, result));
  body.querySelector("[data-action='show-path']")?.addEventListener("click", () => {
    const paths = [
      result.planPath && `Plan: ${result.planPath}`,
      result.manifestPath && `Manifest: ${result.manifestPath}`,
      result.captionsPath && `Captions: ${result.captionsPath}`,
      result.musicPath && `Music: ${result.musicPath}`,
      ...(result.voicePaths || []).map((item, index) => `Voice ${index + 1}: ${item}`),
      ...(result.renderResult?.outputs || []).map((item) => `Video ${item.id}: ${item.videoPath}`),
      result.renderResult?.licenseReportPath && `Rights: ${result.renderResult.licenseReportPath}`,
    ].filter(Boolean);
    window.alert(paths.join("\n") || "No artifact paths were returned.");
  });
  body.querySelectorAll("[data-output-id]").forEach((button) => button.addEventListener("click", () => {
    const card = body.querySelector(".result-card");
    const video = card?.querySelector("video");
    if (!video) return;
    video.src = outputVideoUrl(button.dataset.jobId, button.dataset.outputId);
    video.play().catch(() => undefined);
  }));
  scrollToBottom();
}

function showFailed(article, message) {
  const body = article.querySelector(".message-body");
  const meta = article.querySelector(".message-meta span");
  if (meta) {
    meta.textContent = "blocked";
    meta.style.color = "#ffaaaa";
  }
  body.querySelector(".progress-card")?.remove();
  body.insertAdjacentHTML("beforeend", `<section class="error-card"><b>Production stopped safely</b><p>${escapeHtml(message)}</p></section>`);
  scrollToBottom();
}

function currentFormat() {
  return state.formats[state.formatIndex];
}

function requestedPayload(prompt) {
  const sound = elements.soundDirection.value.trim();
  const completePrompt = sound ? `${prompt}\n\nSound direction: ${sound}` : prompt;
  const provider = elements.mediaProvider.value;
  const seed = Number(elements.seed.value);
  return {
    prompt: completePrompt,
    mode: elements.mode.value,
    durationSeconds: Number(elements.duration.value) || undefined,
    narration: elements.narration.value.trim() || undefined,
    presets: currentFormat().presets,
    sceneSources: state.sceneSources,
    characters: state.characters,
    logoSource: state.logoSource,
    musicSource: state.musicSource,
    generateVoice: elements.generateVoice.checked,
    generateMusic: elements.generateMusic.checked && !state.musicSource,
    voiceProvider: elements.voiceProvider.value,
    voice: elements.voiceName.value.trim() || undefined,
    voiceReference: state.voiceReference,
    voiceConsent: elements.voiceProvider.value === "local-clone" ? {
      speakerName: elements.voiceSpeaker.value.trim(),
      confirmed: elements.voiceConsent.checked,
      scope: "this Agent Demo Studio video project",
    } : undefined,
    plannerProvider: "auto",
    plannerProfile: elements.plannerProfile.value,
    mediaProvider: provider,
    mediaTask: elements.mediaTask.value,
    ltxDesktopUrl: provider === "ltx-desktop" ? elements.ltxUrl.value.trim() || undefined : undefined,
    allowCloudMedia: provider === "ltx-desktop" && elements.allowCloudMedia.checked,
    comfyuiUrl: provider === "comfyui" ? elements.comfyUiUrl.value.trim() || undefined : undefined,
    comfyuiWorkflow: provider === "comfyui" ? elements.comfyUiWorkflow.value.trim() || undefined : undefined,
    mediaAdapterUrl: provider === "local-adapter" ? elements.mediaAdapterUrl.value.trim() || undefined : undefined,
    negativePrompt: elements.negativePrompt.value.trim() || undefined,
    seed: Number.isFinite(seed) && elements.seed.value.trim() ? seed : undefined,
    render: true,
  };
}

async function pollJob(jobId, article) {
  while (state.currentJobId === jobId) {
    const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    updateProgress(article, job.progress, job.message);
    if (job.state === "completed") {
      showCompleted(article, job);
      return;
    }
    if (job.state === "failed") throw new Error(job.error || job.message || "The video job failed.");
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

async function generateVideo() {
  const prompt = elements.prompt.value.trim();
  if (!prompt || state.busy) {
    if (!prompt) {
      elements.prompt.focus();
      elements.prompt.setAttribute("placeholder", "Tell me what should happen in the video first.");
    }
    return;
  }
  state.busy = true;
  elements.generate.disabled = true;
  elements.generate.querySelector("span").textContent = "Working…";
  elements.starters?.setAttribute("hidden", "");
  appendUserMessage(prompt);
  const article = appendAssistantShell();
  elements.prompt.value = "";
  try {
    const job = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestedPayload(prompt)),
    });
    state.currentJobId = job.id;
    await pollJob(job.id, article);
  } catch (error) {
    showFailed(article, error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    state.currentJobId = undefined;
    elements.generate.disabled = false;
    elements.generate.querySelector("span").textContent = "Generate video";
    refreshProjects().catch(() => undefined);
  }
}

function openTool(tool) {
  const [kicker, title] = toolLabels[tool] || ["STUDIO", "Settings"];
  elements.drawerKicker.textContent = kicker;
  elements.drawerTitle.textContent = title;
  $$(".drawer-panel").forEach((panel) => { panel.hidden = panel.dataset.panel !== tool; });
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  elements.drawer.classList.add("open");
  elements.drawer.setAttribute("aria-hidden", "false");
  if (tool === "projects") refreshProjects().catch(() => undefined);
  if (tool === "engines") refreshEngines().catch(() => undefined);
}

function closeDrawer() {
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
}

async function uploadFile(file, kind) {
  const payload = await api(`/api/uploads?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  return { ...payload, name: file.name };
}

function addAttachment(item, role) {
  const id = `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.attachments.push({ id, role, ...item });
  if (role === "scene") state.sceneSources.push(item.path);
  if (role === "character") state.characters.push({ id, name: item.name.replace(/\.[^.]+$/, ""), source: item.path, role: "character", rights: "User-provided authorized media" });
  if (role === "logo") state.logoSource = item.path;
  if (role === "music") state.musicSource = item.path;
  if (role === "voice-reference") state.voiceReference = item.path;
  renderAttachments();
}

function removeAttachment(id) {
  const item = state.attachments.find((candidate) => candidate.id === id);
  if (!item) return;
  state.attachments = state.attachments.filter((candidate) => candidate.id !== id);
  if (item.role === "scene") state.sceneSources = state.sceneSources.filter((value) => value !== item.path);
  if (item.role === "character") state.characters = state.characters.filter((value) => value.id !== id);
  if (item.role === "logo" && state.logoSource === item.path) state.logoSource = undefined;
  if (item.role === "music" && state.musicSource === item.path) state.musicSource = undefined;
  if (item.role === "voice-reference" && state.voiceReference === item.path) state.voiceReference = undefined;
  renderAttachments();
}

function renderAttachments() {
  elements.attachmentStrip.hidden = state.attachments.length === 0;
  elements.attachmentStrip.innerHTML = state.attachments.map((item) => `
    <div class="attachment-chip"><b>${escapeHtml(item.role)}</b><span>${escapeHtml(item.name)}</span><button type="button" data-remove-attachment="${escapeHtml(item.id)}">×</button></div>`).join("");
  elements.attachmentStrip.querySelectorAll("[data-remove-attachment]").forEach((button) => button.addEventListener("click", () => removeAttachment(button.dataset.removeAttachment)));
  elements.mediaCount.textContent = String(state.attachments.length);
  elements.uploadState.textContent = state.attachments.length
    ? `${state.attachments.length} local asset${state.attachments.length === 1 ? "" : "s"} ready. Their paths and declared rights will be preserved in the production plan.`
    : "Nothing uploaded yet.";
}

async function uploadSelection(input, kind) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  elements.uploadState.textContent = `Uploading ${files.length} local file${files.length === 1 ? "" : "s"}…`;
  try {
    for (const file of files) addAttachment(await uploadFile(file, kind), kind);
  } catch (error) {
    elements.uploadState.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    input.value = "";
  }
}

async function refreshProjects() {
  const jobs = await api("/api/jobs");
  const holder = $("#project-cards");
  if (!jobs.length) {
    holder.innerHTML = '<p class="empty-copy">No jobs yet. Your first generated video will appear here.</p>';
    return;
  }
  holder.innerHTML = jobs.slice(0, 20).map((job) => `
    <div class="project-card ${escapeHtml(job.state)}">
      <span></span><div><b>${escapeHtml(job.type)}</b><small>${escapeHtml(job.message)}</small></div><i>${Math.round(job.progress || 0)}%</i>
    </div>`).join("");
}

function capabilityCard(item) {
  return `
    <div class="engine-card ${escapeHtml(item.status)}">
      <span></span>
      <div><b>${escapeHtml(item.label)}</b><small title="${escapeHtml(item.detail)}">${escapeHtml(item.detail)}</small></div>
      <i>${item.available ? "READY" : item.status.toUpperCase()}</i>
    </div>`;
}

async function refreshEngines() {
  elements.engineCards.innerHTML = '<div class="engine-card loading"><span></span><div><b>Inspecting local engines…</b><small>Checking Qwen, LTX, Wan, animation, voice, and render tools.</small></div></div>';
  const status = await api("/api/engines/status");
  const wanted = ["planner.ollama-qwen", "visuals.ltx-desktop", "visuals.wan-animate-2", "visuals.animated", "visuals.comfyui-video", "voice.system", "rendering.ffmpeg"];
  const capabilities = status.capabilities?.capabilities || [];
  elements.engineCards.innerHTML = wanted.map((id) => capabilities.find((item) => item.id === id)).filter(Boolean).map(capabilityCard).join("");
  const qwenReady = status.planner?.available;
  const ltxReady = status.ltx?.localGenerationAvailable;
  const light = $("#sidebar-engine-light");
  light.className = `engine-light ${qwenReady ? (ltxReady ? "" : "warning") : "warning"}`;
  $("#sidebar-engine-title").textContent = qwenReady ? "Qwen planner ready" : "Deterministic planner ready";
  $("#sidebar-engine-copy").textContent = ltxReady ? "LTX local video ready" : status.ltx?.installed ? "LTX installed · backend unavailable" : "Local 2D animation ready";
}

function resetChat() {
  if (state.busy) return;
  elements.chat.innerHTML = initialChat;
  elements.prompt.value = "";
  bindStarters();
  closeDrawer();
  elements.prompt.focus();
}

function bindStarters() {
  $$(".starter").forEach((button) => button.addEventListener("click", () => {
    elements.prompt.value = button.dataset.prompt || "";
    elements.mode.value = button.dataset.mode || "auto";
    syncChips();
    elements.prompt.focus();
  }));
}

function syncChips() {
  const modeOption = elements.mode.options[elements.mode.selectedIndex];
  $("#mode-chip-value").textContent = modeOption?.textContent?.replace(" / education", "") || "Auto";
  $("#format-chip-value").textContent = currentFormat().label;
  const engineOption = elements.mediaProvider.options[elements.mediaProvider.selectedIndex];
  $("#engine-chip-value").textContent = (engineOption?.textContent || "Auto").split("·")[0].trim();
}

$$(".nav-item").forEach((button) => button.addEventListener("click", () => openTool(button.dataset.tool)));
$("#drawer-close").addEventListener("click", closeDrawer);
$("#open-engines-button").addEventListener("click", () => openTool("engines"));
$("#capability-refresh").addEventListener("click", () => refreshEngines().catch((error) => {
  elements.engineCards.innerHTML = `<div class="engine-card unavailable"><span></span><div><b>Engine check failed</b><small>${escapeHtml(error.message)}</small></div></div>`;
}));
$("#refresh-projects").addEventListener("click", () => refreshProjects().catch(() => undefined));
$("#new-video-button").addEventListener("click", resetChat);
$("#generate-button").addEventListener("click", generateVideo);
$("#attach-button").addEventListener("click", () => elements.quickFile.click());
$("#quick-file-input").addEventListener("change", async () => {
  for (const file of [...(elements.quickFile.files || [])]) {
    const kind = file.type.startsWith("audio/") ? "music" : "scene";
    addAttachment(await uploadFile(file, kind), kind);
  }
  elements.quickFile.value = "";
});
$("#prompt-scene-files").addEventListener("change", (event) => uploadSelection(event.currentTarget, "scene"));
$("#prompt-character-files").addEventListener("change", (event) => uploadSelection(event.currentTarget, "character"));
$("#prompt-logo-file").addEventListener("change", (event) => uploadSelection(event.currentTarget, "logo"));
$("#prompt-music-file").addEventListener("change", (event) => uploadSelection(event.currentTarget, "music"));
$("#prompt-voice-reference-file").addEventListener("change", (event) => uploadSelection(event.currentTarget, "voice-reference"));
$("#mode-chip").addEventListener("click", () => openTool("create"));
$("#engine-chip").addEventListener("click", () => openTool("advanced"));
$("#format-chip").addEventListener("click", () => {
  state.formatIndex = (state.formatIndex + 1) % state.formats.length;
  syncChips();
});
elements.mode.addEventListener("change", syncChips);
elements.mediaProvider.addEventListener("change", syncChips);
elements.generateMusic.addEventListener("change", () => { elements.musicMirror.checked = elements.generateMusic.checked; });
elements.musicMirror.addEventListener("change", () => { elements.generateMusic.checked = elements.musicMirror.checked; });
elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    generateVideo();
  }
});
$("#website-prepare").addEventListener("click", () => {
  const url = $("#website-url").value.trim();
  const goal = $("#website-goal").value.trim();
  if (!url) return $("#website-url").focus();
  elements.prompt.value = `Create a polished website product demo for ${url}. ${goal || "Open with the landing page, scroll naturally, demonstrate the primary workflow, and finish with a clear recap."} Plan every page and interaction before recording. Use natural cursor movement, readable zoom, scene-aligned narration, captions, and soft music.`;
  elements.mode.value = "product-launch";
  syncChips();
  closeDrawer();
  elements.prompt.focus();
});

bindStarters();
syncChips();
renderAttachments();
refreshEngines().catch((error) => {
  $("#sidebar-engine-title").textContent = "Local tools available";
  $("#sidebar-engine-copy").textContent = error instanceof Error ? error.message : "Engine status unavailable";
});
