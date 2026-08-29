import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { ffmpegCommand } from "../config.js";
import { AgentDemoError } from "../errors.js";
import { runCommand } from "../utils/process.js";
import { slugify } from "../utils/text.js";
import type { SceneMediaGenerationResult } from "./generated-media.js";
import { probeMediaInfo } from "./media.js";
import { requireMovingVideo, type MotionQualityReport } from "./motion-quality.js";
import type {
  CreatorProductionPlan,
  CreatorProductionPlanScene,
  CreatorPromptVideoInput,
  CreatorSceneAnimationSpec,
} from "./types.js";

type ProgressReporter = (progress: number, message: string) => void;

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

type SceneSubject = CreatorSceneAnimationSpec["subjects"][number];
type SceneAction = CreatorSceneAnimationSpec["actions"][number];
type SceneProp = CreatorSceneAnimationSpec["props"][number];
type SceneSetting = CreatorSceneAnimationSpec["setting"];
export type AnimatedSceneLayout = "landscape" | "portrait";

const VERTICAL_PRESETS = new Set(["shorts", "reels", "tiktok"]);

export function animatedSceneLayout(input: Pick<CreatorPromptVideoInput, "presets">): AnimatedSceneLayout {
  const presets = input.presets ?? [];
  return presets.length > 0 && presets.every((preset) => VERTICAL_PRESETS.has(preset)) ? "portrait" : "landscape";
}

const SUBJECT_PATTERNS: Array<{ kind: SceneSubject["kind"]; label: string; pattern: RegExp }> = [
  { kind: "teacher", label: "Teacher", pattern: /\b(teacher|educator|instructor)\b/i },
  { kind: "scientist", label: "Scientist", pattern: /\b(scientist|researcher)\b/i },
  { kind: "student", label: "Student", pattern: /\b(student|pupil|learner)s?\b/i },
  { kind: "child", label: "Child", pattern: /\b(child|kid|boy|girl)s?\b/i },
  { kind: "family", label: "Family", pattern: /\bfamil(?:y|ies)\b/i },
  { kind: "friend", label: "Friend", pattern: /\bfriends?\b/i },
  { kind: "rabbit", label: "Rabbit", pattern: /\b(rabbit|bunny|hare)\b/i },
  { kind: "bear", label: "Bear", pattern: /\bbears?\b/i },
  { kind: "cat", label: "Cat", pattern: /\b(cats?|kitten)\b/i },
  { kind: "dragon", label: "Dragon", pattern: /\bdragons?\b/i },
  { kind: "bird", label: "Bird", pattern: /\b(?:[a-z]+bird|birds?|owl|eagle)s?\b/i },
  { kind: "butterfly", label: "Butterfly", pattern: /\bbutterfl(?:y|ies)\b/i },
  { kind: "ball", label: "Ball", pattern: /\bballs?\b/i },
  { kind: "character", label: "Character", pattern: /\bcharacters?\b/i },
];

const ACTION_PATTERNS: Array<{ action: SceneAction; term: string; pattern: RegExp }> = [
  { action: "teach", term: "teach", pattern: /\b(teach|teaching|explain|explains|lesson)\b/i },
  { action: "experiment", term: "experiment", pattern: /\b(experiment|test|testing|science)\b/i },
  { action: "build", term: "build", pattern: /\b(build|building|assemble|model)\b/i },
  { action: "grow", term: "grow", pattern: /\b(grow|grows|growing|sprout|bloom|blooms|bloomed|blooming)\b/i },
  { action: "run", term: "run", pattern: /\b(run|runs|running|race)\b/i },
  { action: "chase", term: "chase", pattern: /\b(chase|chases|chasing)\b/i },
  { action: "jump", term: "jump", pattern: /\b(jump|jumps|jumped|jumping|hop|hops|hopped|hopping|bounce|bounces|bounced|bouncing)\b/i },
  { action: "fly", term: "fly", pattern: /\b(fly|flies|flying|soar)\b/i },
  { action: "float", term: "float", pattern: /\b(float|floats|floating|drift)\b/i },
  { action: "roll", term: "roll", pattern: /\b(roll|rolls|rolling)\b/i },
  { action: "climb", term: "climb", pattern: /\b(climb|climbs|climbing)\b/i },
  { action: "sleep", term: "sleep", pattern: /\b(sleep|sleeps|sleeping|rests?)\b/i },
  { action: "hug", term: "hug", pattern: /\b(hug|hugs|hugging|embrace)\b/i },
  { action: "celebrate", term: "celebrate", pattern: /\b(celebrate|celebrates|celebrated|celebrating|celebration|cheer|cheers|cheered|cheering|laugh|laughs|laughed|laughing|happy)\b/i },
  { action: "hold", term: "hold", pattern: /\b(hold|holds|held|holding|carry|carries|carried|carrying)\b/i },
];

const PROP_PATTERNS: Array<{ prop: SceneProp; term: string; pattern: RegExp }> = [
  { prop: "board", term: "board", pattern: /\b(board|chalkboard|whiteboard)\b/i },
  { prop: "table", term: "table", pattern: /\b(table|desk)\b/i },
  { prop: "beaker", term: "beaker", pattern: /\b(beaker|flask|test tube|experiment)\b/i },
  { prop: "water", term: "water", pattern: /\b(water|puddle|rain|ocean|river|lake)\b/i },
  { prop: "bubbles", term: "bubbles", pattern: /\bbubbles?\b/i },
  { prop: "box", term: "box", pattern: /\b(box|gift|present)\b/i },
  { prop: "mushroom", term: "mushroom", pattern: /\bmushrooms?\b/i },
  { prop: "lantern", term: "lantern", pattern: /\b(lanterns?|lamps?|torches?)\b/i },
  { prop: "treasure", term: "treasure", pattern: /\b(treasure|chest|gold)\b/i },
  { prop: "tree", term: "tree", pattern: /\btrees?\b/i },
  { prop: "plant", term: "plant", pattern: /\b(plants?|planted|planting|flowers?|seeds?|garden)\b/i },
  { prop: "blocks", term: "blocks", pattern: /\b(blocks?|bricks?)\b/i },
  { prop: "sun", term: "sun", pattern: /\b(sun|sunny|sunlight)\b/i },
  { prop: "cloud", term: "cloud", pattern: /\bclouds?|sky\b/i },
  { prop: "bridge", term: "bridge", pattern: /\b(bridge|log)\b/i },
  { prop: "lights", term: "lights", pattern: /\b(light|lights|glow|glowing|sparkle|sparkles|sparkling)\b/i },
];

