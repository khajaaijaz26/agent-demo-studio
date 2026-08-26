#!/usr/bin/env node

/**
 * EdulabsAI launch campaign builder.
 *
 * This intentionally exercises Agent Demo Studio's native synchronized
 * narration, creator render, caption, thumbnail, validation, and social
 * packaging workflows. The only generated intermediary outside those flows is
 * a gentle motion plate made from EdulabsAI-owned launch artwork.
 */

import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const ASSETS = path.join(HERE, "assets");
const GENERATED = path.join(ASSETS, "generated");
const MANIFESTS = path.join(HERE, "manifests");
const WORK = path.join(HERE, ".work");
const DELIVERABLES = path.join(HERE, "deliverables");
const CLI = path.join(ROOT, "dist", "cli.js");

const COLORS = {
  canvas: "#FFF8EF",
  canvasDeep: "#FFE4CE",
  ink: "#2D1B47",
  inkSoft: "#5A4778",
  coral: "#B83218",
  coralDeep: "#922610",
  coralSoft: "#FFD9CC",
  mango: "#FFB627",
  peri: "#6B5BFF",
  mint: "#007B73",
  white: "#FFFFFF",
};

const argv = new Set(process.argv.slice(2));
const force = argv.has("--force");
const prepareOnly = argv.has("--prepare-only");
const selectedArgument = process.argv.find((value) => value.startsWith("--campaign="));
const selectedCampaign = selectedArgument?.split("=")[1];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relativeFromManifest(target) {
  return toPosix(path.relative(MANIFESTS, target));
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrap(value, maximumCharacters) {
  const words = String(value).trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maximumCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function svgLines(lines, x, y, size, lineHeight, color, weight = 800, anchor = "start") {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(line)}</text>`,
    )
    .join("");
}

async function run(command, args, options = {}) {
  const label = options.label ?? `${path.basename(command)} ${args.join(" ")}`;
  process.stdout.write(`\n→ ${label}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...options.env },
      stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    if (options.quiet) {
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${label} failed with exit code ${code}.\n${stderr || stdout}`));
    });
  });
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function resolveEdulabsSource() {
  const candidates = [
    process.env.EDULABSAI_SOURCE,
    path.resolve(ROOT, "..", "..", "EduLabsAI99"),
    path.resolve(ROOT, "..", "EduLabsAI99"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (
      (await exists(path.join(candidate, "public", "brand", "edulabsai-profile-coral.png"))) &&
      (await exists(path.join(candidate, "docs", "launch-kit", "presentations")))
    ) {
      return path.resolve(candidate);
    }
  }
  throw new Error(
    "Could not locate the EdulabsAI repository. Set EDULABSAI_SOURCE to the repository path and rerun.",
  );
}

async function copyOwnedAssets(edulabs) {
  const brandDirectory = path.join(ASSETS, "brand");
  const founderDirectory = path.join(ASSETS, "founder");
  const subjectDirectory = path.join(ASSETS, "subject");
  const artworkDirectory = path.join(ASSETS, "artwork");
  await Promise.all(
    [brandDirectory, founderDirectory, subjectDirectory, artworkDirectory, GENERATED].map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );

  const brandFiles = [
    "edulabsai-profile-coral.png",
    "edulabsai-profile-light.png",
    "edulabsai-wordmark.png",
    "edulabsai-mark.svg",
  ];
  for (const name of brandFiles) {
    await copyFile(path.join(edulabs, "public", "brand", name), path.join(brandDirectory, name));
  }

  const presentationRoot = path.join(edulabs, "docs", "launch-kit", "presentations");
  const founderSource = path.join(presentationRoot, "EdulabsAI-Founder-Overview-Animated-preview");
  const subjectSource = path.join(presentationRoot, "EdulabsAI-Editable-Subject-Visuals-Animated-preview");
  for (let index = 1; index <= 13; index += 1) {
    await copyFile(
      path.join(founderSource, `Slide${index}.PNG`),
      path.join(founderDirectory, `slide-${String(index).padStart(2, "0")}.png`),
    );
  }
  for (let index = 1; index <= 10; index += 1) {
    await copyFile(
      path.join(subjectSource, `Slide${index}.PNG`),
      path.join(subjectDirectory, `slide-${String(index).padStart(2, "0")}.png`),
    );
  }

  const artworkFiles = [
    "edulabsai-classroom-hero-v2.png",
    "edulabsai-connected-classroom-hero.png",
    "edulabsai-evidence-to-action-live.png",
    "edulabsai-homepage-live.png",
    "edulabsai-learning-loop-live.png",
    "edulabsai-resource-bridge-live.png",
    "edulabsai-safe-class-connection-live.png",
    "edulabsai-subject-visuals-live.png",
  ];
  for (const name of artworkFiles) {
    await copyFile(
      path.join(edulabs, "docs", "launch-kit", "artwork", name),
      path.join(artworkDirectory, name),
    );
  }
}

function dataUri(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function makeLandscapeBrandScene({ id, eyebrow, title, body, callToAction, dark = false }) {
  const output = path.join(GENERATED, `landscape-${id}.png`);
  if (!force && (await exists(output))) return output;
  const logo = dataUri(await readFile(path.join(ASSETS, "brand", "edulabsai-profile-coral.png")));
  const titleLines = wrap(title, 22).slice(0, 3);
  const bodyLines = wrap(body, 57).slice(0, 3);
  const background = dark ? COLORS.ink : COLORS.canvas;
  const foreground = dark ? COLORS.white : COLORS.ink;
  const supporting = dark ? "#DCD8FF" : COLORS.inkSoft;
  const panel = dark ? "#3C2859" : COLORS.white;
  const svg = `
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${background}"/>
          <stop offset="1" stop-color="${dark ? "#24143B" : COLORS.canvasDeep}"/>
        </linearGradient>
        <filter id="shadow"><feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#2D1B47" flood-opacity="0.18"/></filter>
      </defs>
      <rect width="1920" height="1080" fill="url(#wash)"/>
      <circle cx="1660" cy="-40" r="460" fill="${COLORS.coral}" opacity="0.12"/>
      <circle cx="1580" cy="870" r="390" fill="${COLORS.peri}" opacity="0.11"/>
      <path d="M1390 260 C1530 120 1770 200 1810 390 C1850 610 1660 730 1480 640 C1320 560 1270 380 1390 260Z" fill="${panel}" opacity="0.92"/>
      <g filter="url(#shadow)"><rect x="1490" y="270" width="270" height="270" rx="64" fill="#FFFFFF"/><image href="${logo}" x="1518" y="298" width="214" height="214"/></g>
      <circle cx="1390" cy="690" r="38" fill="${COLORS.mango}"/>
      <circle cx="1510" cy="760" r="28" fill="${COLORS.mint}"/>
      <circle cx="1680" cy="718" r="32" fill="${COLORS.coral}"/>
      <rect x="150" y="116" width="190" height="8" rx="4" fill="${COLORS.coral}"/>
      <text x="150" y="178" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" letter-spacing="4" fill="${dark ? COLORS.mango : COLORS.coral}">${xml(eyebrow.toUpperCase())}</text>
      ${svgLines(titleLines, 150, 342, 84, 96, foreground, 850)}
      ${svgLines(bodyLines, 156, 705, 32, 46, supporting, 500)}
      <rect x="150" y="884" width="${Math.max(350, callToAction.length * 21)}" height="82" rx="22" fill="${COLORS.coral}"/>
      <text x="188" y="938" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" fill="#FFFFFF">${xml(callToAction)}</text>
      <text x="1460" y="1000" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="800" fill="${supporting}">edulabsai.com</text>
    </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(output);
  return output;
}

async function makeVerticalScene({ id, eyebrow, title, body, source, tone = "coral", outro = false }) {
  const output = path.join(GENERATED, `vertical-${id}.png`);
  if (!force && (await exists(output))) return output;
  const logo = dataUri(await readFile(path.join(ASSETS, "brand", "edulabsai-profile-coral.png")));
  const titleLines = wrap(title, 19).slice(0, 4);
  const bodyLines = wrap(body, 35).slice(0, 4);
  const accent = tone === "peri" ? COLORS.peri : tone === "mint" ? COLORS.mint : tone === "mango" ? COLORS.mango : COLORS.coral;
  let sourceMarkup = "";
  if (source) {
    const image = dataUri(await readFile(source));
    sourceMarkup = `<g filter="url(#shadow)"><rect x="70" y="820" width="940" height="529" rx="38" fill="#FFFFFF"/><image href="${image}" x="70" y="820" width="940" height="529" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip)"/></g>`;
  }
  const svg = `
    <svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${outro ? COLORS.ink : COLORS.canvas}"/><stop offset="1" stop-color="${outro ? "#24143B" : COLORS.canvasDeep}"/></linearGradient>
        <clipPath id="clip"><rect x="70" y="820" width="940" height="529" rx="38"/></clipPath>
        <filter id="shadow"><feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#2D1B47" flood-opacity="0.20"/></filter>
      </defs>
      <rect width="1080" height="1920" fill="url(#bg)"/>
      <circle cx="1000" cy="180" r="340" fill="${accent}" opacity="${outro ? "0.22" : "0.12"}"/>
      <circle cx="60" cy="1660" r="300" fill="${COLORS.peri}" opacity="0.10"/>
      <image href="${logo}" x="70" y="108" width="116" height="116"/>
      <text x="214" y="156" font-family="Arial, Helvetica, sans-serif" font-size="37" font-weight="850" fill="${outro ? COLORS.white : COLORS.ink}">Edulabs<tspan fill="${outro ? COLORS.mango : COLORS.coral}">AI</tspan></text>
      <text x="214" y="198" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="800" letter-spacing="2.8" fill="${outro ? "#DCD8FF" : COLORS.inkSoft}">CONNECTED TEACHING WORKSPACE</text>
      <rect x="70" y="294" width="145" height="8" rx="4" fill="${accent}"/>
      <text x="70" y="350" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="800" letter-spacing="3.5" fill="${outro ? COLORS.mango : COLORS.coral}">${xml(eyebrow.toUpperCase())}</text>
      ${svgLines(titleLines, 70, 460, 72, 80, outro ? COLORS.white : COLORS.ink, 850)}
      ${sourceMarkup}
      ${svgLines(bodyLines, 75, source ? 1455 : 980, 30, 43, outro ? "#DCD8FF" : COLORS.inkSoft, 500)}
      <rect x="70" y="1700" width="940" height="92" rx="28" fill="${accent}"/>
      <text x="540" y="1759" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="850" fill="${tone === "mango" ? COLORS.ink : COLORS.white}">${xml(outro ? "Start free at edulabsai.com" : "Teacher-controlled • Ready for the classroom")}</text>
      <text x="540" y="1855" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" letter-spacing="3" fill="${outro ? "#DCD8FF" : COLORS.inkSoft}">PLAN • TEACH • RESPOND • SHARE</text>
    </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(output);
  return output;
}

const founder = (number) => path.join(ASSETS, "founder", `slide-${String(number).padStart(2, "0")}.png`);
const subject = (number) => path.join(ASSETS, "subject", `slide-${String(number).padStart(2, "0")}.png`);

const sceneDefinitions = [
  { id: "v-ready-intro", eyebrow: "One brief", title: "A connected lesson pack in about two minutes", body: "Plan, slides, quiz and worksheet begin from the same objective.", tone: "coral" },
  { id: "v-context", eyebrow: "Step 1", title: "Choose the context that actually matters", body: "Curriculum, grade, subject, topic, language and optional source material.", source: founder(5), tone: "coral" },
  { id: "v-four-resources", eyebrow: "Step 2", title: "Generate four resources together", body: "One coherent lesson record instead of four disconnected prompts.", source: founder(6), tone: "peri" },
  { id: "v-edit-teach", eyebrow: "Step 3", title: "Edit, export and teach it live", body: "Teacher control stays in front of every classroom action.", source: founder(7), tone: "mint" },
  { id: "v-visual-intro", eyebrow: "Built for your subject", title: "Slides that teach the idea, not decorate it", body: "Editable diagrams, charts, tables and equations built for the back row.", source: subject(1), tone: "peri" },
  { id: "v-fractions", eyebrow: "Mathematics", title: "Fractions that shade themselves", body: "Students can count each sector as the visual develops.", source: subject(2), tone: "coral" },
  { id: "v-water", eyebrow: "Science", title: "A water cycle that actually loops", body: "Evaporation, cloud and rainfall become one readable system.", source: subject(3), tone: "mint" },
  { id: "v-angle", eyebrow: "Geometry", title: "An angle that opens as the arc is drawn", body: "The comparison stays visible from the back of the room.", source: subject(4), tone: "mango" },
  { id: "v-more-subjects", eyebrow: "Across K–12", title: "Equations, molecules, charts and timelines", body: "The visual language changes with the subject.", source: subject(8), tone: "peri" },
  { id: "v-paper-intro", eyebrow: "Snap & Mark", title: "Bring paper answers back into the learning loop", body: "Upload one private capture page. Review every transcription before it counts.", source: founder(9), tone: "coral" },
  { id: "v-teacher-review", eyebrow: "Teacher review", title: "No silent paper grading", body: "Names and answer keys stay out of recognition. The teacher corrects and approves.", source: founder(9), tone: "mint" },
  { id: "v-pattern", eyebrow: "Verified evidence", title: "Turn a repeated mistake into a clear pattern", body: "Review the misconception before it becomes a next step.", source: founder(10), tone: "peri" },
  { id: "v-tomorrow", eyebrow: "Tomorrow Pack", title: "Move from pattern to a ready reteach", body: "Editable groups, mini explanations and focused practice remain connected.", source: founder(10), tone: "mango" },
  { id: "v-chat", eyebrow: "Class connection", title: "One class channel plus named learning groups", body: "Teachers control names, pictures, membership and moderation.", source: founder(8), tone: "peri" },
  { id: "v-admin", eyebrow: "Teacher stays admin", title: "Delegate support without giving away control", body: "A student co-admin can help, while the teacher remains final admin.", source: founder(8), tone: "coral" },
  { id: "v-focus", eyebrow: "Assessment focus", title: "Pause chat while focused work is active", body: "Access returns after submission or when the session closes.", source: founder(8), tone: "mint" },
  { id: "v-family", eyebrow: "Family Digest", title: "Share useful progress after teacher approval", body: "Consent-first communication uses a clear learning summary, not raw classroom data.", source: founder(11), tone: "mango" },
  { id: "v-one-record", eyebrow: "One lesson record", title: "The objective travels. The context stays attached.", body: "Resources, live teaching, evidence, reteach and family communication remain connected.", source: founder(3), tone: "coral" },
  { id: "v-live", eyebrow: "Teach", title: "Run the room with clear boundaries", body: "Live quiz, focused work and safe class connection are in one teacher-controlled space.", source: founder(8), tone: "mint" },
  { id: "v-evidence", eyebrow: "Respond", title: "Review evidence before the next action", body: "Digital or paper, the teacher approves what changes the learning record.", source: founder(9), tone: "peri" },
  { id: "v-reteach", eyebrow: "Reteach", title: "Build tomorrow from a verified misconception", body: "Move from pattern to group plan to independent evidence.", source: founder(10), tone: "mango" },
  { id: "v-digest", eyebrow: "Share", title: "Close the loop with families", body: "A consent-first digest keeps the message useful and teacher approved.", source: founder(11), tone: "coral" },
];

const campaigns = [
  {
    id: "video-01-connected-classroom-tour",
    format: "landscape",
    title: "EdulabsAI — The Connected Classroom Tour",
    description: "See how one curriculum-aware lesson record connects planning, live teaching, evidence, reteaching and family communication.",
    hook: "From curriculum to the next better lesson — without breaking the learning loop.",
    audience: "K–12 teachers and instructional leaders",
    scenes: [
      ["brand-intro", "Meet EdulabsAI: one connected teaching workspace from the first idea to the next better lesson."],
      ["founder-01", "Start with a curriculum, grade, subject and topic. Add your own source when exact local grounding matters."],
      ["founder-06", "Generate a coherent lesson plan, visual slides, quiz and worksheet together, from the same objective."],
      ["founder-07", "Edit with AI, make teacher changes, preview clearly, then export the resources you choose."],
      ["founder-08", "Teach live with whole-class and group chat, teacher moderation, and an assessment focus lock when students need it."],
      ["founder-09", "Bring paper answers back through Snap and Mark, with de-identified recognition and an explicit teacher review."],
      ["founder-10", "When a pattern repeats, turn the verified misconception into editable groups and a ready Tomorrow Pack."],
      ["founder-11", "Then share a consent-first Family Digest only after the teacher approves the useful learning summary."],
      ["brand-outro", "Plan once. Teach live. Respond with evidence. Start free at edulabsai dot com."],
    ],
  },
  {
    id: "video-02-curriculum-to-classroom",
    format: "landscape",
    title: "EdulabsAI — Curriculum to Classroom",
    description: "A focused walkthrough of curriculum-aware generation, editable subject visuals and classroom-ready exports.",
    hook: "One brief becomes four connected, editable resources.",
    audience: "Teachers evaluating AI lesson planning",
    scenes: [
      ["brand-intro", "What if one careful brief could create the full first draft of tomorrow's lesson?"],
      ["founder-05", "Choose from broad K–12 curriculum and subject coverage, or use a safe custom subject when your exact topic is not listed."],
      ["founder-06", "EdulabsAI builds the plan, slides, quiz and worksheet together, so the objective and vocabulary stay aligned."],
      ["subject-02", "For mathematics, editable diagrams can make fractions and ratios visible as the explanation develops."],
      ["subject-03", "For science, processes like the water cycle become readable teaching systems instead of generic clip art."],
      ["founder-07", "Preview in a compact player, navigate with the keyboard or wheel, edit with AI, and export when it is truly yours."],
      ["founder-08", "Then launch the live classroom from the same lesson record, without rebuilding the context."],
      ["brand-outro", "Move from curriculum to classroom in one connected workflow. Start free at edulabsai dot com."],
    ],
  },
  {
    id: "video-03-evidence-to-action",
    format: "landscape",
    title: "EdulabsAI — From Evidence to Tomorrow's Reteach",
    description: "Connect Snap and Mark teacher review, misconception verification, Tomorrow Packs and Family Digests.",
    hook: "Paper or digital, evidence should lead to a useful next move.",
    audience: "Teachers and assessment leads",
    scenes: [
      ["brand-intro", "The real value of assessment is not the score. It is what the teacher can do next."],
      ["founder-09", "Snap and Mark brings one private paper capture page into review, without sending roster identity or an answer key to recognition."],
      ["founder-09", "The transcription remains a proposal until the teacher corrects uncertainty and explicitly approves the record."],
      ["founder-10", "EdulabsAI helps surface repeated patterns, but the teacher verifies the misconception before any reteach is created."],
      ["founder-10", "Build editable learning groups, a mini explanation and focused practice inside a ready Tomorrow Pack."],
      ["founder-11", "Use new independent evidence to resolve the pattern, then draft a consent-first Family Digest for teacher approval."],
      ["founder-12", "Human review remains at every consequential point: paper transcription, group action and family communication."],
      ["brand-outro", "Turn evidence into tomorrow's move. Explore EdulabsAI at edulabsai dot com."],
    ],
  },
  {
    id: "video-04-school-pilot",
    format: "landscape",
    title: "EdulabsAI — A Connected AI Teaching Pilot",
    description: "A concise school-leader overview of the connected workflow, teacher controls and pilot value.",
    hook: "Pilot one connected teaching system, not another isolated AI tool.",
    audience: "School leaders, curriculum directors and pilot sponsors",
    scenes: [
      ["brand-intro", "A useful school AI pilot should reduce repeated work without reducing teacher control."],
      ["founder-02", "EdulabsAI connects curriculum-aware planning, editable resources, live delivery, evidence and the next teaching decision."],
      ["founder-05", "Teachers can work across broad K–12 curricula and subjects, with optional source grounding for exact local material."],
      ["founder-08", "Class and group communication is teacher administered, moderated and paused during focused assessments when required."],
      ["founder-09", "Paper recognition is de-identified and review-first, so automation never silently becomes a grade."],
      ["founder-11", "Family communication is consent first, source backed and teacher approved before delivery."],
      ["founder-12", "The result is one inspectable lesson record with clear human checkpoints, instead of scattered tools and copied context."],
      ["brand-outro", "Book an EdulabsAI school pilot at edulabsai dot com."],
    ],
  },
  {
    id: "reel-01-two-minutes-to-ready",
    format: "vertical",
    title: "EdulabsAI Reel — One Brief to a Lesson Pack",
    description: "A fast vertical ad showing the curriculum-to-ready workflow.",
    hook: "One brief. Four connected resources. About two minutes to a first draft.",
    audience: "Time-poor K–12 teachers",
    scenes: [
      ["v-ready-intro", "One brief. Four connected resources. About two minutes to a classroom-ready first draft."],
      ["v-context", "Choose the curriculum, grade, subject, topic, language and any source your lesson needs."],
      ["v-four-resources", "Generate the plan, visual slides, quiz and worksheet together from the same objective."],
      ["v-edit-teach", "Edit, preview, export and teach live, while you stay in control."],
      ["vertical-outro", "Create your first connected lesson free at edulabsai dot com."],
    ],
  },
  {
    id: "reel-02-subject-visuals",
    format: "vertical",
    title: "EdulabsAI Reel — Visuals Built for the Subject",
    description: "Showcase editable, topic-aware teaching diagrams across K–12 subjects.",
    hook: "Teaching visuals that explain the idea instead of decorating the slide.",
    audience: "Teachers who want better presentation visuals",
    scenes: [
      ["v-visual-intro", "Your presentation should explain the idea, not decorate it."],
      ["v-fractions", "Fractions shade one sector at a time, so the class can count along."],
      ["v-water", "The water cycle loops through evaporation, cloud and rainfall as one system."],
      ["v-angle", "An angle opens while the arc is drawn, keeping the comparison visible."],
      ["v-more-subjects", "Equations, molecules, charts and timelines use the visual language their subject needs."],
      ["vertical-outro", "Build editable visual lessons at edulabsai dot com."],
    ],
  },
  {
    id: "reel-03-paper-to-next-step",
    format: "vertical",
    title: "EdulabsAI Reel — Paper to the Next Teaching Move",
    description: "Explain the controlled Snap and Mark to Tomorrow Pack workflow.",
    hook: "Paper answers can become tomorrow's reteach without silent AI grading.",
    audience: "Assessment-focused teachers",
    scenes: [
      ["v-paper-intro", "Paper answers should not disappear from the learning loop."],
      ["v-teacher-review", "Recognition stays de-identified, and every transcription waits for teacher review."],
      ["v-pattern", "Verify a repeated misconception before it changes the learning record."],
      ["v-tomorrow", "Turn that pattern into editable groups and a focused Tomorrow Pack."],
      ["vertical-outro", "Bring evidence back into teaching at edulabsai dot com."],
    ],
  },
  {
    id: "reel-04-safe-class-connection",
    format: "vertical",
    title: "EdulabsAI Reel — Safe Class and Family Connection",
    description: "Whole-class chat, named groups, focus locking and consent-first Family Digests.",
    hook: "Class communication designed around the teacher's boundaries.",
    audience: "Teachers and pastoral leaders",
    scenes: [
      ["v-chat", "Create one whole-class channel plus named learning groups, each with its own picture and members."],
      ["v-admin", "Assign a student co-admin when useful, while the teacher remains final admin."],
      ["v-focus", "Pause chat during assessments and focused work, then restore access when the session ends."],
      ["v-family", "Share progress through a consent-first Family Digest only after teacher approval."],
      ["vertical-outro", "Keep the classroom connected and teacher controlled with EdulabsAI."],
    ],
  },
  {
    id: "reel-05-one-connected-loop",
    format: "vertical",
    title: "EdulabsAI Reel — One Connected Learning Loop",
    description: "The complete Plan, Teach, Respond, Reteach and Share loop in under a minute.",
    hook: "The objective travels. The context stays attached.",
    audience: "Teachers, school leaders and EdTech buyers",
    scenes: [
      ["v-one-record", "In EdulabsAI, the objective travels and the context stays attached."],
      ["v-four-resources", "Plan once and generate four coherent, editable resources."],
      ["v-live", "Teach live with clear classroom boundaries."],
      ["v-evidence", "Review digital and paper evidence before it changes the record."],
      ["v-reteach", "Turn a verified pattern into tomorrow's focused reteach."],
      ["v-digest", "Share useful progress with families after consent and teacher approval."],
      ["vertical-outro", "One lesson. One connected loop. Start at edulabsai dot com."],
    ],
  },
];

async function prepareAuthoredScenes() {
  await makeLandscapeBrandScene({
    id: "intro",
    eyebrow: "Connected AI teaching workspace",
    title: "Plan the lesson. Teach it live. Keep every next step connected.",
    body: "Curriculum-aware resources, safe classroom delivery and evidence-led next steps — in one teacher-controlled workflow.",
    callToAction: "Meet EdulabsAI",
  });
  await makeLandscapeBrandScene({
    id: "outro",
    eyebrow: "Start free",
    title: "One lesson. Everything connected.",
    body: "Plan • Teach • Respond • Reteach • Share",
    callToAction: "Visit edulabsai.com",
    dark: true,
  });
  await makeVerticalScene({
    id: "outro",
    eyebrow: "Start free",
    title: "One lesson. Everything connected.",
    body: "Plan, teach, respond, reteach and share from one teacher-controlled record.",
    tone: "coral",
    outro: true,
  });
  for (const definition of sceneDefinitions) await makeVerticalScene(definition);
}

function sceneImage(id) {
  if (id === "brand-intro") return path.join(GENERATED, "landscape-intro.png");
  if (id === "brand-outro") return path.join(GENERATED, "landscape-outro.png");
  if (id === "vertical-outro") return path.join(GENERATED, "vertical-outro.png");
  if (id.startsWith("founder-")) return founder(Number(id.slice("founder-".length)));
  if (id.startsWith("subject-")) return subject(Number(id.slice("subject-".length)));
  if (id.startsWith("v-")) return path.join(GENERATED, `vertical-${id}.png`);
  throw new Error(`Unknown scene id: ${id}`);
}

async function motionPlate(id, image, format) {
  const directory = path.join(WORK, "motion", format);
  const output = path.join(directory, `${id}.mp4`);
  if (!force && (await exists(output))) return output;
  await mkdir(directory, { recursive: true });
  const width = format === "vertical" ? 1080 : 1920;
  const height = format === "vertical" ? 1920 : 1080;
  const zoomRate = format === "vertical" ? "0.00042" : "0.00032";
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width}:${height}`,
    `zoompan=z='min(zoom+${zoomRate},1.055)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=420:s=${width}x${height}:fps=30`,
    "fade=t=in:st=0:d=0.35",
    "format=yuv420p",
  ].join(",");
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-y",
      "-loop",
      "1",
      "-i",
      image,
      "-vf",
      filter,
      "-t",
      "14",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      output,
    ],
    { label: `Motion plate ${id} (${format})` },
  );
  return output;
}

