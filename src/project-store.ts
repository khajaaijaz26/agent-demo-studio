import path from "node:path";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AgentDemoError } from "./errors.js";
import { getProjectsRoot } from "./config.js";
import {
  DEFAULT_AUDIO,
  DEFAULT_RENDER,
  DEFAULT_THEME,
  PROJECT_SCHEMA_VERSION,
  type CreateProjectInput,
  type DemoProject,
} from "./types.js";
import { slugify } from "./utils/text.js";

export function projectDirectory(projectId: string, root?: string): string {
  return path.join(getProjectsRoot(root), projectId);
}

export function projectManifestPath(projectId: string, root?: string): string {
  return path.join(projectDirectory(projectId, root), "project.json");
}

export function resolveArtifact(project: DemoProject, relativePath: string, root?: string): string {
  return path.resolve(projectDirectory(project.id, root), relativePath);
}

export async function createProject(input: CreateProjectInput): Promise<DemoProject> {
  const baseId = slugify(input.id || input.title);
  const id = input.id
    ? baseId
    : `${baseId}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const directory = projectDirectory(id, input.root);

  try {
    await mkdir(directory, { recursive: false });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      await mkdir(getProjectsRoot(input.root), { recursive: true });
      await mkdir(directory, { recursive: false });
    } else if (nodeError.code === "EEXIST") {
      throw new AgentDemoError("PROJECT_EXISTS", `Project '${id}' already exists.`);
    } else {
      throw error;
    }
  }

  await Promise.all(
    ["raw", "audio", "design", "exports", "screenshots", "captions"].map((name) =>
      mkdir(path.join(directory, name), { recursive: true }),
    ),
  );

  const now = new Date().toISOString();
  const project: DemoProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    title: input.title,
    subtitle: input.subtitle || "Recorded and edited by your AI agent",
    url: input.url,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    theme: { ...DEFAULT_THEME, ...input.theme },
    audio: { ...DEFAULT_AUDIO, ...input.audio },
    render: { ...DEFAULT_RENDER, ...input.render },
    events: [],
    artifacts: {},
  };

  await saveProject(project, input.root);
  return project;
}

export async function saveProject(project: DemoProject, root?: string): Promise<void> {
  const target = projectManifestPath(project.id, root);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const updated = { ...project, updatedAt: new Date().toISOString() };
  await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function loadProject(projectId: string, root?: string): Promise<DemoProject> {
  try {
    return JSON.parse(await readFile(projectManifestPath(projectId, root), "utf8")) as DemoProject;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      throw new AgentDemoError("PROJECT_NOT_FOUND", `Project '${projectId}' was not found.`);
    }
    throw error;
  }
}

export async function updateProject(
  projectId: string,
  mutator: (project: DemoProject) => void | Promise<void>,
  root?: string,
): Promise<DemoProject> {
  const project = await loadProject(projectId, root);
  await mutator(project);
  project.updatedAt = new Date().toISOString();
  await saveProject(project, root);
  return project;
}

export async function listProjects(root?: string): Promise<DemoProject[]> {
  const projectsRoot = getProjectsRoot(root);
  await mkdir(projectsRoot, { recursive: true });
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return await loadProject(entry.name, root);
        } catch {
          return undefined;
        }
      }),
  );
  return projects
    .filter((project): project is DemoProject => Boolean(project))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
