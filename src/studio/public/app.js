const state = {
  mode: "projects",
  projects: [],
  selected: null,
  presets: [],
  templates: [],
  creatorAssets: null,
  creatorManifest: null,
  creatorResult: null,
  creatorJobId: null,
  promptUploads: {
    sceneSources: [],
    characters: [],
    logoSource: null,
    musicSource: null,
    voiceReference: null,
  },
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  modeButtons: [...document.querySelectorAll(".mode-button")],
  projectNavigation: $("#project-navigation"),
  creatorNavigation: $("#creator-navigation"),
  projectsView: $("#projects-view"),
  creatorView: $("#creator-view"),
  workspaceEyebrow: $("#workspace-eyebrow"),
  workspaceTitle: $("#workspace-title"),
  workspaceDescription: $("#workspace-description"),
  list: $("#project-list"),
  workspace: $("#workspace"),
  empty: $("#empty-state"),
  status: $("#status-pill"),
  video: $("#preview-video"),
  placeholder: $("#video-placeholder"),
  url: $("#browser-url"),
  timeline: $("#timeline"),
  eventCount: $("#event-count"),
  titleInput: $("#title-input"),
  subtitleInput: $("#subtitle-input"),
  backgroundStart: $("#background-start"),
  backgroundEnd: $("#background-end"),
  accent: $("#accent"),
  highlight: $("#highlight"),
  narration: $("#narration"),
  generatedMusic: $("#generated-music"),
  captions: $("#captions"),
  feedback: $("#feedback"),
  render: $("#render-button"),
  voice: $("#voice-button"),
  refresh: $("#refresh-button"),
  presetCount: $("#preset-count"),
  presetGrid: $("#preset-grid"),
  templateSelect: $("#template-select"),
  promptText: $("#prompt-text"),
  promptNarration: $("#prompt-narration"),
  promptMode: $("#prompt-mode"),
  promptPresenter: $("#prompt-presenter"),
  promptPlannerProvider: $("#prompt-planner-provider"),
  promptPlannerProfile: $("#prompt-planner-profile"),
  promptMediaProvider: $("#prompt-media-provider"),
  promptMediaTask: $("#prompt-media-task"),
  promptVoiceProvider: $("#prompt-voice-provider"),
  promptDuration: $("#prompt-duration"),
  promptVoice: $("#prompt-voice"),
  promptMusic: $("#prompt-music"),
  promptPlanButton: $("#prompt-plan-button"),
  promptButton: $("#prompt-button"),
  promptRenderButton: $("#prompt-render-button"),
  promptPlanPreview: $("#prompt-plan-preview"),
  promptPlanSummary: $("#prompt-plan-summary"),
  promptPlanResources: $("#prompt-plan-resources"),
  localAiTitle: $("#local-ai-title"),
  localAiDetail: $("#local-ai-detail"),
  localAiWarm: $("#local-ai-warm"),
  localAiCard: $(".local-ai-card"),
  promptSceneFiles: $("#prompt-scene-files"),
  promptCharacterFiles: $("#prompt-character-files"),
  promptLogoFile: $("#prompt-logo-file"),
  promptMusicFile: $("#prompt-music-file"),
  promptVoiceReferenceFile: $("#prompt-voice-reference-file"),
  promptSceneUploadStatus: $("#prompt-scene-upload-status"),
  promptCharacterUploadStatus: $("#prompt-character-upload-status"),
  promptLogoUploadStatus: $("#prompt-logo-upload-status"),
  promptMusicUploadStatus: $("#prompt-music-upload-status"),
  promptVoiceUploadStatus: $("#prompt-voice-upload-status"),
  promptVoiceSpeaker: $("#prompt-voice-speaker"),
  promptVoiceConsent: $("#prompt-voice-consent"),
  promptMediaAdapterUrl: $("#prompt-media-adapter-url"),
  promptVoiceCloneUrl: $("#prompt-voice-clone-url"),
  promptMusicStyle: $("#prompt-music-style"),
  promptMusicDuration: $("#prompt-music-duration"),
  promptGenerateMusic: $("#prompt-generate-music"),
  promptGeneratedMusicStatus: $("#prompt-generated-music-status"),
  creatorTitle: $("#creator-title"),
  creatorSource: $("#creator-source"),
  creatorOutput: $("#creator-output"),
  templateButton: $("#template-button"),
  creatorManifest: $("#creator-manifest"),
  formatManifest: $("#format-manifest"),
  copyManifest: $("#copy-manifest"),
  validate: $("#validate-button"),
  analyze: $("#analyze-button"),
  transcribe: $("#transcribe-button"),
  creatorRender: $("#creator-render-button"),
  creatorFeedback: $("#creator-feedback"),
  jobPanel: $("#job-panel"),
  jobTitle: $("#job-title"),
  jobPercent: $("#job-percent"),
  jobProgress: $("#job-progress"),
  jobMessage: $("#job-message"),
  creatorVideo: $("#creator-video"),
  creatorPlaceholder: $("#creator-placeholder"),
  creatorPreviewLabel: $("#creator-preview-label"),
  creatorResolution: $("#creator-resolution"),
  results: $("#creator-results"),
  outputList: $("#output-list"),
  packageButton: $("#package-button"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error || "Request failed");
  return payload;
}

