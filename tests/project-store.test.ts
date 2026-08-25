import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, listProjects, loadProject, updateProject } from "../src/project-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("project store", () => {
  it("creates, updates, and lists portable projects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-demo-store-"));
    temporaryDirectories.push(root);
    const project = await createProject({
      id: "sample-project",
      title: "Sample Project",
      url: "https://example.com",
      root,
    });
    expect(project.status).toBe("draft");
    await updateProject(project.id, (current) => {
      current.status = "recorded";
      current.events.push({
        id: "event-1",
        type: "wait",
        milliseconds: 100,
        startedAtMs: 0,
        completedAtMs: 100,
        pageUrl: "https://example.com",
      });
    }, root);
    expect((await loadProject(project.id, root)).events).toHaveLength(1);
    expect((await listProjects(root)).map((item) => item.id)).toEqual(["sample-project"]);
  });
});
