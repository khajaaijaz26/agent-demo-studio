export const PROJECT_SCHEMA_VERSION = 1;

export type ProjectStatus =
  | "draft"
  | "recording"
  | "recorded"
  | "rendering"
  | "ready"
  | "failed";

export type BrowserActionType =
  | "navigate"
  | "click"
  | "fill"
  | "press"
  | "hover"
  | "scroll"
  | "wait"
  | "chapter";

export interface BrowserAction {
  type: BrowserActionType;
  selector?: string;
  role?: string;
  name?: string;
  text?: string;
  value?: string;
  key?: string;
  url?: string;
  label?: string;
  description?: string;
  milliseconds?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface RecordedEvent extends BrowserAction {
  id: string;
  startedAtMs: number;
  completedAtMs: number;
  pageUrl: string;
}

export interface DemoTheme {
  backgroundStart: string;
  backgroundEnd: string;
  frame: string;
  frameBorder: string;
  accent: string;
  highlight: string;
  text: string;
  mutedText: string;
  browserTitle: string;
  badge: string;
}

export interface DemoAudio {
  narration?: string;
  voicePath?: string;
  musicPath?: string;
  useGeneratedMusic: boolean;
  voiceVolume: number;
  musicVolume: number;
}

export interface DemoRenderSettings {
  width: number;
  height: number;
  fps: number;
  quality: number;
  introSeconds: number;
  outroSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds?: number;
  captions: boolean;
}

export interface DemoArtifacts {
  rawVideo?: string;
  screenshot?: string;
  voiceover?: string;
  music?: string;
  finalVideo?: string;
  thumbnail?: string;
}

export interface DemoProject {
  schemaVersion: number;
  id: string;
  title: string;
  subtitle: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  error?: string;
  theme: DemoTheme;
  audio: DemoAudio;
  render: DemoRenderSettings;
  events: RecordedEvent[];
  artifacts: DemoArtifacts;
}

export interface CreateProjectInput {
  id?: string;
  title: string;
  subtitle?: string;
  url: string;
  root?: string;
  theme?: Partial<DemoTheme>;
  audio?: Partial<DemoAudio>;
  render?: Partial<DemoRenderSettings>;
}

export type JobState = "queued" | "running" | "completed" | "failed";

export interface JobRecord<T = unknown> {
  id: string;
  type: string;
  state: JobState;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  result?: T;
  error?: string;
}

export interface RecordFlowInput extends CreateProjectInput {
  actions: BrowserAction[];
  headless?: boolean;
  slowMotionMs?: number;
  narration?: string;
  generateVoice?: boolean;
  autoRender?: boolean;
}

export interface RenderDemoInput {
  projectId: string;
  root?: string;
  title?: string;
  subtitle?: string;
  narration?: string;
  voicePath?: string;
  musicPath?: string;
  useGeneratedMusic?: boolean;
  theme?: Partial<DemoTheme>;
  render?: Partial<DemoRenderSettings>;
}

export const DEFAULT_THEME: DemoTheme = {
  backgroundStart: "#070A15",
  backgroundEnd: "#32124A",
  frame: "#11152A",
  frameBorder: "#FFFFFF22",
  accent: "#8B5CF6",
  highlight: "#22D3EE",
  text: "#F8FAFC",
  mutedText: "#AAB2C8",
  browserTitle: "Product demo",
  badge: "AGENT DEMO",
};

export const DEFAULT_AUDIO: DemoAudio = {
  useGeneratedMusic: true,
  voiceVolume: 1,
  musicVolume: 0.13,
};

export const DEFAULT_RENDER: DemoRenderSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  quality: 18,
  introSeconds: 1.2,
  outroSeconds: 0.8,
  trimStartSeconds: 0,
  captions: true,
};