async function prepareMotionLibrary(activeCampaigns) {
  const unique = new Map();
  for (const campaign of activeCampaigns) {
    for (const [sceneId] of campaign.scenes) unique.set(`${campaign.format}:${sceneId}`, { sceneId, format: campaign.format });
  }
  const result = new Map();
  for (const [key, item] of unique) {
    result.set(key, await motionPlate(item.sceneId, sceneImage(item.sceneId), item.format));
  }
  return result;
}

function slugTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function buildCampaign(campaign, motion) {
  const syncDirectory = path.join(WORK, "sync", campaign.id);
  const renderDirectory = path.join(WORK, "render", campaign.id);
  const packageDirectory = path.join(DELIVERABLES, campaign.id);
  if (force) {
    await rm(syncDirectory, { recursive: true, force: true });
    await rm(renderDirectory, { recursive: true, force: true });
    await rm(packageDirectory, { recursive: true, force: true });
  }

  const syncManifestPath = path.join(MANIFESTS, `${campaign.id}.sync.json`);
  const syncManifest = {
    title: campaign.title,
    outputDirectory: relativeFromManifest(syncDirectory),
    width: campaign.format === "vertical" ? 1080 : 1920,
    height: campaign.format === "vertical" ? 1920 : 1080,
    fps: 30,
    quality: 21,
    speechLeadSeconds: campaign.format === "vertical" ? 0.36 : 0.46,
    speechTailSeconds: campaign.format === "vertical" ? 0.48 : 0.62,
    maximumSlowdown: 1.08,
    musicVolume: campaign.format === "vertical" ? 0.038 : 0.045,
    generatedMusic: true,
    voices: [
      {
        id: "sonia",
        name: "Sonia — warm British English",
        voice: "en-GB-SoniaNeural",
        rate: campaign.format === "vertical" ? 7 : 4,
        volume: 0,
        pitch: 0,
      },
    ],
    scenes: campaign.scenes.map(([sceneId, narration], index) => ({
      id: `${String(index + 1).padStart(2, "0")}-${sceneId}`,
      videoPath: relativeFromManifest(motion.get(`${campaign.format}:${sceneId}`)),
      narration,
      minimumDurationSeconds: campaign.format === "vertical" ? 3.2 : 3.8,
    })),
  };
  await writeJson(syncManifestPath, syncManifest);

  const syncResultPath = path.join(syncDirectory, "render-result.json");
  if (force || !(await exists(syncResultPath))) {
    await run(process.execPath, [CLI, "sync", syncManifestPath], { label: `Agent Demo sync: ${campaign.id}` });
  }
  const syncResult = JSON.parse(await readFile(syncResultPath, "utf8"));
  invariant(syncResult.outputs?.length === 1, `${campaign.id}: expected one synchronized output.`);
  const synchronized = syncResult.outputs[0];

  const creatorManifestPath = path.join(MANIFESTS, `${campaign.id}.creator.json`);
  const creatorManifest = {
    schemaVersion: 1,
    title: campaign.title,
    description: `${campaign.description}\n\n${campaign.hook}\n\nExplore: https://www.edulabsai.com`,
    outputDirectory: relativeFromManifest(renderDirectory),
    brand: {
      name: "EdulabsAI",
      primary: COLORS.coral,
      secondary: COLORS.peri,
      text: COLORS.white,
      fontFamily: "Arial, Helvetica, sans-serif",
    },
    clips: [
      {
        id: "synchronized-master",
        source: relativeFromManifest(synchronized.videoPath),
        kind: "video",
        volume: 1,
        reframe: "fill",
        effects: { contrast: 1.02, saturation: 1.02 },
        licenseId: "edulabsai-owned",
      },
    ],
    captions: {
      source: relativeFromManifest(synchronized.subtitlesPath),
      format: "srt",
      burn: true,
      sidecar: true,
      language: "en",
      style: {
        position: "bottom",
        fontSize: campaign.format === "vertical" ? 46 : 40,
        color: COLORS.white,
        background: "#2D1B47EE",
        accent: COLORS.coral,
        maxCharactersPerLine: campaign.format === "vertical" ? 31 : 56,
        maxLines: campaign.format === "vertical" ? 3 : 2,
        margin: campaign.format === "vertical" ? 300 : 72,
      },
    },
    audio: {
      keepClipAudio: true,
      clipVolume: 1,
      targetLufs: -16,
      truePeak: -1.5,
    },
    exports: [
      {
        id: "master",
        preset: campaign.format === "vertical" ? "reels" : "youtube-1080p",
        fileName: campaign.id,
        title: campaign.title,
        description: `${campaign.description}\n\nStart free: https://www.edulabsai.com`,
        tags: ["EdulabsAI", "AI for teachers", "K-12 teaching", "lesson planning", "teacher tools"],
        quality: 23,
        videoCodec: "h264",
        thumbnailAtSeconds: campaign.format === "vertical" ? 1.25 : 2.4,
        burnCaptions: true,
      },
    ],
    licenses: [
      {
        id: "edulabsai-owned",
        source: "EdulabsAI product and launch artwork",
        title: "EdulabsAI owned campaign assets",
        creator: "EdulabsAI",
        license: "Original brand, product UI and campaign artwork owned by EdulabsAI",
        attribution: "EdulabsAI",
      },
    ],
    metadata: {
      campaign: "EdulabsAI launch campaign 2026",
      campaignId: campaign.id,
      format: campaign.format,
      audience: campaign.audience,
      hook: campaign.hook,
      generatedBy: "Agent Demo Studio",
      reviewStatus: "rendered-for-founder-review",
    },
  };
  await writeJson(creatorManifestPath, creatorManifest);

  const creatorResultPath = path.join(renderDirectory, "creator-render-result.json");
  if (force || !(await exists(creatorResultPath))) {
    await run(process.execPath, [CLI, "creator", "validate", creatorManifestPath], {
      label: `Validate creator manifest: ${campaign.id}`,
    });
    await run(process.execPath, [CLI, "creator", "render", creatorManifestPath], {
      label: `Agent Demo creator render: ${campaign.id}`,
    });
  }
  await run(
    process.execPath,
    [CLI, "creator", "package", creatorManifestPath, creatorResultPath, "--destination", packageDirectory],
    { label: `Package social release: ${campaign.id}` },
  );
  await makePortableReleaseManifest(packageDirectory);
  return { campaign, creatorManifestPath, creatorResultPath, packageDirectory };
}

