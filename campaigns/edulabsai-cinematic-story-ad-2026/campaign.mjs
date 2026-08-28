export const campaign = {
  id: "edulabsai-cinematic-story-ad-2026",
  name: "EdulabsAI - Built for Teachers",
  website: "https://www.edulabsai.com",
  voice: "en-US-AndrewMultilingualNeural",
  voiceName: "Andrew - warm, natural campaign narrator",
  voiceRate: "-7%",
  palette: {
    aubergine: "#2B1944",
    midnight: "#170C29",
    plum: "#4A245E",
    coral: "#F45B3E",
    orange: "#FF7A45",
    gold: "#FFB52E",
    cream: "#FFF8EF",
    paper: "#FFFDF9",
    white: "#FFFFFF",
    teal: "#0FA69A",
    lilac: "#8D73E6",
    ink: "#26183B",
    muted: "#746A7C"
  }
};

export const formats = {
  landscape: {
    id: "landscape",
    width: 3840,
    height: 2160,
    preset: "youtube-4k",
    exportId: "master",
    safeZone: { top: 128, right: 192, bottom: 192, left: 192 },
    captionFontSize: 66,
    captionMargin: 112,
    maxCaptionCharacters: 54
  },
  vertical: {
    id: "vertical",
    width: 1080,
    height: 1920,
    preset: "reels",
    exportId: "master",
    safeZone: { top: 180, right: 170, bottom: 330, left: 90 },
    captionFontSize: 48,
    captionMargin: 350,
    maxCaptionCharacters: 30
  }
};

export const production = {
  id: "edulabsai-built-for-teachers-cinematic-ad",
  title: "Built for teachers. Everything connected. - EdulabsAI",
  description: "A story-led EdulabsAI advertisement that turns a fragmented teacher workday into one connected learning loop.",
  fps: 30,
  scenes: [
    {
      id: "brand-arrival",
      eyebrow: "EDULABSAI",
      headline: ["Teaching deserves", "a better kind of day."],
      narration: "Teaching deserves a better kind of day.",
      minimumSeconds: 4.6,
      tone: "hero",
      visual: "brand"
    },
    {
      id: "teacher-fragmented",
      eyebrow: "THE TEACHER'S REALITY",
      headline: ["A teacher's day", "should not look like this."],
      subhead: "Too many tools. Too many handoffs.",
      narration: "But too often, a teacher's day becomes a maze of disconnected tools.",
      minimumSeconds: 7.2,
      tone: "problem",
      visual: "teacher-fragmented"
    },
    {
      id: "tool-by-tool",
      eyebrow: "TOOL BY TOOL",
      headline: ["Plan here.", "Slides there.", "Quizzes somewhere else."],
      subhead: "Then worksheets, downloads, and progress to chase.",
      narration: "Plan in one place. Build slides in another. Make quizzes, worksheets, and downloads one by one.",
      minimumSeconds: 8.2,
      tone: "problem-light",
      visual: "tool-cards"
    },
    {
      id: "fragmentation-cost",
      eyebrow: "THE COST OF DISCONNECTION",
      headline: ["Every handoff breaks", "the learning story."],
      subhead: "Teachers rebuild. Students wait. Evidence arrives late.",
      narration: "Every handoff steals time, students wait, and the learning story breaks apart.",
      minimumSeconds: 7.2,
      tone: "problem-dark",
      visual: "broken-loop"
    },
    {
      id: "connected-reveal",
      eyebrow: "INTRODUCING EDULABSAI",
      headline: ["Built for teachers.", "Everything connected."],
      subhead: "PLAN  -  BUILD  -  TEACH  -  CHECK  -  CONNECT",
      narration: "Introducing EdulabsAI, built for teachers so every step stays connected.",
      minimumSeconds: 7.4,
      tone: "solution",
      visual: "teacher-connected"
    },
    {
      id: "classroom-context",
      eyebrow: "START WITH YOUR CLASSROOM",
      headline: ["Your context.", "Your lesson."],
      subhead: "Curriculum  -  Class  -  Topic  -  Language  -  Sources",
      narration: "Choose the curriculum, class, topic, language, and the source material you trust.",
      minimumSeconds: 7.4,
      tone: "product-dark",
      visual: "lesson-brief",
      still: "lesson-brief"
    },
    {
      id: "four-resources",
      eyebrow: "READY IN ABOUT TWO MINUTES",
      headline: ["One brief.", "Four aligned resources."],
      subhead: "Lesson plan  -  Slides  -  Quiz  -  Worksheet",
      narration: "From one brief, create an editable lesson plan, visual slides, a quiz, and a worksheet in about two minutes.",
      minimumSeconds: 9.0,
      tone: "product-light",
      visual: "four-resources",
      still: "lesson-overview"
    },
    {
      id: "teach-and-export",
      eyebrow: "CLASSROOM-READY RESOURCES",
      headline: ["Teach it.", "Shape it.", "Export it."],
      subhead: "Editable PowerPoint, PDF, and classroom formats.",
      narration: "Teach with clear visuals, edit what you need, and export classroom-ready PowerPoint and PDF resources.",
      minimumSeconds: 8.2,
      tone: "product-dark",
      visual: "teach-export",
      still: "teaching-slides"
    },
    {
      id: "students-connected",
      eyebrow: "THE SAME LEARNING STORY",
      headline: ["Students stay", "connected to the lesson."],
      subhead: "Join. Practise. Keep moving.",
      narration: "Students join, practise, and see their work in one focused learning space.",
      minimumSeconds: 7.6,
      tone: "human-light",
      visual: "student",
      still: "student-dashboard"
    },
    {
      id: "evidence-next-step",
      eyebrow: "TEACHER-REVIEWED EVIDENCE",
      headline: ["See the gap.", "Shape the next move."],
      subhead: "Evidence stays explainable and teacher-controlled.",
      narration: "Teachers review evidence, spot the gap, and shape the next teaching move while staying in control.",
      minimumSeconds: 8.0,
      tone: "product-light",
      visual: "evidence",
      still: "learning-insights"
    },
    {
      id: "families-connected",
      eyebrow: "CONSENT-BASED CONTROLLED BETA",
      headline: ["Progress becomes", "a clear story."],
      subhead: "Teacher reviewed before anything is shared.",
      narration: "And teacher-approved progress can become a clear, consent-based update for families.",
      minimumSeconds: 7.2,
      tone: "product-dark",
      visual: "family",
      still: "family-digest"
    },
    {
      id: "connected-loop-cta",
      eyebrow: "EDULABSAI",
      headline: ["One connected", "learning loop."],
      subhead: "Less rebuilding. More time to teach.",
      narration: "Less rebuilding. More time to teach. Create your first lesson free during beta at edulabsai dot com.",
      minimumSeconds: 8.4,
      tone: "finale",
      visual: "classroom-cta"
    }
  ]
};