function renderLocalAiStatus(status) {
  const ready = Boolean(status?.available && status?.selectedModel);
  elements.localAiCard.classList.toggle("unavailable", !ready);
  elements.localAiTitle.textContent = ready ? `${status.selectedModel} · ${status.profile} · local` : "Instant local planner ready";
  elements.localAiDetail.textContent = ready ? "0 paid API tokens · loopback only · 30 minute keep-alive" : (status?.message || "Qwen is optional; deterministic planning never blocks creation");
  elements.localAiWarm.disabled = !ready;
}

async function refreshLocalAiStatus() {
  const profile = elements.promptPlannerProfile?.value || "fast";
  const status = await api(`/api/local-ai/status?profile=${encodeURIComponent(profile)}`);
  renderLocalAiStatus(status);
  return status;
}

async function uploadFile(file, kind) {
  const response = await fetch(`/api/uploads?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `Could not upload ${file.name}`);
  return payload;
}

async function uploadSelection(input, kind, statusElement, apply) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  input.disabled = true;
  statusElement.textContent = `Uploading ${files.length} local file${files.length === 1 ? "" : "s"}…`;
  try {
    const uploaded = [];
    for (const file of files) uploaded.push({ file, result: await uploadFile(file, kind) });
    apply(uploaded);
    statusElement.textContent = `${uploaded.length} local file${uploaded.length === 1 ? "" : "s"} ready`;
    creatorFeedback("Uploads are ready and will be recorded in the production resource list.", "success");
  } finally {
    input.disabled = false;
  }
}

function feedback(message, kind = "") {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback ${kind}`;
}

function creatorFeedback(message, kind = "") {
  elements.creatorFeedback.textContent = message;
  elements.creatorFeedback.className = `feedback ${kind}`;
}

function setMode(mode) {
  state.mode = mode;
  const creator = mode === "creator";
  elements.modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  elements.projectsView.classList.toggle("hidden", creator);
  elements.creatorView.classList.toggle("hidden", !creator);
  elements.projectNavigation.classList.toggle("hidden", creator);
  elements.creatorNavigation.classList.toggle("hidden", !creator);
  elements.workspaceEyebrow.textContent = creator ? "LOCAL CREATOR ENGINE" : "BROWSER DEMO WORKSPACE";
  elements.workspaceTitle.textContent = creator ? "Creator Studio" : state.selected?.title || "Your demo projects";
  elements.workspaceDescription.textContent = creator
    ? "One non-destructive timeline for YouTube, Shorts, Reels, TikTok, feeds, stories, podcasts, and 4K."
    : "Record a real product flow, then narrate and polish it locally.";
  elements.status.textContent = creator ? "CREATOR READY" : (state.selected?.status || "READY").toUpperCase();
  if (creator && !state.templates.length) initializeCreator().catch((error) => creatorFeedback(error.message, "error"));
}

function renderProjectList() {
  elements.list.innerHTML = state.projects
    .map((project) => `<button class="project-item ${state.selected?.id === project.id ? "active" : ""}" data-id="${escapeHtml(project.id)}">
      <b>${escapeHtml(project.title)}</b><small>${escapeHtml(project.status)} · ${new Date(project.updatedAt).toLocaleDateString()}</small>
    </button>`)
    .join("");
  elements.list.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => selectProject(button.dataset.id)));
}