async function makePortableReleaseManifest(packageDirectory) {
  const target = path.join(packageDirectory, "release-manifest.json");
  const release = JSON.parse(await readFile(target, "utf8"));
  const packageRelative = (value) => (value ? toPosix(path.relative(packageDirectory, value)) : undefined);
  const source = release.sourceRenderResult ?? {};
  const portable = {
    schemaVersion: release.schemaVersion ?? 1,
    title: release.title,
    createdAt: release.createdAt,
    sourceRenderResult: {
      title: source.title,
      manifest: source.manifestPath ? `../../manifests/${path.basename(source.manifestPath)}` : undefined,
      outputs: (source.outputs ?? []).map((output) => ({
        id: output.id,
        preset: output.preset,
        platform: output.platform,
        durationSeconds: output.durationSeconds,
        width: output.width,
        height: output.height,
        fps: output.fps,
        fileSizeBytes: output.fileSizeBytes,
        validation: output.validation,
      })),
      createdAt: source.createdAt,
    },
    outputs: (release.outputs ?? []).map((output) => ({
      id: output.id,
      directory: packageRelative(output.directory),
      video: packageRelative(output.video),
      thumbnail: packageRelative(output.thumbnail),
      captions: packageRelative(output.captions),
      chapters: packageRelative(output.chapters),
      publishingPlan: packageRelative(output.publishingPlan),
    })),
    portability: "All paths are relative to this release package. Reproducible intermediates are intentionally excluded.",
  };
  await writeJson(target, portable);
}

