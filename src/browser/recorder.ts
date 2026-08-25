import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Disposable,
  type Locator,
  type Page,
} from "playwright";
import { AgentDemoError, errorMessage } from "../errors.js";
import { loadProject, projectDirectory, saveProject, updateProject } from "../project-store.js";
import type { BrowserAction, DemoProject, RecordedEvent } from "../types.js";

export interface StartBrowserSessionInput {
  projectId: string;
  root?: string;
  headless?: boolean;
  slowMotionMs?: number;
}

interface ActiveBrowserSession {
  id: string;
  projectId: string;
  root?: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  actionDecoration?: Disposable;
  rawVideoPath: string;
  startedAt: number;
}

export interface BrowserSessionSummary {
  sessionId: string;
  project: DemoProject;
  currentUrl: string;
  screenshotPath: string;
}

const sessions = new Map<string, ActiveBrowserSession>();

function relativeArtifact(projectId: string, filePath: string, root?: string): string {
  return path.relative(projectDirectory(projectId, root), filePath).replaceAll("\\", "/");
}

function resolveLocator(page: Page, action: BrowserAction): Locator {
  if (action.role) {
    return page.getByRole(action.role as Parameters<Page["getByRole"]>[0], {
      name: action.name || action.text,
    });
  }
  if (action.text && !action.selector) {
    return page.getByText(action.text, { exact: false });
  }
  if (action.selector) return page.locator(action.selector);
  throw new AgentDemoError(
    "LOCATOR_REQUIRED",
    `Action '${action.type}' requires selector, role/name, or text.`,
  );
}

async function settle(page: Page, milliseconds = 450): Promise<void> {
  await page.waitForTimeout(milliseconds);
}

export async function startBrowserSession(
  input: StartBrowserSessionInput,
): Promise<BrowserSessionSummary> {
  const project = await loadProject(input.projectId, input.root);
  const directory = projectDirectory(project.id, input.root);
  const rawVideoPath = path.join(directory, "raw", "browser.webm");
  const screenshotPath = path.join(directory, "screenshots", "latest.png");
  const sessionId = randomUUID();

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: input.headless ?? false,
      slowMo: Math.max(0, input.slowMotionMs ?? 120),
      args: ["--disable-notifications", "--window-size=1776,888"],
    });
    const context = await browser.newContext({
      viewport: { width: 1776, height: 888 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(project.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    await page.screencast.start({
      path: rawVideoPath,
      size: { width: 1776, height: 888 },
      quality: 100,
    });
    const actionDecoration = await page.screencast.showActions({
      cursor: "pointer",
      duration: 700,
      fontSize: 22,
      position: "top-right",
    });
    await page.screencast.showChapter(project.title, {
      description: project.subtitle,
      duration: 1_300,
    });
    await page.screenshot({ path: screenshotPath, type: "png" });

    sessions.set(sessionId, {
      id: sessionId,
      projectId: project.id,
      root: input.root,
      browser,
      context,
      page,
      actionDecoration,
      rawVideoPath,
      startedAt: Date.now(),
    });

    project.status = "recording";
    project.error = undefined;
    project.artifacts.screenshot = relativeArtifact(project.id, screenshotPath, input.root);
    await saveProject(project, input.root);

    return {
      sessionId,
      project,
      currentUrl: page.url(),
      screenshotPath,
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    const message = errorMessage(error);
    await updateProject(
      project.id,
      (current) => {
        current.status = "failed";
        current.error = message;
      },
      input.root,
    ).catch(() => undefined);
    if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
      throw new AgentDemoError(
        "BROWSER_NOT_INSTALLED",
        "Playwright Chromium is not installed. Run: npx playwright install chromium",
      );
    }
    throw error;
  }
}

export async function performBrowserAction(
  sessionId: string,
  action: BrowserAction,
): Promise<RecordedEvent> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new AgentDemoError("SESSION_NOT_FOUND", `Browser session '${sessionId}' is not active.`);
  }

  const startedAtMs = Date.now() - session.startedAt;
  const { page } = session;

  switch (action.type) {
    case "navigate":
      if (!action.url) throw new AgentDemoError("URL_REQUIRED", "Navigate requires a URL.");
      await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      await settle(page, action.milliseconds ?? 700);
      break;
    case "click": {
      const locator = resolveLocator(page, action).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      await settle(page, action.milliseconds ?? 650);
      break;
    }
    case "fill": {
      const locator = resolveLocator(page, action).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.fill(action.value ?? "");
      await settle(page, action.milliseconds ?? 450);
      break;
    }
    case "press":
      if (!action.key) throw new AgentDemoError("KEY_REQUIRED", "Press requires a key.");
      if (action.selector || action.role || action.text) {
        await resolveLocator(page, action).first().press(action.key);
      } else {
        await page.keyboard.press(action.key);
      }
      await settle(page, action.milliseconds ?? 400);
      break;
    case "hover": {
      const locator = resolveLocator(page, action).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.hover();
      await settle(page, action.milliseconds ?? 700);
      break;
    }
    case "scroll":
      await page.mouse.wheel(action.deltaX ?? 0, action.deltaY ?? 600);
      await settle(page, action.milliseconds ?? 700);
      break;
    case "wait":
      await page.waitForTimeout(action.milliseconds ?? 1_000);
      break;
    case "chapter":
      await page.screencast.showChapter(action.label || "Next", {
        description: action.description,
        duration: action.milliseconds ?? 1_200,
      });
      break;
    default: {
      const exhaustive: never = action.type;
      throw new AgentDemoError("ACTION_UNSUPPORTED", `Unsupported action: ${exhaustive}`);
    }
  }

  const completedAtMs = Date.now() - session.startedAt;
  const event: RecordedEvent = {
    ...action,
    id: randomUUID(),
    startedAtMs,
    completedAtMs,
    pageUrl: page.url(),
  };
  await updateProject(
    session.projectId,
    (project) => {
      project.events.push(event);
    },
    session.root,
  );
  return event;
}