function renderSelectedProject() {
  const project = state.selected;
  if (!project) {
    elements.workspace.classList.add("hidden");
    elements.empty.classList.remove("hidden");
    if (state.mode === "projects") elements.workspaceTitle.textContent = "Your demo projects";
    return;
  }
  elements.empty.classList.add("hidden");
  elements.workspace.classList.remove("hidden");
  if (state.mode === "projects") elements.workspaceTitle.textContent = project.title;
  elements.status.textContent = project.status.toUpperCase();
  elements.url.textContent = project.url.replace(/^https?:\/\//, "");
  elements.titleInput.value = project.title;
  elements.subtitleInput.value = project.subtitle;
  elements.backgroundStart.value = project.theme.backgroundStart;
  elements.backgroundEnd.value = project.theme.backgroundEnd;
  elements.accent.value = project.theme.accent;
  elements.highlight.value = project.theme.highlight;
  elements.narration.value = project.audio.narration || "";
  elements.generatedMusic.checked = project.audio.useGeneratedMusic;
  elements.captions.checked = project.render.captions;
  elements.eventCount.textContent = `${project.events.length} action${project.events.length === 1 ? "" : "s"}`;
  elements.timeline.innerHTML = project.events.length
    ? project.events.map((event) => `<div class="timeline-event"><b>${escapeHtml(event.label || event.type)}</b><small>${(event.startedAtMs / 1000).toFixed(1)}s · ${escapeHtml(event.pageUrl)}</small></div>`).join("")
    : '<div class="timeline-event"><b>Overview</b><small>No scripted actions</small></div>';
  if (project.artifacts.finalVideo) {
    elements.placeholder.classList.add("hidden");
    elements.video.classList.remove("hidden");
    elements.video.src = `/api/projects/${project.id}/video?v=${Date.now()}`;
  } else {
    elements.video.removeAttribute("src");
    elements.video.load();
    elements.video.classList.add("hidden");
    elements.placeholder.classList.remove("hidden");
  }
  renderProjectList();
}

async function selectProject(id) {
  state.selected = await api(`/api/projects/${id}`);
  renderSelectedProject();
}

async function refresh(preferredId) {
  state.projects = await api("/api/projects");
  const id = preferredId || state.selected?.id || state.projects[0]?.id;
  if (id) await selectProject(id);
  else {
    state.selected = null;
    renderProjectList();
    renderSelectedProject();
  }
}

function readManifest() {
  try {
    return JSON.parse(elements.creatorManifest.value);
  } catch (error) {
    throw new Error(`Manifest JSON is invalid: ${error.message}`);
  }
}

function writeManifest(manifest) {
  state.creatorManifest = manifest;
  elements.creatorManifest.value = JSON.stringify(manifest, null, 2);
  renderPresetGrid();
}

function selectedPresetIds() {
  return [...elements.presetGrid.querySelectorAll("input:checked")].map((input) => input.value);
}

function syncSelectedPresets() {
  const manifest = readManifest();
  const existing = new Map((manifest.exports || []).map((item) => [item.preset, item]));
  manifest.exports = selectedPresetIds().map((preset, index) => existing.get(preset) || { id: preset === "youtube-1080p" ? "youtube" : `${preset}-${index + 1}`, preset });
  state.creatorManifest = manifest;
  elements.creatorManifest.value = JSON.stringify(manifest, null, 2);
}

function renderPresetGrid() {
  const selected = new Set((state.creatorManifest?.exports || []).map((item) => item.preset));
  elements.presetGrid.innerHTML = state.presets.map((preset) => {
    const ratioClass = preset.width === preset.height ? "square" : preset.width > preset.height ? "landscape" : preset.aspectRatio === "4:5" ? "portrait" : "vertical";
    return `<label class="preset-option ${selected.has(preset.id) ? "selected" : ""}">
    <input type="checkbox" value="${escapeHtml(preset.id)}" ${selected.has(preset.id) ? "checked" : ""} />
    <span class="ratio-icon ratio-${ratioClass}"></span>
    <span><b>${escapeHtml(preset.label)}</b><small>${preset.width}×${preset.height} · ${escapeHtml(preset.aspectRatio)}</small></span>
    <i>✓</i>
  </label>`;
  }).join("");
  elements.presetGrid.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
    input.closest("label").classList.toggle("selected", input.checked);
    if (!selectedPresetIds().length) {
      input.checked = true;
      input.closest("label").classList.add("selected");
    }
    try { syncSelectedPresets(); } catch (error) { creatorFeedback(error.message, "error"); }
  }));
}

