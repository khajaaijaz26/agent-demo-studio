const state = { projects: [], selected: null };

const elements = {
  list: document.querySelector("#project-list"),
  workspace: document.querySelector("#workspace"),
  empty: document.querySelector("#empty-state"),
  title: document.querySelector("#project-title"),
  status: document.querySelector("#status-pill"),
  video: document.querySelector("#preview-video"),
  placeholder: document.querySelector("#video-placeholder"),
  url: document.querySelector("#browser-url"),
  timeline: document.querySelector("#timeline"),
  eventCount: document.querySelector("#event-count"),
  titleInput: document.querySelector("#title-input"),
  subtitleInput: document.querySelector("#subtitle-input"),
  backgroundStart: document.querySelector("#background-start"),
  backgroundEnd: document.querySelector("#background-end"),
  accent: document.querySelector("#accent"),
  highlight: document.querySelector("#highlight"),
  narration: document.querySelector("#narration"),
  generatedMusic: document.querySelector("#generated-music"),
  captions: document.querySelector("#captions"),
  feedback: document.querySelector("#feedback"),
  render: document.querySelector("#render-button"),
  voice: document.querySelector("#voice-button"),
  refresh: document.querySelector("#refresh-button"),
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

function feedback(message, kind = "") {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback ${kind}`;
}

function renderProjectList() {
  elements.list.innerHTML = state.projects
    .map(
      (project) => `<button class="project-item ${state.selected?.id === project.id ? "active" : ""}" data-id="${escapeHtml(project.id)}">
        <b>${escapeHtml(project.title)}</b><small>${escapeHtml(project.status)} · ${new Date(project.updatedAt).toLocaleDateString()}</small>
      </button>`,
    )
    .join("");
  elements.list.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => selectProject(button.dataset.id));
  });
}

function renderSelectedProject() {
  const project = state.selected;
  if (!project) {
    elements.workspace.classList.add("hidden");
    elements.empty.classList.remove("hidden");
    elements.title.textContent = "Your demo projects";
    return;
  }
  elements.empty.classList.add("hidden");
  elements.workspace.classList.remove("hidden");
  elements.title.textContent = project.title;
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
    ? project.events
        .map(
          (event) => `<div class="timeline-event"><b>${escapeHtml(event.label || event.type)}</b><small>${(event.startedAtMs / 1000).toFixed(1)}s · ${escapeHtml(event.pageUrl)}</small></div>`,
        )
        .join("")
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

elements.refresh.addEventListener("click", () => refresh().catch((error) => feedback(error.message, "error")));

elements.voice.addEventListener("click", async () => {
  if (!state.selected) return;
  elements.voice.disabled = true;
  feedback("Generating voice-over with your system voice...");
  try {
    await api(`/api/projects/${state.selected.id}/voice`, {
      method: "POST",
      body: JSON.stringify({ narration: elements.narration.value }),
    });
    await refresh(state.selected.id);
    feedback("Voice-over generated successfully.", "success");
  } catch (error) {
    feedback(error.message, "error");
  } finally {
    elements.voice.disabled = false;
  }
});

elements.render.addEventListener("click", async () => {
  if (!state.selected) return;
  elements.render.disabled = true;
  feedback("Rendering the final 1080p demo. This can take a minute...");
  try {
    await api(`/api/projects/${state.selected.id}/render`, {
      method: "POST",
      body: JSON.stringify({
        title: elements.titleInput.value,
        subtitle: elements.subtitleInput.value,
        narration: elements.narration.value,
        useGeneratedMusic: elements.generatedMusic.checked,
        theme: {
          backgroundStart: elements.backgroundStart.value,
          backgroundEnd: elements.backgroundEnd.value,
          accent: elements.accent.value,
          highlight: elements.highlight.value,
        },
        render: { captions: elements.captions.checked },
      }),
    });
    await refresh(state.selected.id);
    feedback("1080p master rendered and ready to play.", "success");
  } catch (error) {
    feedback(error.message, "error");
  } finally {
    elements.render.disabled = false;
  }
});

refresh().catch((error) => feedback(error.message, "error"));