function sceneSetting(text: string, mode: CreatorPromptVideoInput["mode"]): { setting: SceneSetting; term?: string } {
  const matches: Array<{ setting: SceneSetting; term: string; pattern: RegExp }> = [
    { setting: "classroom", term: "classroom", pattern: /\b(classroom|school|teacher|student|lesson)\b/i },
    { setting: "laboratory", term: "laboratory", pattern: /\b(lab|laboratory|scientist|experiment|beaker)\b/i },
    { setting: "forest", term: "forest", pattern: /\b(forest|woods|moss|mushroom|giant tree)\b/i },
    { setting: "garden", term: "garden", pattern: /\b(garden|plants?|planted|planting|flowers?|seeds?)\b/i },
    { setting: "sky", term: "sky", pattern: /\b(sky|cloud|flying|sun)\b/i },
    { setting: "space", term: "space", pattern: /\b(space|planet|star|moon|galaxy)\b/i },
    { setting: "ocean", term: "ocean", pattern: /\b(ocean|underwater|sea|beach)\b/i },
    { setting: "home", term: "home", pattern: /\b(home|house|family|room)\b/i },
    { setting: "city", term: "city", pattern: /\b(city|street|building|office)\b/i },
    { setting: "stage", term: "stage", pattern: /\b(stage|product|launch|spotlight)\b/i },
  ];
  const match = matches.find((item) => item.pattern.test(text));
  if (match) return { setting: match.setting, term: match.term };
  if (mode === "cartoon" || mode === "story") return { setting: "forest" };
  if (mode === "product-launch" || mode === "vfx") return { setting: "stage" };
  return { setting: "abstract" };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

const CONCEPT_STOP_WORDS = new Set([
  "about", "above", "after", "again", "against", "along", "also", "animated", "animation", "around", "before", "behind",
  "below", "brightly", "camera", "cartoon", "central", "character", "characters", "complete", "create", "develop", "different",
  "filled", "final", "finish", "first", "glowing", "happily", "important", "introduce", "large", "lesson", "lights", "motion",
  "narration", "next", "original", "prompt", "scene", "show", "sits", "story", "through", "together", "video", "visual", "while",
  "with", "without",
]);

function openConcepts(scene: CreatorProductionPlanScene, text: string, matchedTerms: string[]): CreatorSceneAnimationSpec["concepts"] {
  const known = new Set(matchedTerms.flatMap((term) => term.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter(Boolean));
  // Structural labels such as "Hook" and "Resolve" are editing metadata, not
  // visible story concepts. Including scene.title here made otherwise identical
  // scene graphs appear unique and weakened duplicate-scene QA.
  const source = `${scene.onScreenText ?? ""} ${text}`;
  const labels: string[] = [];
  for (const match of source.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]{3,}/gu)) {
    const raw = match[0];
    const normalized = raw.toLowerCase();
    if (CONCEPT_STOP_WORDS.has(normalized) || known.has(normalized)) continue;
    if (ACTION_PATTERNS.some((item) => item.term === normalized) || PROP_PATTERNS.some((item) => item.term === normalized)) continue;
    if (!labels.some((label) => label.toLowerCase() === normalized)) labels.push(raw[0]!.toUpperCase() + raw.slice(1));
    if (labels.length >= 4) break;
  }
  return labels.map((label) => ({ label, source: "prompt" as const }));
}

/**
 * Converts the planned visual beat into an explicit, testable scene graph. This
 * is not diffusion inference; it makes the lightweight renderer honor the
 * storyboard instead of reusing one mode-level loop with different words.
 */