async function probeVideo(videoPath) {
  const result = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
      "-of",
      "json",
      videoPath,
    ],
    { label: `Probe ${path.basename(videoPath)}`, quiet: true },
  );
  return JSON.parse(result.stdout);
}

function friendlyBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function createContactSheet(results) {
  const width = 1800;
  const height = 1200;
  const cellWidth = 570;
  const cellHeight = 350;
  const composites = [];
  for (const [index, result] of results.entries()) {
    const renderResult = JSON.parse(await readFile(result.creatorResultPath, "utf8"));
    const thumbnail = renderResult.outputs[0].thumbnailPath;
    const image = await sharp(thumbnail)
      .resize({ width: 520, height: 270, fit: "contain", background: COLORS.ink })
      .jpeg({ quality: 88 })
      .toBuffer();
    const x = 45 + (index % 3) * cellWidth;
    const y = 55 + Math.floor(index / 3) * 380;
    composites.push({ input: image, left: x, top: y });
    const label = Buffer.from(`<svg width="520" height="58" xmlns="http://www.w3.org/2000/svg"><rect width="520" height="58" fill="#FFFFFF"/><text x="14" y="25" font-family="Arial" font-size="17" font-weight="800" fill="${COLORS.ink}">${xml(result.campaign.id)}</text><text x="14" y="47" font-family="Arial" font-size="13" font-weight="600" fill="${COLORS.coral}">${xml(result.campaign.audience)}</text></svg>`);
    composites.push({ input: label, left: x, top: y + 274 });
  }
  await sharp({ create: { width, height, channels: 3, background: COLORS.canvas } })
    .composite(composites)
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(path.join(DELIVERABLES, "campaign-contact-sheet.jpg"));
}