async function loadTemplate() {
  const manifest = await api("/api/creator/template", {
    method: "POST",
    body: JSON.stringify({
      templateId: elements.templateSelect.value,
      title: elements.creatorTitle.value || "My creator project",
      source: elements.creatorSource.value || undefined,
      outputDirectory: elements.creatorOutput.value || "./creator-output",
    }),
  });
  writeManifest(manifest);
  creatorFeedback("Editable timeline created. Choose output profiles or customize the JSON.", "success");
}

async function initializeCreator() {
  const [presets, templates, creatorAssets, localAi] = await Promise.all([api("/api/creator/presets"), api("/api/creator/templates"), api("/api/creator/assets"), api("/api/local-ai/status?profile=fast")]);
  state.presets = presets;
  state.templates = templates;
  state.creatorAssets = creatorAssets;
  elements.presetCount.textContent = String(presets.length);
  elements.templateSelect.innerHTML = templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.label)}</option>`).join("");
  elements.promptMode.innerHTML = creatorAssets.promptModes.map((mode) => `<option value="${escapeHtml(mode)}">${escapeHtml(mode.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "))}</option>`).join("");
  const characters = creatorAssets.assets.filter((asset) => asset.kind === "presenter" || asset.kind === "character");
  elements.promptPresenter.innerHTML = '<option value="none">No character</option>' + characters.map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.label)} · ${escapeHtml(asset.style)}</option>`).join("");
  elements.promptPresenter.options[0].textContent = "No starter character";
  elements.promptPresenter.value = "none";
  renderLocalAiStatus(localAi);
  if (!state.creatorManifest) await loadTemplate();
  else renderPresetGrid();
}

function syncPromptCharacterToMode() {
  if (elements.promptMode.value === "asmr") elements.promptPresenter.value = "none";
}

async function createFromPrompt(render) {
  const job = await api("/api/creator/prompt", {
    method: "POST",
    body: JSON.stringify(promptRequest(render)),
  });
  state.creatorJobId = job.id;
  const created = await waitForJob(job, render ? "Creating and rendering prompt video" : "Creating prompt video project");
  showProductionPlan(created.plan);
  writeManifest(created.manifest);
  if (created.renderResult) {
    state.creatorResult = created.renderResult;
    renderCreatorResults();
    creatorFeedback(`${created.renderResult.outputs.length} prompt-video export${created.renderResult.outputs.length === 1 ? " is" : "s are"} ready.`, "success");
  } else creatorFeedback(`Editable ${created.mode} project created at ${created.manifestPath}.`, "success");
}

function promptRequest(render) {
  const prompt = elements.promptText.value.trim();
  if (!prompt) throw new Error("Describe the video you want to create first.");
  if (elements.promptVoiceProvider.value === "local-clone") {
    if (!state.promptUploads.voiceReference) throw new Error("Upload the authorized speaker's voice reference first.");
    if (!elements.promptVoiceSpeaker.value.trim() || !elements.promptVoiceConsent.checked) throw new Error("Record the speaker name and voice permission before using a local clone.");
  }
  return {
    prompt,
    narration: elements.promptNarration.value.trim() || undefined,
    mode: elements.promptMode.value,
    title: elements.creatorTitle.value || undefined,
    source: elements.creatorSource.value || undefined,
    sceneSources: state.promptUploads.sceneSources,
    characters: state.promptUploads.characters,
    logoSource: state.promptUploads.logoSource || undefined,
    musicSource: state.promptUploads.musicSource || undefined,
    outputDirectory: elements.creatorOutput.value || undefined,
    presenter: elements.promptPresenter.value,
    voiceProvider: elements.promptVoiceProvider.value,
    voiceReference: state.promptUploads.voiceReference || undefined,
    voiceConsent: elements.promptVoiceProvider.value === "local-clone" ? {
      speakerName: elements.promptVoiceSpeaker.value.trim(),
      confirmed: elements.promptVoiceConsent.checked,
      scope: "this video project",
    } : undefined,
    voiceCloneUrl: elements.promptVoiceCloneUrl.value.trim() || undefined,
    durationSeconds: elements.promptDuration.value ? Number(elements.promptDuration.value) : undefined,
    presets: selectedPresetIds().length ? selectedPresetIds() : ["youtube-1080p"],
    generateVoice: elements.promptVoice.checked,
    generateMusic: elements.promptMusic.checked,
    plannerProvider: elements.promptPlannerProvider.value,
    plannerProfile: elements.promptPlannerProfile.value,
    mediaProvider: elements.promptMediaProvider.value,
    mediaTask: elements.promptMediaTask.value,
    mediaAdapterUrl: elements.promptMediaAdapterUrl.value.trim() || undefined,
    render,
  };
}

function showProductionPlan(plan) {
  if (!plan) return;
  elements.promptPlanPreview.classList.remove("hidden");
  elements.promptPlanSummary.textContent = `${plan.scenes.length} scenes · ${plan.requirements.targetDurationSeconds}s · ${plan.requirements.outputPresets.join(", ")}`;
  elements.promptPlanResources.textContent = plan.resources.map((resource) => `${resource.status.toUpperCase()}  ${resource.category}\n${resource.requirement}\n${resource.source}`).join("\n\n");
  const intelligence = plan.intelligence?.provider === "ollama" ? `${plan.intelligence.model} local` : "instant local rules";
  elements.promptPlanSummary.textContent = `${plan.scenes.length} scenes · ${plan.requirements.targetDurationSeconds}s · ${intelligence}`;
  const resources = plan.resources.map((resource) => `${resource.status.toUpperCase()}  ${resource.category}\n${resource.requirement}\n${resource.source}`).join("\n\n");
  const rules = (plan.productionRules || []).map((rule) => `${rule.id.toUpperCase()}\n${rule.rule}\nGate: ${rule.qualityGate}`).join("\n\n");
  elements.promptPlanResources.textContent = `${resources}\n\nFIXED PRODUCTION RULES\n\n${rules}`;
}

async function reviewPromptPlan() {
  const plan = await api("/api/creator/plan", { method: "POST", body: JSON.stringify(promptRequest(false)) });
  showProductionPlan(plan);
  creatorFeedback("Plan ready. Review the storyboard and resources, then build the editable timeline or render.", "success");
}

function updateJob(job, title) {
  elements.jobPanel.classList.remove("hidden");
  elements.jobTitle.textContent = title;
  elements.jobPercent.textContent = `${Math.round(job.progress || 0)}%`;
  elements.jobProgress.value = Math.max(2, job.progress || 0);
  elements.jobMessage.textContent = job.message || job.state;
}

async function waitForJob(job, title) {
  updateJob(job, title);
  let current = job;
  while (current.state === "queued" || current.state === "running") {
    await new Promise((resolve) => setTimeout(resolve, 800));
    current = await api(`/api/jobs/${current.id}`);
    updateJob(current, title);
  }
  if (current.state === "failed") throw new Error(current.error || current.message || "Job failed");
  return current.result;
}

function previewCreatorOutput(output) {
  if (!state.creatorJobId) return;
  elements.creatorPlaceholder.classList.add("hidden");
  elements.creatorVideo.classList.remove("hidden");
  elements.creatorVideo.src = `/api/creator/jobs/${state.creatorJobId}/outputs/${encodeURIComponent(output.id)}/video?v=${Date.now()}`;
  elements.creatorPreviewLabel.textContent = output.id;
  elements.creatorResolution.textContent = `${output.width}×${output.height} · ${output.fps.toFixed(0)} FPS`;
  elements.outputList.querySelectorAll("button[data-output]").forEach((button) => button.classList.toggle("active", button.dataset.output === output.id));
}

function renderCreatorResults() {
  const result = state.creatorResult;
  if (!result?.outputs?.length) return;
  elements.results.classList.remove("hidden");
  elements.packageButton.classList.remove("hidden");
  elements.outputList.innerHTML = result.outputs.map((output) => `<button class="output-item" data-output="${escapeHtml(output.id)}">
    <span class="output-thumb"><img src="/api/creator/jobs/${state.creatorJobId}/outputs/${encodeURIComponent(output.id)}/thumbnail?v=${Date.now()}" alt="" /></span>
    <span><b>${escapeHtml(output.id)}</b><small>${escapeHtml(output.preset)} · ${output.durationSeconds.toFixed(1)}s · ${(output.fileSizeBytes / 1048576).toFixed(1)} MB</small></span>
    <i>${output.validation.some((issue) => issue.level === "error") ? "Review" : "Ready"}</i>
  </button>`).join("");
  elements.outputList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => previewCreatorOutput(result.outputs.find((item) => item.id === button.dataset.output))));
  previewCreatorOutput(result.outputs[0]);
}

function renderValidation(validation) {
  elements.results.classList.remove("hidden");
  elements.packageButton.classList.add("hidden");
  elements.outputList.innerHTML = validation.issues.length
    ? validation.issues.map((issue) => `<div class="validation-item ${escapeHtml(issue.level)}"><i>${issue.level === "error" ? "!" : issue.level === "warning" ? "△" : "i"}</i><span><b>${escapeHtml(issue.code)}</b><small>${escapeHtml(issue.message)}</small></span></div>`).join("")
    : '<div class="validation-item info"><i>✓</i><span><b>Timeline is valid</b><small>No schema or semantic issues found.</small></span></div>';
}

elements.modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
elements.refresh.addEventListener("click", () => (state.mode === "creator" ? initializeCreator() : refresh()).catch((error) => (state.mode === "creator" ? creatorFeedback(error.message, "error") : feedback(error.message, "error"))));

elements.voice.addEventListener("click", async () => {
  if (!state.selected) return;
  elements.voice.disabled = true;
  feedback("Generating voice-over with your system voice...");
  try {
    await api(`/api/projects/${state.selected.id}/voice`, { method: "POST", body: JSON.stringify({ narration: elements.narration.value }) });
    await refresh(state.selected.id);
    feedback("Voice-over generated successfully.", "success");
  } catch (error) { feedback(error.message, "error"); }
  finally { elements.voice.disabled = false; }
});

elements.render.addEventListener("click", async () => {
  if (!state.selected) return;
  elements.render.disabled = true;
  feedback("Rendering the final 1080p demo...");
  try {
    await api(`/api/projects/${state.selected.id}/render`, {
      method: "POST",
      body: JSON.stringify({
        title: elements.titleInput.value,
        subtitle: elements.subtitleInput.value,
        narration: elements.narration.value,
        useGeneratedMusic: elements.generatedMusic.checked,
        theme: { backgroundStart: elements.backgroundStart.value, backgroundEnd: elements.backgroundEnd.value, accent: elements.accent.value, highlight: elements.highlight.value },
        render: { captions: elements.captions.checked },
      }),
    });
    await refresh(state.selected.id);
    feedback("1080p master rendered and ready to play.", "success");
  } catch (error) { feedback(error.message, "error"); }
  finally { elements.render.disabled = false; }
});

elements.templateButton.addEventListener("click", () => loadTemplate().catch((error) => creatorFeedback(error.message, "error")));
elements.promptMode.addEventListener("change", syncPromptCharacterToMode);
elements.promptPlannerProfile.addEventListener("change", () => refreshLocalAiStatus().catch((error) => creatorFeedback(error.message, "error")));
elements.localAiWarm.addEventListener("click", async () => {
  elements.localAiWarm.disabled = true;
  elements.localAiDetail.textContent = "Loading the model into memory…";
  try {
    const result = await api("/api/local-ai/warm", { method: "POST", body: JSON.stringify({ profile: elements.promptPlannerProfile.value }) });
    await refreshLocalAiStatus();
    creatorFeedback(`${result.model} is warm for ${result.keepAlive}; the next plan starts faster.`, "success");
  } catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.localAiWarm.disabled = false; }
});
elements.promptSceneFiles.addEventListener("change", () => uploadSelection(elements.promptSceneFiles, "scene", elements.promptSceneUploadStatus, (uploaded) => {
  state.promptUploads.sceneSources = uploaded.map(({ result }) => result.path);
}).catch((error) => creatorFeedback(error.message, "error")));
elements.promptCharacterFiles.addEventListener("change", () => uploadSelection(elements.promptCharacterFiles, "character", elements.promptCharacterUploadStatus, (uploaded) => {
  state.promptUploads.characters = uploaded.map(({ file, result }, index) => ({
    id: `uploaded-character-${index + 1}`,
    name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
    source: result.path,
    role: "character",
    rights: "Teacher-uploaded or locally generated authorized character",
  }));
  elements.promptPresenter.value = "none";
}).catch((error) => creatorFeedback(error.message, "error")));
elements.promptLogoFile.addEventListener("change", () => uploadSelection(elements.promptLogoFile, "logo", elements.promptLogoUploadStatus, (uploaded) => {
  state.promptUploads.logoSource = uploaded[0]?.result.path || null;
}).catch((error) => creatorFeedback(error.message, "error")));
elements.promptMusicFile.addEventListener("change", () => uploadSelection(elements.promptMusicFile, "music", elements.promptMusicUploadStatus, (uploaded) => {
  state.promptUploads.musicSource = uploaded[0]?.result.path || null;
}).catch((error) => creatorFeedback(error.message, "error")));
elements.promptVoiceReferenceFile.addEventListener("change", () => uploadSelection(elements.promptVoiceReferenceFile, "voice-reference", elements.promptVoiceUploadStatus, (uploaded) => {
  state.promptUploads.voiceReference = uploaded[0]?.result.path || null;
  if (state.promptUploads.voiceReference) elements.promptVoiceProvider.value = "local-clone";
}).catch((error) => creatorFeedback(error.message, "error")));
elements.promptGenerateMusic.addEventListener("click", async () => {
  elements.promptGenerateMusic.disabled = true;
  try {
    const style = elements.promptMusicStyle.value;
    const durationSeconds = Number(elements.promptMusicDuration.value || elements.promptDuration.value || 45);
    const directory = (elements.creatorOutput.value || "./creator-output").replace(/[\\/]$/, "");
    const job = await api("/api/creator/music", {
      method: "POST",
      body: JSON.stringify({ style, durationSeconds, outputPath: `${directory}/${style}-music.wav` }),
    });
    const generated = await waitForJob(job, "Generating free local music");
    state.promptUploads.musicSource = generated.outputPath;
    elements.promptGeneratedMusicStatus.textContent = `${style} ready · ${durationSeconds}s · attached to this video`;
    elements.promptMusicUploadStatus.textContent = "Generated local music ready";
    creatorFeedback(`Original local music created at ${generated.outputPath}.`, "success");
  } catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.promptGenerateMusic.disabled = false; }
});
elements.promptPlanButton.addEventListener("click", async () => {
  elements.promptPlanButton.disabled = true;
  try { await reviewPromptPlan(); }
  catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.promptPlanButton.disabled = false; }
});
elements.promptButton.addEventListener("click", async () => {
  elements.promptButton.disabled = true;
  try { await createFromPrompt(false); }
  catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.promptButton.disabled = false; }
});
elements.promptRenderButton.addEventListener("click", async () => {
  elements.promptRenderButton.disabled = true;
  try { await createFromPrompt(true); }
  catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.promptRenderButton.disabled = false; }
});
elements.formatManifest.addEventListener("click", () => {
  try { writeManifest(readManifest()); creatorFeedback("Manifest formatted.", "success"); }
  catch (error) { creatorFeedback(error.message, "error"); }
});
elements.copyManifest.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(elements.creatorManifest.value); creatorFeedback("Manifest copied to clipboard.", "success"); }
  catch { creatorFeedback("Clipboard access was unavailable. Select the JSON and copy it manually.", "error"); }
});

elements.validate.addEventListener("click", async () => {
  elements.validate.disabled = true;
  try {
    const validation = await api("/api/creator/validate", { method: "POST", body: JSON.stringify({ manifest: readManifest() }) });
    renderValidation(validation);
    creatorFeedback(validation.valid ? "Timeline is render-ready." : "Fix the errors shown below before rendering.", validation.valid ? "success" : "error");
  } catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.validate.disabled = false; }
});

elements.creatorRender.addEventListener("click", async () => {
  elements.creatorRender.disabled = true;
  state.creatorResult = null;
  creatorFeedback("Preparing selected formats. Large projects can take several minutes...");
  try {
    const job = await api("/api/creator/render", { method: "POST", body: JSON.stringify({ manifest: readManifest() }) });
    state.creatorJobId = job.id;
    state.creatorResult = await waitForJob(job, "Rendering creator timeline");
    renderCreatorResults();
    creatorFeedback(`${state.creatorResult.outputs.length} export${state.creatorResult.outputs.length === 1 ? " is" : "s are"} ready.`, "success");
  } catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.creatorRender.disabled = false; }
});

elements.analyze.addEventListener("click", async () => {
  elements.analyze.disabled = true;
  try {
    const manifest = readManifest();
    const source = elements.creatorSource.value || manifest.clips?.[0]?.source;
    if (!source) throw new Error("Add a source media path first.");
    const job = await api("/api/creator/analyze", { method: "POST", body: JSON.stringify({ source }) });
    const analysis = await waitForJob(job, "Analyzing media");
    manifest.metadata = { ...(manifest.metadata || {}), mediaAnalysis: analysis };
    writeManifest(manifest);
    creatorFeedback(`Found ${analysis.sceneChanges.length} scene changes, ${analysis.silence.length} silent ranges, and ${analysis.suggestedHighlights.length} highlight suggestions. Saved under metadata.mediaAnalysis.`, "success");
  } catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.analyze.disabled = false; }
});

elements.transcribe.addEventListener("click", async () => {
  elements.transcribe.disabled = true;
  try {
    const manifest = readManifest();
    const source = elements.creatorSource.value || manifest.clips?.[0]?.source;
    if (!source) throw new Error("Add a source media path first.");
    const job = await api("/api/creator/transcribe", { method: "POST", body: JSON.stringify({ source, format: "srt", model: "turbo" }) });
    const transcription = await waitForJob(job, "Generating captions");
    manifest.captions = { ...(manifest.captions || {}), source: transcription.captionsPath, format: "srt", burn: true, sidecar: true };
    writeManifest(manifest);
    creatorFeedback(`Captions generated at ${transcription.captionsPath}.`, "success");
  } catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.transcribe.disabled = false; }
});

elements.packageButton.addEventListener("click", async () => {
  if (!state.creatorResult) return;
  elements.packageButton.disabled = true;
  try {
    const packaged = await api("/api/creator/package", { method: "POST", body: JSON.stringify({ manifest: readManifest(), renderResult: state.creatorResult }) });
    creatorFeedback(`Publishing package created at ${packaged.directory}.`, "success");
  } catch (error) { creatorFeedback(error.message, "error"); }
  finally { elements.packageButton.disabled = false; }
});

refresh().catch((error) => feedback(error.message, "error"));