export function analyzeAnimatedScene(
  mode: CreatorPromptVideoInput["mode"],
  scene: CreatorProductionPlanScene,
  sceneIndex: number,
  brief = "",
): CreatorSceneAnimationSpec {
  // The full brief may mention every character and action in the whole film.
  // Feeding it into every scene collapses all shots into the same cast/props.
  // Scene-local storyboard fields are therefore the sole semantic authority;
  // `brief` remains accepted for API compatibility and future fallback logic.
  void brief;
  const text = `${scene.visual} ${scene.narration} ${scene.onScreenText ?? ""}`;
  const matchedTerms: string[] = [];
  const settingMatch = sceneSetting(text, mode);
  if (settingMatch.term) matchedTerms.push(settingMatch.term);
  const subjects = SUBJECT_PATTERNS.filter((item) => item.pattern.test(text)).map((item) => {
    matchedTerms.push(item.label.toLowerCase());
    return { kind: item.kind, label: item.label };
  });
  if (/\bstudents\b/i.test(text) && subjects.some((item) => item.kind === "student")) {
    subjects.push({ kind: "student", label: "Student" });
  }
  if (/\bcharacters\b/i.test(text) && subjects.filter((item) => item.kind === "character").length === 1) {
    subjects.push({ kind: "character", label: "Character" });
  }
  if (/\bfriends\b/i.test(text) && subjects.filter((item) => item.kind === "friend").length === 1) {
    subjects.push({ kind: "friend", label: "Friend" });
  }
  const actions = ACTION_PATTERNS.filter((item) => item.pattern.test(text)).map((item) => {
    matchedTerms.push(item.term);
    return item.action;
  });
  const props = PROP_PATTERNS.filter((item) => item.pattern.test(text)).map((item) => {
    matchedTerms.push(item.term);
    return item.prop;
  });
  const concepts = openConcepts(scene, text, matchedTerms);
  // Establish deterministic motion before inferring an implied actor. Previously
  // a sparse scene received its fallback `hold` action only after this actor
  // check, producing a tree-only plate that correctly failed the motion gate.
  if (!actions.length) actions.push(sceneIndex === 0 ? "present" : sceneIndex === 1 ? "hold" : "celebrate");
  if (!props.length && mode === "cartoon") props.push(sceneIndex === 0 ? "lights" : sceneIndex === 1 ? "tree" : "sun");
  const actorActions = new Set<SceneAction>([
    "teach", "experiment", "build", "run", "chase", "jump", "climb", "hug", "celebrate", "hold",
  ]);
  if (!subjects.length && actions.some((action) => actorActions.has(action)) && (mode === "cartoon" || mode === "story")) {
    subjects.push({ kind: "character", label: "Story character" });
    matchedTerms.push("implied character");
    if (/\b(they|them|their|together|two|pair)\b/i.test(text)) {
      subjects.push({ kind: "character", label: "Story character" });
    }
  }
  if (!subjects.length && !concepts.length && !props.some((prop) => prop === "box" || prop === "treasure") && (mode === "cartoon" || mode === "story")) {
    subjects.push({ kind: "character", label: "Story character" });
  }
  const limitedSubjects = subjects.slice(0, 4);
  const limitedActions = unique(actions).slice(0, 3);
  const limitedProps = unique(props).slice(0, 6);
  return {
    setting: settingMatch.setting,
    subjects: limitedSubjects,
    actions: limitedActions,
    props: limitedProps,
    concepts,
    camera: /\b(close[- ]?up|macro)\b/i.test(text) ? "close" : sceneIndex === 0 ? "wide" : "medium",
    matchedTerms: unique(matchedTerms),
    semanticSignature: [
      settingMatch.setting,
      limitedSubjects.map((item) => item.kind).join("+"),
      limitedActions.join("+"),
      limitedProps.join("+"),
      concepts.map((item) => item.label.toLowerCase()).join("+"),
    ].join("|"),
  };
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

/**
 * A deterministic vector-animation scene. Unlike the legacy image path, every
 * background, prop, character limb, eye, and mouth is drawn independently and
 * changes over time. The output therefore remains sharp at 1080p without
 * artificial photo pans or camera shake.
 */
export function animatedSceneHtml(
  mode: CreatorPromptVideoInput["mode"],
  scene: CreatorProductionPlanScene,
  sceneIndex: number,
  presenter: NonNullable<CreatorPromptVideoInput["presenter"]> = "none",
  brief = "",
  layout: AnimatedSceneLayout = "landscape",
): string {
  const animation = scene.animation ?? analyzeAnimatedScene(mode, scene, sceneIndex, brief);
  const payload = scriptJson({ mode, scene, animation, sceneIndex, presenter, brief, layout, width: WIDTH, height: HEIGHT, fps: FPS });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Demo animated scene</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07101f}canvas{display:block;width:100vw;height:100vh}
</style></head><body><canvas id="stage" width="${WIDTH}" height="${HEIGHT}"></canvas><script>
const project=${payload};
const canvas=document.getElementById('stage');
const ctx=canvas.getContext('2d',{alpha:false,desynchronized:false});
const W=project.width,H=project.height,TAU=Math.PI*2,portrait=project.layout==='portrait';
const palettes={
  cartoon:{top:'#7dd3fc',bottom:'#fef3c7',ground:'#93c5a8',accent:'#f97316',ink:'#172554'},
  story:{top:'#312e81',bottom:'#c4b5fd',ground:'#264653',accent:'#fbbf24',ink:'#f8fafc'},
  product:{top:'#070b1d',bottom:'#1e1b4b',ground:'#111827',accent:'#8b5cf6',ink:'#f8fafc'},
  asmr:{top:'#071b2d',bottom:'#123c4a',ground:'#0f2a36',accent:'#67e8f9',ink:'#ecfeff'},
  vfx:{top:'#050816',bottom:'#260c3b',ground:'#09090b',accent:'#22d3ee',ink:'#faf5ff'}
};
const key=project.mode==='product-launch'?'product':project.mode;
const p=palettes[key]||palettes.product;
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function ease(v){v=clamp(v,0,1);return 1-Math.pow(1-v,3)}
function rounded(x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function wrap(text,max){const words=String(text||'').split(/\\s+/),lines=[];let line='';for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>max&&line){lines.push(line);line=word}else line=next}if(line)lines.push(line);return lines.slice(0,3)}
function textBlock(text,x,y,max,size,color,align='center',weight=800){ctx.save();ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';ctx.font=weight+' '+size+'px system-ui,Segoe UI,sans-serif';const lines=wrap(text,max);const step=size*1.18;lines.forEach((line,i)=>ctx.fillText(line,x,y+(i-(lines.length-1)/2)*step));ctx.restore()}
function fittedText(text,x,y,max,size,color,align='center',weight=800){const value=String(text||'');const fitted=value.length>58?Math.min(size,42):value.length>38?Math.min(size,48):size;textBlock(value,x,y,max,fitted,color,align,weight)}
function glow(color,blur){ctx.shadowColor=color;ctx.shadowBlur=blur}
function particleField(t,count=22){for(let i=0;i<count;i++){const x=(i*173+t*(18+i%5)*((i%2)?1:-1)+W*2)%W;const y=90+((i*97+t*(12+i%3))%(H-180));const r=3+(i%5);ctx.globalAlpha=.12+(i%4)*.035;ctx.fillStyle=i%3===0?p.accent:'#fff';ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill()}ctx.globalAlpha=1}
function cloud(x,y,s,t){ctx.save();ctx.translate(x+Math.sin(t*.2+x)*12,y);ctx.scale(s,s);ctx.fillStyle='rgba(255,255,255,.78)';for(const c of [[0,15,54],[62,0,72],[135,20,50],[72,35,90]]){ctx.beginPath();ctx.arc(c[0],c[1],c[2],0,TAU);ctx.fill()}ctx.restore()}
function character(x,y,s,t,colors,side=1,talking=true){
  const bob=Math.sin(t*2.4+x*.001)*8,walk=Math.sin(t*3.2+x*.003),blink=(t%3.6)>3.42;
  ctx.save();ctx.translate(x,y+bob);ctx.scale(s*side,s);
  ctx.strokeStyle=colors.ink||'#172554';ctx.lineWidth=18;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(-34,150);ctx.lineTo(-44+walk*14,244);ctx.moveTo(34,150);ctx.lineTo(48-walk*14,244);ctx.stroke();
  ctx.fillStyle=colors.body;rounded(-82,-18,164,180,58);ctx.fill();
  const gesture=Math.sin(t*2.1)*.45;
  ctx.strokeStyle=colors.skin;ctx.lineWidth=24;ctx.beginPath();ctx.moveTo(-66,20);ctx.lineTo(-128,-5+walk*18);ctx.moveTo(66,20);ctx.lineTo(124,-32-gesture*52);ctx.stroke();
  ctx.fillStyle=colors.skin;ctx.beginPath();ctx.arc(0,-92,92,0,TAU);ctx.fill();
  ctx.fillStyle=colors.hair;ctx.beginPath();ctx.arc(0,-122,88,Math.PI,TAU);ctx.lineTo(78,-90);ctx.quadraticCurveTo(30,-170,-76,-102);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#172554';ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(-42,-94);ctx.lineTo(-18,-94+(blink?0:1));ctx.moveTo(18,-94);ctx.lineTo(42,-94+(blink?0:1));ctx.stroke();
  if(!blink){ctx.fillStyle='#172554';ctx.beginPath();ctx.arc(-29,-94,6,0,TAU);ctx.arc(29,-94,6,0,TAU);ctx.fill()}
  const open=talking&&Math.sin(t*11)>-.15;ctx.fillStyle=open?'#7f1d1d':'#9f1239';ctx.beginPath();ctx.ellipse(0,-51,open?24:26,open?15:5,0,0,TAU);ctx.fill();
  if(open){ctx.fillStyle='#fecdd3';ctx.beginPath();ctx.ellipse(0,-45,12,5,0,0,TAU);ctx.fill()}
  ctx.restore();
}
function student(x,y,s,t,color,phase){character(x,y,s,t+phase,{skin:'#d8a47f',hair:color,body:color,ink:'#172554'},phase%2?1:-1,Math.sin(t*.7+phase)>.7)}
function arrow(x1,y1,x2,y2,color,t,phase=0){const pulse=.35+.65*((Math.sin(t*2+phase)+1)/2);ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.globalAlpha=.55+.35*pulse;ctx.lineWidth=9;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();const angle=Math.atan2(y2-y1,x2-x1);ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-Math.cos(angle-.55)*24,y2-Math.sin(angle-.55)*24);ctx.lineTo(x2-Math.cos(angle+.55)*24,y2-Math.sin(angle+.55)*24);ctx.closePath();ctx.fill();ctx.restore()}
function waterCycle(t,x,y,w,h){
  const sunX=x+150,sunY=y+120,seaY=y+h-62,cloudX=x+w*.55,cloudY=y+100;
  ctx.fillStyle='#facc15';ctx.beginPath();ctx.arc(sunX,sunY,52+Math.sin(t*2)*3,0,TAU);ctx.fill();
  for(let i=0;i<10;i++){const a=i/10*TAU;ctx.strokeStyle='rgba(250,204,21,.72)';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(sunX+70*Math.cos(a),sunY+70*Math.sin(a));ctx.lineTo(sunX+93*Math.cos(a),sunY+93*Math.sin(a));ctx.stroke()}
  ctx.fillStyle='#38bdf8';ctx.beginPath();ctx.moveTo(x+40,seaY);for(let px=x+40;px<=x+w-40;px+=34)ctx.lineTo(px,seaY+Math.sin(px*.04+t*2)*9);ctx.lineTo(x+w-40,y+h);ctx.lineTo(x+40,y+h);ctx.closePath();ctx.fill();
  for(let i=0;i<8;i++){const progress=(t*.16+i/8)%1,px=x+270+(i%3)*42,py=seaY-18-progress*210;ctx.globalAlpha=.2+.7*(1-progress);ctx.fillStyle='#0ea5e9';ctx.beginPath();ctx.arc(px+Math.sin(t+i)*12,py,7,0,TAU);ctx.fill()}ctx.globalAlpha=1;
  cloud(cloudX,cloudY,.64,t);
  for(let i=0;i<9;i++){const drop=(t*.24+i/9)%1;ctx.strokeStyle='rgba(14,165,233,.82)';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(cloudX+35+(i%5)*35,cloudY+82+drop*145);ctx.lineTo(cloudX+27+(i%5)*35,cloudY+102+drop*145);ctx.stroke()}
  arrow(x+360,seaY-30,cloudX+45,cloudY+90,'#f97316',t,.2);arrow(cloudX+245,cloudY+125,x+w-150,seaY-25,'#6366f1',t,1.2);arrow(x+w-120,seaY-5,x+185,seaY-5,'#0ea5e9',t,2.1);
  textBlock('EVAPORATION',x+315,seaY-165,220,24,'#0369a1');textBlock('CONDENSATION',cloudX+100,cloudY-42,250,24,'#475569');textBlock('PRECIPITATION',x+w-150,cloudY+205,250,24,'#4338ca');
}
function topicWords(){const stop=new Set(['about','after','again','against','also','and','are','because','before','being','between','both','but','can','characters','create','creating','does','during','each','everything','from','have','into','like','make','must','other','scene','should','show','that','their','then','there','these','they','this','through','video','visual','when','where','which','while','with','without','would','your']);const source=String(project.scene.narration||project.scene.onScreenText||project.scene.title).toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\\s+/).filter(word=>word.length>4&&!stop.has(word));return [...new Set(source)].slice(0,3)}
function board(t){
  const x=575,y=125,w=1120,h=525;ctx.save();ctx.fillStyle='#f8fafc';ctx.strokeStyle='#fdba74';ctx.lineWidth=24;rounded(x,y,w,h,34);ctx.fill();ctx.stroke();
  const reveal=ease(t/1.6);ctx.save();ctx.beginPath();ctx.rect(x+35,y+20,(w-70)*reveal,h-40);ctx.clip();
  fittedText(project.scene.onScreenText||project.scene.title,x+w/2,y+92,w-170,54,'#172554');
  const subject=String((project.brief||'')+' '+(project.scene.narration||'')+' '+(project.scene.onScreenText||'')).toLowerCase();
  if(/water cycle|evaporation|condensation|precipitation/.test(subject)){waterCycle(t,x+55,y+165,w-110,h-185)}else{
    const words=topicWords(),base=y+300;for(let i=0;i<3;i++){const px=x+235+i*325,py=base+Math.sin(t*1.5+i)*20;ctx.fillStyle=['#38bdf8','#f97316','#8b5cf6'][i];ctx.beginPath();ctx.arc(px,py,66,0,TAU);ctx.fill();textBlock((words[i]||String(i+1)).toUpperCase(),px,py,124,21,'#fff');if(i<2){arrow(px+82,py,x+240+(i+1)*325-82,base+Math.sin(t*1.5+i+1)*20,'#64748b',t,i)}}
  }
  ctx.restore();ctx.restore();
}
function sceneProgress(t){return clamp(t/Math.max(1,Number(project.scene.durationSeconds)||8),0,1)}
function titleRibbon(t){
  const enter=ease((t-.45)/.65),exit=clamp((1-sceneProgress(t)-.16)/.08,0,1),w=portrait?W*.3:W-340,x=(W-w)/2+(1-enter)*(portrait?-180:-420),y=48,h=112;
  ctx.save();ctx.globalAlpha=.94*exit;ctx.fillStyle='rgba(15,23,42,.88)';ctx.strokeStyle='rgba(255,255,255,.24)';ctx.lineWidth=3;rounded(x,y,w,h,34);ctx.fill();ctx.stroke();
  fittedText(project.scene.onScreenText||project.scene.title,W/2,y+55,w-70,portrait?43:55,'#fff');
  ctx.fillStyle=p.accent;rounded(x+28,y+28,12,56,6);ctx.fill();ctx.restore();
}
function setting(t){
  const kind=project.animation.setting;
  if(kind==='forest'||kind==='garden'){
    ctx.fillStyle=kind==='garden'?'#86efac':'#4d7c5a';ctx.fillRect(0,690,W,390);
    ctx.fillStyle='rgba(21,128,61,.22)';ctx.beginPath();ctx.moveTo(0,720);for(let x=0;x<=W;x+=120)ctx.lineTo(x,635+Math.sin(x*.009)*48);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();
    for(let i=0;i<7;i++)tree(90+i*310,745,.48+(i%3)*.06,t+i*.2);
    if(kind==='garden'){for(let i=0;i<12;i++){const x=65+i*165,y=810+Math.sin(i)*22;ctx.fillStyle=['#f472b6','#facc15','#a78bfa'][i%3];ctx.beginPath();ctx.arc(x,y,15+Math.sin(t*2+i)*2,0,TAU);ctx.fill()}}
  }else if(kind==='classroom'||kind==='laboratory'){
    ctx.fillStyle='#fef3c7';ctx.fillRect(0,0,W,760);ctx.fillStyle='#d6b98c';ctx.fillRect(0,760,W,320);ctx.fillStyle='#c08457';ctx.fillRect(0,744,W,18);
    ctx.fillStyle=kind==='laboratory'?'#e0f2fe':'#ecfccb';ctx.strokeStyle='#475569';ctx.lineWidth=16;rounded(1040,190,710,390,24);ctx.fill();ctx.stroke();
    textBlock(kind==='laboratory'?'DISCOVER • TEST • LEARN':'LOOK • THINK • SHARE',1395,270,600,34,'#334155');
    ctx.fillStyle='#e2e8f0';rounded(920,690,850,110,24);ctx.fill();ctx.fillStyle='#64748b';ctx.fillRect(960,790,30,160);ctx.fillRect(1690,790,30,160);
  }else if(kind==='sky'){
    ctx.fillStyle='#7dd3fc';ctx.fillRect(0,0,W,H);cloud(100,220,.8,t);cloud(1370,255,.62,t+2);cloud(760,430,.45,t+1);
    ctx.fillStyle='#65a30d';ctx.beginPath();ctx.moveTo(0,820);ctx.quadraticCurveTo(440,610,900,805);ctx.quadraticCurveTo(1370,610,W,830);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();
  }else if(kind==='space'){
    ctx.fillStyle='#050816';ctx.fillRect(0,0,W,H);particleField(t,64);ctx.fillStyle='#8b5cf6';ctx.beginPath();ctx.arc(1570,710,190,0,TAU);ctx.fill();ctx.strokeStyle='#fbbf24';ctx.lineWidth=18;ctx.beginPath();ctx.ellipse(1570,710,310,72,-.25,0,TAU);ctx.stroke();
  }else if(kind==='ocean'){
    ctx.fillStyle='#0e7490';ctx.fillRect(0,0,W,H);for(let i=0;i<12;i++){const x=(i*190+t*24)%W,y=250+(i%5)*130;ctx.strokeStyle='rgba(207,250,254,.55)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(x,y,12+(i%3)*5,0,TAU);ctx.stroke()}ctx.fillStyle='#f5d0a9';ctx.fillRect(0,850,W,230);
  }else if(kind==='home'||kind==='city'){
    ctx.fillStyle='#c7d2fe';ctx.fillRect(0,0,W,H);ctx.fillStyle='#94a3b8';ctx.fillRect(0,780,W,300);for(let i=0;i<8;i++){const x=i*260+20,h=240+(i%3)*95;ctx.fillStyle=['#475569','#334155','#64748b'][i%3];ctx.fillRect(x,780-h,210,h);ctx.fillStyle='#fde68a';for(let yy=575;yy<760;yy+=70)for(let xx=x+35;xx<x+185;xx+=65)ctx.fillRect(xx,yy,24,34)}
  }else{
    particleField(t,34);ctx.fillStyle='rgba(15,23,42,.35)';rounded(120,190,W-240,650,48);ctx.fill();
  }
}
function animal(kind,x,y,s,t,action,index){
  const progress=sceneProgress(t),running=action==='run'||action==='chase',flying=action==='fly'||kind==='bird'||kind==='butterfly';
  const travel=portrait?105:220,flight=portrait?90:180;let dx=running?-travel+progress*travel*2+Math.sin(t*3+index)*18:0,dy=0,rot=0;
  if(action==='jump')dy=-Math.abs(Math.sin(progress*Math.PI*3))*150;
  if(flying){dx=-flight+progress*flight*2;dy=-180+Math.sin(t*1.8+index)*75;rot=Math.sin(t*1.5)*.08}
  if(action==='climb')dy=130-progress*330;
  if(action==='sleep')dy=30+Math.sin(t*.8)*3;
  if(action==='celebrate'){dy=-Math.abs(Math.sin(t*3.8+index*.7))*105;rot=Math.sin(t*4.4+index)*.075}
  ctx.save();ctx.translate(x+dx,y+dy);ctx.rotate(rot);ctx.scale(s,s);
  const colors={rabbit:'#fbbf24',bear:'#a16207',cat:'#3b82f6',dragon:'#7c3aed',bird:'#fb7185',butterfly:'#ec4899',character:'#14b8a6'};const body=colors[kind]||'#14b8a6';
  if(kind==='butterfly'){ctx.fillStyle='#f9a8d4';ctx.beginPath();ctx.ellipse(-34,0,48,70,-.45,0,TAU);ctx.ellipse(34,0,48,70,.45,0,TAU);ctx.fill();ctx.fillStyle='#831843';rounded(-9,-60,18,120,9);ctx.fill();ctx.restore();return}
  if(kind==='bird'){ctx.fillStyle=body;ctx.beginPath();ctx.ellipse(0,10,105,66,0,0,TAU);ctx.fill();ctx.fillStyle='#fda4af';ctx.beginPath();ctx.ellipse(-20+Math.sin(t*8)*20,0,72,28,-.3,0,TAU);ctx.fill();ctx.fillStyle='#facc15';ctx.beginPath();ctx.moveTo(95,-10);ctx.lineTo(150,12);ctx.lineTo(96,30);ctx.closePath();ctx.fill();ctx.restore();return}
  if(kind==='dragon'){ctx.fillStyle='rgba(196,181,253,.86)';ctx.beginPath();ctx.moveTo(-70,-25);ctx.lineTo(-190,-130-Math.sin(t*5)*25);ctx.lineTo(-145,45);ctx.moveTo(70,-25);ctx.lineTo(190,-130+Math.sin(t*5)*25);ctx.lineTo(145,45);ctx.fill()}
  ctx.fillStyle=body;ctx.beginPath();ctx.ellipse(0,75,125,105,0,0,TAU);ctx.fill();ctx.beginPath();ctx.arc(0,-55,92,0,TAU);ctx.fill();
  if(kind==='rabbit'){ctx.beginPath();ctx.ellipse(-38,-165,28,92,-.12,0,TAU);ctx.ellipse(38,-165,28,92,.12,0,TAU);ctx.fill()}
  else if(kind==='cat'){ctx.beginPath();ctx.moveTo(-72,-112);ctx.lineTo(-42,-205);ctx.lineTo(-5,-125);ctx.moveTo(72,-112);ctx.lineTo(42,-205);ctx.lineTo(5,-125);ctx.fill();ctx.strokeStyle=body;ctx.lineWidth=28;ctx.beginPath();ctx.arc(115,82,80,-1.4,1.4);ctx.stroke()}
  else if(kind==='bear'){ctx.beginPath();ctx.arc(-66,-125,35,0,TAU);ctx.arc(66,-125,35,0,TAU);ctx.fill()}
  else if(kind==='dragon'){ctx.beginPath();ctx.moveTo(-65,-110);ctx.lineTo(-42,-188);ctx.lineTo(-10,-120);ctx.moveTo(65,-110);ctx.lineTo(42,-188);ctx.lineTo(10,-120);ctx.fill();ctx.strokeStyle=body;ctx.lineWidth=34;ctx.beginPath();ctx.moveTo(110,80);ctx.quadraticCurveTo(245,120,275,15);ctx.stroke()}
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-31,-65,20,0,TAU);ctx.arc(31,-65,20,0,TAU);ctx.fill();ctx.fillStyle='#172554';ctx.beginPath();ctx.arc(-27,-63,8,0,TAU);ctx.arc(35,-63,8,0,TAU);ctx.fill();
  const mouth=action==='sleep'?4:9+Math.abs(Math.sin(t*9))*9;ctx.fillStyle='#7f1d1d';ctx.beginPath();ctx.ellipse(0,-20,22,mouth,0,0,TAU);ctx.fill();
  ctx.strokeStyle='#172554';ctx.lineWidth=18;ctx.lineCap='round';const stride=running?Math.sin(t*9)*30:action==='celebrate'?Math.sin(t*6+index)*38:Math.sin(t*2+index)*8;ctx.beginPath();ctx.moveTo(-52,145);ctx.lineTo(-58+stride,225);ctx.moveTo(52,145);ctx.lineTo(58-stride,225);ctx.stroke();
  if(action==='sleep'){ctx.fillStyle='#4338ca';textBlock('Z z z',130,-165,180,36,'#4338ca')}
  ctx.restore();
}
function prop(kind,x,y,s,t,index){
  const progress=sceneProgress(t);ctx.save();ctx.translate(x,y);ctx.scale(s,s);
  if(kind==='box'){const float=-55+Math.sin(t*1.8)*28;ctx.translate(0,float);glow('#fbbf24',38);ctx.fillStyle='#fb7185';rounded(-115,-90,230,180,24);ctx.fill();ctx.fillStyle='#fde68a';ctx.fillRect(-18,-90,36,180);ctx.fillRect(-115,-18,230,36);ctx.beginPath();ctx.ellipse(-35,-102,45,24,-.45,0,TAU);ctx.ellipse(35,-102,45,24,.45,0,TAU);ctx.fill();ctx.shadowBlur=0}
  else if(kind==='mushroom'){glow('#fef08a',24);ctx.fillStyle='#fef3c7';rounded(-24,-5,48,110,18);ctx.fill();ctx.fillStyle='#ef4444';ctx.beginPath();ctx.arc(0,-12,82,Math.PI,TAU);ctx.fill();ctx.fillStyle='#fff';for(const d of [[-38,-42],[2,-58],[38,-30]]){ctx.beginPath();ctx.arc(d[0],d[1],10,0,TAU);ctx.fill()}ctx.shadowBlur=0}
  else if(kind==='lantern'){glow('#fbbf24',45);ctx.fillStyle='#fef08a';rounded(-55,-55,110,125,22);ctx.fill();ctx.strokeStyle='#78350f';ctx.lineWidth=12;ctx.stroke();ctx.beginPath();ctx.arc(0,-60,55,Math.PI,TAU);ctx.stroke();ctx.shadowBlur=0}
  else if(kind==='treasure'){ctx.fillStyle='#92400e';rounded(-135,-55,270,135,22);ctx.fill();ctx.fillStyle='#f59e0b';ctx.fillRect(-135,-5,270,24);ctx.save();ctx.translate(-135,-48);ctx.rotate(-ease(progress*2.4)*.58);ctx.translate(135,48);ctx.fillStyle='#f59e0b';ctx.beginPath();ctx.arc(0,-50,135,Math.PI,TAU);ctx.fill();ctx.restore();ctx.fillStyle='#fef08a';for(let i=0;i<10;i++){const lift=ease(progress*1.8)*Math.sin(progress*Math.PI)*(55+(i%4)*24);ctx.beginPath();ctx.arc(-112+i*25,-22-Math.abs(Math.sin(i))*25-lift,11+(i%3)*2,0,TAU);ctx.fill()}}
  else if(kind==='tree'){
    const rainbow=/\\brainbow\\b/i.test(String(project.scene.visual||'')+' '+String(project.scene.narration||''));
    if(!rainbow)tree(0,160,1,t);else{ctx.fillStyle='#7c2d12';ctx.fillRect(-24,-35,48,205);const colors=['#fb7185','#f59e0b','#facc15','#22c55e','#38bdf8','#8b5cf6'];for(let i=0;i<6;i++){const a=i/6*TAU+t*.04;ctx.fillStyle=colors[i];ctx.beginPath();ctx.arc(Math.cos(a)*105,-115+Math.sin(a)*78,76+Math.sin(t+i)*4,0,TAU);ctx.fill()}}
  }
  else if(kind==='plant'){const grow=.25+.75*progress;ctx.strokeStyle='#15803d';ctx.lineWidth=16;ctx.beginPath();ctx.moveTo(0,90);ctx.lineTo(0,90-220*grow);ctx.stroke();ctx.fillStyle='#22c55e';for(let i=0;i<4;i++){const yy=40-i*48*grow;ctx.beginPath();ctx.ellipse((i%2?1:-1)*44,yy,54*grow,25*grow,(i%2?-.45:.45),0,TAU);ctx.fill()}ctx.fillStyle='#a16207';rounded(-85,90,170,85,18);ctx.fill()}
  else if(kind==='blocks'){for(let i=0;i<6;i++){const visible=progress*7>i;if(!visible)continue;ctx.fillStyle=['#f97316','#3b82f6','#8b5cf6','#22c55e'][i%4];rounded(-120+(i%3)*82,85-Math.floor(i/3)*82,72,72,10);ctx.fill()}}
  else if(kind==='beaker'||kind==='water'){ctx.strokeStyle='#e2e8f0';ctx.lineWidth=12;ctx.fillStyle='rgba(56,189,248,.68)';ctx.beginPath();ctx.moveTo(-65,-120);ctx.lineTo(-65,10);ctx.quadraticCurveTo(-110,120,0,145);ctx.quadraticCurveTo(110,120,65,10);ctx.lineTo(65,-120);ctx.stroke();ctx.beginPath();ctx.moveTo(-76,40);ctx.quadraticCurveTo(0,20,76,40);ctx.lineTo(62,95);ctx.quadraticCurveTo(0,135,-62,95);ctx.closePath();ctx.fill();for(let i=0;i<6;i++){ctx.beginPath();ctx.arc(-45+i*18,20-((t*55+i*31)%120),8,0,TAU);ctx.stroke()}}
  else if(kind==='bubbles'){ctx.strokeStyle='rgba(255,255,255,.72)';ctx.lineWidth=7;for(let i=0;i<9;i++){const yy=100-((t*70+i*58)%330),xx=-120+(i%5)*60;ctx.beginPath();ctx.arc(xx,yy,16+(i%3)*7,0,TAU);ctx.stroke()}}
  else if(kind==='sun'){ctx.fillStyle='#facc15';ctx.beginPath();ctx.arc(0,0,72+Math.sin(t*2)*4,0,TAU);ctx.fill()}
  else if(kind==='cloud'){cloud(-80,-60,.72,t)}
  else if(kind==='bridge'){ctx.fillStyle='#92400e';rounded(-165,10,330,48,20);ctx.fill();for(let i=-130;i<=130;i+=52){ctx.fillStyle='#b45309';rounded(i,-5,40,80,10);ctx.fill()}}
  else if(kind==='lights'){for(let i=0;i<8;i++){const a=i/8*TAU+t*.25,r=65+20*Math.sin(t+i);ctx.fillStyle=['#fef08a','#f9a8d4','#a5f3fc'][i%3];ctx.beginPath();ctx.arc(Math.cos(a)*r,Math.sin(a)*r,10+(i%3)*3,0,TAU);ctx.fill()}}
  ctx.restore();
}
function conceptToken(label,x,y,s,t,index){
  const hue=(String(label).split('').reduce((sum,char)=>sum+char.charCodeAt(0),0)*37)%360,bob=Math.sin(t*1.7+index)*12;
  ctx.save();ctx.translate(x,y+bob);ctx.scale(s,s);glow('hsla('+hue+',85%,62%,.55)',28);ctx.fillStyle='hsla('+hue+',72%,48%,.94)';ctx.strokeStyle='rgba(255,255,255,.72)';ctx.lineWidth=5;rounded(-155,-105,310,210,36);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  ctx.fillStyle='rgba(255,255,255,.2)';ctx.beginPath();ctx.arc(0,-24,54+Math.sin(t*2+index)*4,0,TAU);ctx.fill();fittedText(String(label).slice(0,1).toUpperCase(),0,-24,80,64,'#fff');fittedText(label,0,72,270,32,'#fff');ctx.restore();
}
function semanticCartoon(t){
  setting(t);const spec=project.animation,actions=spec.actions.length?spec.actions:['present'];
  const props=spec.props.filter(item=>!['board','table'].includes(item));
  props.forEach((item,index)=>{const count=Math.max(1,props.length),step=portrait?Math.min(.09,.24/count):Math.min(.18,.48/count),x=W*((portrait?0.5:0.52)+(index-(count-1)/2)*step),y=item==='sun'||item==='cloud'?(portrait?225:300):portrait&&spec.subjects.length>2?450+(index%2)*70:650+(index%2)*80;prop(item,x,y,count>3?.58:.78,t,index)});
  const conceptLimit=spec.subjects.length||props.length?0:3,concepts=(spec.concepts||[]).slice(0,conceptLimit);concepts.forEach((item,index)=>{const count=Math.max(1,concepts.length),step=portrait?Math.min(.09,.24/count):Math.min(.24,.56/count),x=W*(.5+(index-(count-1)/2)*step);conceptToken(item.label,x,365,count>2?.52:.64,t,index)});
  const subjectAction=(kind,index)=>{if(kind==='bird'||kind==='butterfly')return 'fly';if(actions.includes('celebrate'))return 'celebrate';if((kind==='rabbit'||kind==='student'||kind==='child'||kind==='friend'||kind==='family'||kind==='character')&&actions.includes('jump'))return 'jump';if(['bear','rabbit','cat','dragon','student','child','friend','family','character'].includes(kind)&&actions.includes('hold'))return 'hold';if(kind==='cat'&&actions.includes('chase'))return 'chase';if(kind==='dragon'&&actions.includes('fly'))return 'fly';if(kind==='teacher'&&actions.includes('teach'))return 'teach';if(kind==='scientist'&&actions.includes('experiment'))return 'experiment';if((kind==='student'||kind==='child'||kind==='friend'||kind==='family'||kind==='character')&&actions.includes('run'))return actions.includes('chase')&&index%2===0?'chase':'run';return actions[Math.min(index,actions.length-1)]||actions[0]};
  const subjects=spec.subjects;subjects.forEach((item,index)=>{const action=subjectAction(item.kind,index),count=Math.max(1,subjects.length),step=portrait?Math.min(.09,.26/count):count>1?.6/(count-1):0;let x=W*(portrait?0.5+(index-(count-1)/2)*step:0.2+(index/(Math.max(1,count-1)))*0.6),y=720;
    if(action==='hug'&&count>1)x=W*.5+(index-(count-1)/2)*(180*(1-sceneProgress(t)));
    const human=['teacher','scientist','student','child','family','friend','character'].includes(item.kind);
    if(human){const colors=[{skin:'#c98b6b',hair:'#3f2d24',body:'#f97316',ink:'#172554'},{skin:'#8d5524',hair:'#111827',body:'#2563eb',ink:'#172554'},{skin:'#e0ac69',hair:'#713f12',body:'#7c3aed',ink:'#172554'}][index%3];let dx=0,dy=0;if(action==='run'||action==='chase')dx=-300+sceneProgress(t)*600;if(action==='jump')dy=-Math.abs(Math.sin(sceneProgress(t)*Math.PI*3))*130;if(action==='climb')dy=120-sceneProgress(t)*300;if(action==='celebrate')dy=-Math.abs(Math.sin(t*3.8+index*.7))*105;character(x+dx,y+dy,count>2?.5:.66,t+(index*.8),colors,index%2?1:-1,action!=='sleep')}
    else animal(item.kind,x,y,count>2?.62:.78,t,action,index);
  });
  if(!subjects.length&&props.length===0&&!concepts.length){ctx.fillStyle='rgba(255,255,255,.88)';rounded(300,250,W-600,470,45);ctx.fill();fittedText(project.scene.visual,W/2,485,W-760,58,'#172554')}
  titleRibbon(t);
}
function cartoon(t){
  const subject=String((project.brief||'')+' '+(project.scene.narration||'')+' '+(project.scene.onScreenText||'')+' '+(project.scene.visual||'')).toLowerCase();
  if(/water cycle|evaporation|condensation|precipitation/.test(subject)){
    cloud(80,78,.72,t);cloud(1540,70,.55,t+2);ctx.fillStyle=p.ground;ctx.fillRect(0,760,W,320);ctx.fillStyle='#e7e5e4';ctx.fillRect(0,742,W,18);board(t);
    if(project.presenter==='none')character(300,570,.8,t,{skin:'#c98b6b',hair:'#3f2d24',body:'#f97316',ink:'#172554'},1,true);student(690,755,.4,t,'#2563eb',.5);student(1100,760,.41,t,'#7c3aed',1.7);student(1495,755,.4,t,'#db2777',2.8);
  }else semanticCartoon(t);
}
function product(t){
  particleField(t,34);ctx.strokeStyle='rgba(139,92,246,.18)';ctx.lineWidth=2;for(let x=0;x<W;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}for(let y=0;y<H;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
  const enter=ease(t/1.4);const cx=W/2,cy=H*.49;ctx.save();ctx.translate(cx,cy);ctx.scale(.82+.18*enter,.82+.18*enter);glow(p.accent,50);ctx.fillStyle='rgba(17,24,39,.92)';ctx.strokeStyle=p.accent;ctx.lineWidth=5;rounded(-500,-300,1000,600,48);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  textBlock(project.scene.onScreenText||project.scene.title,0,-175,780,72,p.ink);textBlock(project.scene.visual,0,-40,780,40,'#cbd5e1','center',600);
  for(let i=0;i<3;i++){const yy=90+i*82,fill=.28+.2*Math.sin(t*1.5+i);ctx.fillStyle='rgba(255,255,255,.07)';rounded(-380,yy,760,42,21);ctx.fill();ctx.fillStyle=['#8b5cf6','#22d3ee','#f97316'][i];rounded(-380,yy,760*clamp(fill,0.12,.92),42,21);ctx.fill()}
  ctx.restore();
  const concepts=(project.animation.concepts||[]).slice(0,2);concepts.forEach((item,index)=>conceptToken(item.label,index?1690:230,520,.38,t,index));
  if(project.presenter!=='none')character(1650,720,.72,t,{skin:'#b9785e',hair:'#171717',body:'#8b5cf6',ink:'#f8fafc'},-1,true);
}
function tree(x,y,s,t){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle='#6b4423';ctx.fillRect(-22,-190,44,200);ctx.fillStyle='#2a9d8f';for(const a of [[-70,-210,78],[25,-245,92],[88,-185,68],[-8,-315,78]]){ctx.beginPath();ctx.arc(a[0]+Math.sin(t*.5+x)*7,a[1],a[2],0,TAU);ctx.fill()}ctx.restore()}
function story(t){
  ctx.fillStyle='#1e3a5f';ctx.beginPath();ctx.moveTo(0,650);for(let x=0;x<=W;x+=160)ctx.lineTo(x,520+Math.sin(x*.006+t*.08)*80);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();
  ctx.fillStyle=p.ground;ctx.beginPath();ctx.moveTo(0,760);ctx.quadraticCurveTo(W*.5,650,W,790);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();
  for(let i=0;i<7;i++)tree(120+i*300-(t*18)%300,760,.52+(i%3)*.08,t);
  const x=500+Math.sin(t*.24)*130;if(project.presenter!=='none')character(x,720,.78,t,{skin:'#d5a07a',hair:'#422006',body:'#fbbf24',ink:'#172554'},1,true);
  ctx.fillStyle='rgba(15,23,42,.78)';rounded(850,130,850,340,38);ctx.fill();textBlock(project.scene.onScreenText||project.scene.title,1275,235,700,68,p.ink);textBlock(project.scene.visual,1275,355,700,38,'#ddd6fe','center',580);
}
function asmr(t){
  particleField(t,44);const cx=W/2,cy=H/2+70;for(let i=0;i<7;i++){const r=90+i*65+Math.sin(t*1.1+i)*18;ctx.strokeStyle='rgba(103,232,249,'+(.5-i*.05)+')';ctx.lineWidth=5;ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.stroke()}
  const pour=(t*150)%(H+400)-180;ctx.fillStyle='rgba(165,243,252,.7)';rounded(cx-34,-80,68,pour+200,34);ctx.fill();glow('#67e8f9',42);ctx.fillStyle='rgba(207,250,254,.5)';ctx.beginPath();ctx.ellipse(cx,cy,280+Math.sin(t)*24,94+Math.cos(t*1.3)*10,0,0,TAU);ctx.fill();ctx.shadowBlur=0;
  textBlock(project.scene.onScreenText||project.scene.title,cx,150,1200,62,p.ink);
  const concepts=(project.animation.concepts||[]).slice(0,2);concepts.forEach((item,index)=>conceptToken(item.label,index?1640:280,700,.36,t,index));
}
function vfx(t){
  particleField(t,48);ctx.save();ctx.translate(W/2,H/2);for(let i=0;i<13;i++){ctx.rotate(.12+Math.sin(t*.3)*.004);ctx.strokeStyle=i%2?'rgba(34,211,238,.56)':'rgba(217,70,239,.48)';ctx.lineWidth=4+i*.4;ctx.strokeRect(-120-i*38,-120-i*38,240+i*76,240+i*76)}ctx.restore();
  const pulse=1+Math.sin(t*2.6)*.04;ctx.save();ctx.translate(W/2,H/2);ctx.scale(pulse,pulse);glow(p.accent,58);ctx.fillStyle='rgba(5,8,22,.88)';rounded(-520,-190,1040,380,42);ctx.fill();ctx.shadowBlur=0;textBlock(project.scene.onScreenText||project.scene.title,0,-35,850,76,p.ink);textBlock(project.scene.visual,0,85,820,38,'#a5f3fc','center',600);ctx.restore();
  const concepts=(project.animation.concepts||[]).slice(0,2);concepts.forEach((item,index)=>conceptToken(item.label,index?1640:280,760,.4,t,index));
}
function background(){const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,p.top);g.addColorStop(1,p.bottom);ctx.fillStyle=g;ctx.fillRect(0,0,W,H)}
function frame(t){background();if(project.mode==='cartoon')cartoon(t);else if(project.mode==='story')semanticCartoon(t);else if(project.mode==='asmr')asmr(t);else if(project.mode==='vfx')vfx(t);else product(t)}
frame(0);
window.agentDemoRecord=async function(seconds){
  const stream=canvas.captureStream(project.fps);const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp8')?'video/webm;codecs=vp8':'video/webm';
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:12000000});const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start(250);const started=performance.now();
  await new Promise(resolve=>{function tick(now){const elapsed=(now-started)/1000;frame(Math.min(seconds,elapsed));if(elapsed>=seconds)resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)});
  recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());const blob=new Blob(chunks,{type:mime});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='scene.webm';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