export async function captureBrowserSnapshot(
  sessionId: string,
): Promise<{ data: string; mimeType: "image/png"; path: string; url: string }> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new AgentDemoError("SESSION_NOT_FOUND", `Browser session '${sessionId}' is not active.`);
  }
  const screenshotPath = path.join(
    projectDirectory(session.projectId, session.root),
    "screenshots",
    "latest.png",
  );
  const buffer = await session.page.screenshot({ path: screenshotPath, type: "png" });
  await updateProject(
    session.projectId,
    (project) => {
      project.artifacts.screenshot = relativeArtifact(project.id, screenshotPath, session.root);
    },
    session.root,
  );
  return {
    data: buffer.toString("base64"),
    mimeType: "image/png",
    path: screenshotPath,
    url: session.page.url(),
  };
}

export async function finishBrowserSession(sessionId: string): Promise<DemoProject> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new AgentDemoError("SESSION_NOT_FOUND", `Browser session '${sessionId}' is not active.`);
  }

  try {
    await settle(session.page, 500);
    await captureBrowserSnapshot(sessionId);
    await session.actionDecoration?.dispose();
    await session.page.screencast.stop();
    await session.context.close();
    await session.browser.close();
    sessions.delete(sessionId);

    return await updateProject(
      session.projectId,
      (project) => {
        project.status = "recorded";
        project.error = undefined;
        project.artifacts.rawVideo = relativeArtifact(
          project.id,
          session.rawVideoPath,
          session.root,
        );
      },
      session.root,
    );
  } catch (error) {
    sessions.delete(sessionId);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await updateProject(
      session.projectId,
      (project) => {
        project.status = "failed";
        project.error = errorMessage(error);
      },
      session.root,
    ).catch(() => undefined);
    throw error;
  }
}

export async function abortBrowserSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
  await updateProject(
    session.projectId,
    (project) => {
      project.status = "failed";
      project.error = "Recording was aborted.";
    },
    session.root,
  ).catch(() => undefined);
}

export function listActiveBrowserSessions(): Array<{
  sessionId: string;
  projectId: string;
  currentUrl: string;
}> {
  return [...sessions.values()].map((session) => ({
    sessionId: session.id,
    projectId: session.projectId,
    currentUrl: session.page.url(),
  }));
}
