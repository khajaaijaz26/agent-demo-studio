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
import type { CreatorProductionPlan, CreatorProductionPlanScene, CreatorPromptVideoInput } from "./types.js";

type ProgressReporter = (progress: number, message: string) => void;

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

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
): string {
  const payload = scriptJson({ mode, scene, sceneIndex, presenter, brief, width: WIDTH, height: HEIGHT, fps: FPS });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Demo animated scene</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07101f}canvas{display:block;width:100vw;height:100vh}
</style></head><body><canvas id="stage" width="${WIDTH}" height="${HEIGHT}"></canvas><script>
const project=${payload};
const canvas=document.getElementById('stage');
const ctx=canvas.getContext('2d',{alpha:false,desynchronized:false});
const W=project.width,H=project.height,TAU=Math.PI*2;
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
function cartoon(t){
  cloud(80,78,.72,t);cloud(1540,70,.55,t+2);ctx.fillStyle=p.ground;ctx.fillRect(0,760,W,320);
  ctx.fillStyle='#e7e5e4';ctx.fillRect(0,742,W,18);board(t);
  const subject=String((project.brief||'')+' '+(project.scene.narration||'')+' '+(project.scene.onScreenText||'')+' '+(project.scene.visual||'')).toLowerCase();
  const classroom=/teacher|student|classroom|lesson|school|teach|water cycle|fractions|science|learning/.test(subject);
  if(project.presenter==='none'&&classroom)character(300,570,.8,t,{skin:'#c98b6b',hair:'#3f2d24',body:'#f97316',ink:'#172554'},1,true);
  if(classroom){student(690,755,.4,t,'#2563eb',.5);student(1100,760,.41,t,'#7c3aed',1.7);student(1495,755,.4,t,'#db2777',2.8)}
}
function product(t){
  particleField(t,34);ctx.strokeStyle='rgba(139,92,246,.18)';ctx.lineWidth=2;for(let x=0;x<W;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}for(let y=0;y<H;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
  const enter=ease(t/1.4);const cx=W/2,cy=H*.49;ctx.save();ctx.translate(cx,cy);ctx.scale(.82+.18*enter,.82+.18*enter);glow(p.accent,50);ctx.fillStyle='rgba(17,24,39,.92)';ctx.strokeStyle=p.accent;ctx.lineWidth=5;rounded(-500,-300,1000,600,48);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  textBlock(project.scene.onScreenText||project.scene.title,0,-175,780,72,p.ink);textBlock(project.scene.visual,0,-40,780,40,'#cbd5e1','center',600);
  for(let i=0;i<3;i++){const yy=90+i*82,fill=.28+.2*Math.sin(t*1.5+i);ctx.fillStyle='rgba(255,255,255,.07)';rounded(-380,yy,760,42,21);ctx.fill();ctx.fillStyle=['#8b5cf6','#22d3ee','#f97316'][i];rounded(-380,yy,760*clamp(fill,0.12,.92),42,21);ctx.fill()}
  ctx.restore();
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
}
function vfx(t){
  particleField(t,48);ctx.save();ctx.translate(W/2,H/2);for(let i=0;i<13;i++){ctx.rotate(.12+Math.sin(t*.3)*.004);ctx.strokeStyle=i%2?'rgba(34,211,238,.56)':'rgba(217,70,239,.48)';ctx.lineWidth=4+i*.4;ctx.strokeRect(-120-i*38,-120-i*38,240+i*76,240+i*76)}ctx.restore();
  const pulse=1+Math.sin(t*2.6)*.04;ctx.save();ctx.translate(W/2,H/2);ctx.scale(pulse,pulse);glow(p.accent,58);ctx.fillStyle='rgba(5,8,22,.88)';rounded(-520,-190,1040,380,42);ctx.fill();ctx.shadowBlur=0;textBlock(project.scene.onScreenText||project.scene.title,0,-35,850,76,p.ink);textBlock(project.scene.visual,0,85,820,38,'#a5f3fc','center',600);ctx.restore();
}
function background(){const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,p.top);g.addColorStop(1,p.bottom);ctx.fillStyle=g;ctx.fillRect(0,0,W,H)}
function frame(t){background();if(project.mode==='cartoon')cartoon(t);else if(project.mode==='story')story(t);else if(project.mode==='asmr')asmr(t);else if(project.mode==='vfx')vfx(t);else product(t)}
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

async function transcodeScene(webmPath: string, outputPath: string, durationSeconds: number): Promise<void> {
  const result = await runCommand(ffmpegCommand(), [
    "-y", "-i", webmPath,
    "-vf", `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,tpad=stop_mode=clone:stop_duration=1,trim=duration=${durationSeconds.toFixed(3)},format=yuv420p`,
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
  try {
    for (const [index, scene] of plan.scenes.entries()) {
      report(30 + index * 12, `Animating scene ${index + 1} of ${plan.scenes.length}: ${scene.title}`);
      const stem = `${String(index + 1).padStart(2, "0")}-${slugify(scene.title) || `scene-${index + 1}`}`;
      const htmlPath = path.join(outputRoot, `${stem}.html`);
      const webmPath = path.join(outputRoot, `${stem}.webm`);
      const outputPath = path.join(outputRoot, `${stem}.mp4`);
      await writeFile(htmlPath, animatedSceneHtml(input.mode, scene, index, input.presenter ?? "none", input.prompt), "utf8");
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
      await transcodeScene(webmPath, outputPath, scene.durationSeconds);
      await unlink(webmPath).catch(() => undefined);
      const motion = await requireMovingVideo(outputPath);
      quality.push(motion);
      const media = await probeMediaInfo(outputPath);
      outputs.push({
        path: outputPath,
        kind: "video",
        sceneId: scene.id,
        model: "agent-demo-vector-animation-v1",
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
    backend: { name: "Agent Demo Studio vector animation engine" },
  };
}