</script></body></html>`;
}

async function transcodeScene(webmPath: string, outputPath: string, durationSeconds: number, layout: AnimatedSceneLayout): Promise<void> {
  const frameFilter = layout === "portrait"
    ? "scale=-2:1920:flags=lanczos,crop=1080:1920"
    : `scale=${WIDTH}:${HEIGHT}:flags=lanczos`;
  const result = await runCommand(ffmpegCommand(), [
    "-y", "-i", webmPath,
    "-vf", `fps=${FPS},${frameFilter},setsar=1,tpad=stop_mode=clone:stop_duration=1,trim=duration=${durationSeconds.toFixed(3)},format=yuv420p`,
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-movflags", "+faststart", outputPath,
  ], { timeoutMs: 20 * 60_000 });
  if (result.code !== 0) {
    throw new AgentDemoError("ANIMATED_SCENE_RENDER_FAILED", result.stderr.trim().split("\n").slice(-24).join("\n") || `Could not render ${outputPath}.`);
  }
}

export async function generateAnimatedSceneMedia(
  input: CreatorPromptVideoInput,
  plan: CreatorProductionPlan,
  outputDirectory: string,
  report: ProgressReporter = () => undefined,
): Promise<SceneMediaGenerationResult> {
  const startedAt = Date.now();
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const quality: MotionQualityReport[] = [];
  const outputs: SceneMediaGenerationResult["outputs"] = [];
  const layout = animatedSceneLayout(input);
  const semanticScenes = plan.scenes.map((scene, index) => ({
    sceneId: scene.id,
    title: scene.title,
    visual: scene.visual,
    animation: scene.animation ?? analyzeAnimatedScene(input.mode, scene, index, input.prompt),
  }));
  const semanticIssues: string[] = [];
  const signatures = semanticScenes.map((item) => item.animation.semanticSignature);
  if (new Set(signatures).size !== signatures.length) {
    semanticIssues.push("Two or more scenes resolved to the same subjects, setting, action, props, and open concepts.");
  }
  for (const item of semanticScenes) {
    if (!item.animation.subjects.length && !item.animation.props.length && !item.animation.concepts.length) {
      semanticIssues.push(`${item.sceneId} has no drawable subject, prop, or open prompt concept from its planned visual.`);
    }
  }
  const semanticReportPath = path.join(outputRoot, "semantic-quality.json");
  await writeFile(semanticReportPath, `${JSON.stringify({
    passed: semanticIssues.length === 0,
    renderer: "agent-demo-open-concept-motion-graphics-v4",
    layout,
    disclosure: "Deterministic vector motion graphics; not diffusion or Wan/LTX model inference.",
    issues: semanticIssues,
    scenes: semanticScenes,
  }, null, 2)}\n`, "utf8");
  if (semanticIssues.length) {
    throw new AgentDemoError("ANIMATED_SCENE_SEMANTICS_FAILED", `The motion-graphics storyboard is not scene-specific: ${semanticIssues.join(" ")}`);
  }
  try {
    for (const [index, scene] of plan.scenes.entries()) {
      report(30 + index * 12, `Animating scene ${index + 1} of ${plan.scenes.length}: ${scene.title}`);
      const stem = `${String(index + 1).padStart(2, "0")}-${slugify(scene.title) || `scene-${index + 1}`}`;
      const htmlPath = path.join(outputRoot, `${stem}.html`);
      const webmPath = path.join(outputRoot, `${stem}.webm`);
      const outputPath = path.join(outputRoot, `${stem}.mp4`);
      const sceneWithAnimation = { ...scene, animation: semanticScenes[index]!.animation };
      await writeFile(htmlPath, animatedSceneHtml(input.mode, sceneWithAnimation, index, input.presenter ?? "none", input.prompt, layout), "utf8");
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "load" });
        const downloadPromise = page.waitForEvent("download", { timeout: Math.ceil(scene.durationSeconds * 1_000) + 60_000 });
        await page.evaluate(async (seconds) => {
          const recorder = (window as unknown as { agentDemoRecord(seconds: number): Promise<void> }).agentDemoRecord;
          await recorder(seconds);
        }, scene.durationSeconds);
        const download = await downloadPromise;
        await download.saveAs(webmPath);
      } finally {
        await context.close();
      }
      await transcodeScene(webmPath, outputPath, scene.durationSeconds, layout);
      await unlink(webmPath).catch(() => undefined);
      const motion = await requireMovingVideo(outputPath);
      quality.push(motion);
      const media = await probeMediaInfo(outputPath);
      outputs.push({
        path: outputPath,
        kind: "video",
        sceneId: scene.id,
        model: "agent-demo-open-concept-motion-graphics-v4",
        prompt: `${scene.visual}. Character action and camera remain stable; ${scene.narration}`,
        rights: "Original deterministic vector animation generated locally by Agent Demo Studio under MIT.",
        durationSeconds: media.durationSeconds,
        width: media.width,
        height: media.height,
        fps: media.fps,
      });
    }
  } finally {
    await browser.close();
  }
  const qualityReportPath = path.join(outputRoot, "motion-quality.json");
  await writeFile(qualityReportPath, `${JSON.stringify({ passed: quality.every((item) => item.passed), clips: quality }, null, 2)}\n`, "utf8");
  return {
    provider: "animated",
    local: true,
    task: "character-animation",
    qualityTier: "animated-2d",
    durationMs: Date.now() - startedAt,
    outputs,
    qualityReportPath,
    semanticReportPath,
    backend: { name: "Agent Demo Studio vector animation engine v4" },
  };
}