async function writeQaReport(results) {
  const rows = [];
  for (const result of results) {
    const creatorResult = JSON.parse(await readFile(result.creatorResultPath, "utf8"));
    const output = creatorResult.outputs[0];
    const probe = await probeVideo(output.videoPath);
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    const expected = result.campaign.format === "vertical" ? [1080, 1920] : [1920, 1080];
    const checks = {
      dimensions: video?.width === expected[0] && video?.height === expected[1],
      videoCodec: video?.codec_name === "h264",
      audioPresent: Boolean(audio),
      captionsPresent: Boolean(output.captionsPath && (await exists(output.captionsPath))),
      thumbnailPresent: Boolean(output.thumbnailPath && (await exists(output.thumbnailPath))),
      platformValidation: !output.validation.some((issue) => issue.level === "error"),
    };
    rows.push({
      id: result.campaign.id,
      format: result.campaign.format,
      durationSeconds: Number(probe.format.duration),
      sizeBytes: Number(probe.format.size),
      video: { codec: video?.codec_name, width: video?.width, height: video?.height, fps: video?.r_frame_rate },
      audio: audio ? { codec: audio.codec_name, channels: audio.channels, sampleRate: audio.sample_rate } : null,
      checks,
      passed: Object.values(checks).every(Boolean),
    });
  }
  await writeJson(path.join(DELIVERABLES, "QA-REPORT.json"), { generatedAt: new Date().toISOString(), outputs: rows });
  const markdown = [
    "# EdulabsAI campaign QA report",
    "",
    "Every release is checked after the final Agent Demo Studio creator render and social packaging pass.",
    "",
    "| Asset | Format | Duration | Size | Video | Audio | Captions | Thumbnail | Result |",
    "| --- | --- | ---: | ---: | --- | --- | --- | --- | --- |",
    ...rows.map((row) =>
      `| ${row.id} | ${row.video.width}×${row.video.height} | ${row.durationSeconds.toFixed(1)}s | ${friendlyBytes(row.sizeBytes)} | ${row.video.codec} ${row.video.fps} fps | ${row.audio?.codec ?? "missing"} | ${row.checks.captionsPresent ? "yes" : "no"} | ${row.checks.thumbnailPresent ? "yes" : "no"} | ${row.passed ? "PASS" : "FAIL"} |`,
    ),
    "",
    `Overall: **${rows.every((row) => row.passed) ? "PASS" : "FAIL"}** (${rows.filter((row) => row.passed).length}/${rows.length} assets passed).`,
    "",
  ];
  await writeFile(path.join(DELIVERABLES, "QA-REPORT.md"), markdown.join("\n"), "utf8");
  invariant(rows.every((row) => row.passed), "One or more final campaign outputs failed QA.");
}

