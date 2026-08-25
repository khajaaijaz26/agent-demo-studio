import { createProject, loadProject, saveProject } from "./project-store.js";
import { generateVoiceover } from "./audio/tts.js";
import {
  abortBrowserSession,
  finishBrowserSession,
  performBrowserAction,
  startBrowserSession,
} from "./browser/recorder.js";
import { renderDemo } from "./render/renderer.js";
import type { DemoProject, RecordFlowInput } from "./types.js";

type ProgressReporter = (progress: number, message: string) => void;

export async function recordDemoFlow(
  input: RecordFlowInput,
  report: ProgressReporter = () => undefined,
): Promise<DemoProject> {
  report(2, "Creating the project");
  const project = await createProject({
    id: input.id,
    title: input.title,
    subtitle: input.subtitle,
    url: input.url,
    root: input.root,
    theme: input.theme,
    audio: { ...input.audio, narration: input.narration ?? input.audio?.narration },
    render: input.render,
  });

  let sessionId: string | undefined;
  try {
    report(8, "Opening the live browser");
    const session = await startBrowserSession({
      projectId: project.id,
      root: input.root,
      headless: input.headless,
      slowMotionMs: input.slowMotionMs,
    });
    sessionId = session.sessionId;

    const actions = input.actions.length
      ? input.actions
      : [{ type: "wait" as const, milliseconds: 2_500, label: "Overview" }];
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index]!;
      const progress = 12 + Math.round(((index + 1) / actions.length) * 43);
      report(progress, action.label || `${action.type} ${index + 1} of ${actions.length}`);
      await performBrowserAction(sessionId, action);
    }

    report(60, "Finalizing the browser recording");
    await finishBrowserSession(sessionId);
    sessionId = undefined;

    const narration = input.narration ?? input.audio?.narration;
    if (input.generateVoice !== false && narration?.trim()) {
      report(67, "Generating the voice-over");
      await generateVoiceover(project.id, narration, { root: input.root });
    }

    if (input.autoRender !== false) {
      report(72, "Editing and rendering the demo");
      return await renderDemo(
        { projectId: project.id, root: input.root },
        (progress, message) => report(72 + Math.round(progress * 0.28), message),
      );
    }

    const result = await loadProject(project.id, input.root);
    await saveProject(result, input.root);
    report(100, "Recording ready");
    return result;
  } catch (error) {
    if (sessionId) await abortBrowserSession(sessionId);
    throw error;
  }
}