async function writeCampaignIndex(activeCampaigns) {
  const lines = [
    "# EdulabsAI launch campaign — upload-ready assets",
    "",
    "The campaign contains four 16:9 product advertisements and five 9:16 social reels. Every package includes an MP4, thumbnail, burned and sidecar captions, publishing metadata, chapters where applicable, and an asset-rights report.",
    "",
    "| Asset | Purpose | Audience | Hook |",
    "| --- | --- | --- | --- |",
    ...activeCampaigns.map((campaign) => `| ${campaign.id} | ${campaign.title} | ${campaign.audience} | ${campaign.hook} |`),
    "",
    "Open `campaign-contact-sheet.jpg` for a visual index and `QA-REPORT.md` for final technical checks.",
    "",
    "Publishing remains intentionally manual so the founder can review account-specific disclosures, captions and targeting before any external post goes live.",
    "",
  ];
  await writeFile(path.join(DELIVERABLES, "README.md"), lines.join("\n"), "utf8");
}

async function main() {
  invariant(await exists(CLI), "Agent Demo Studio is not built. Run `npm run build` first.");
  const edulabs = await resolveEdulabsSource();
  process.stdout.write(`Using EdulabsAI source: ${edulabs}\n`);
  await Promise.all([mkdir(ASSETS, { recursive: true }), mkdir(MANIFESTS, { recursive: true }), mkdir(WORK, { recursive: true }), mkdir(DELIVERABLES, { recursive: true })]);
  await copyOwnedAssets(edulabs);
  await prepareAuthoredScenes();
  const activeCampaigns = selectedCampaign ? campaigns.filter((campaign) => campaign.id === selectedCampaign) : campaigns;
  invariant(activeCampaigns.length > 0, `Unknown campaign '${selectedCampaign}'.`);
  const motion = await prepareMotionLibrary(activeCampaigns);
  await writeCampaignIndex(activeCampaigns);
  if (prepareOnly) {
    process.stdout.write(`\nPrepared ${activeCampaigns.length} campaign storyboard${activeCampaigns.length === 1 ? "" : "s"} and motion libraries.\n`);
    return;
  }
  const results = [];
  for (const campaign of activeCampaigns) results.push(await buildCampaign(campaign, motion));
  await writeQaReport(results);
  await createContactSheet(results);
  process.stdout.write(`\n✓ ${results.length} EdulabsAI campaign assets rendered, packaged and verified in ${DELIVERABLES}\n`);
}

await main();
