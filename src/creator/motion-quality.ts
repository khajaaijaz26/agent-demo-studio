import { ffmpegCommand } from "../config.js";
import { AgentDemoError } from "../errors.js";
import { runCommand } from "../utils/process.js";
import { probeMediaInfo } from "./media.js";

export interface MotionQualityReport {
  source: string;
  passed: boolean;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  samples: number;
  averageFrameDifference: number;
  medianFrameDifference: number;
  activeFrameRatio: number;
  issues: string[];
}

function percentile(values: number[], value: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * value)));
  return sorted[index] ?? 0;
}

/**
 * Rejects frozen or nearly frozen files before they enter the timeline. This is
 * deliberately content-agnostic: it proves that a requested video contains
 * temporal change, while model-specific review remains the backend's job.
 */
export async function inspectMotionQuality(filePath: string): Promise<MotionQualityReport> {
  const probe = await probeMediaInfo(filePath);
  const issues: string[] = [];
  if (!probe.hasVideo) issues.push("No video stream was found.");
  if (probe.durationSeconds < 0.8) issues.push("The generated clip is shorter than 0.8 seconds.");
  if ((probe.width ?? 0) < 480 || (probe.height ?? 0) < 270) issues.push("The generated clip is below the 480×270 minimum generation size.");
  if ((probe.fps ?? 0) < 12) issues.push("The generated clip frame rate is below 12 FPS.");

  let values: number[] = [];
  if (probe.hasVideo) {
    const result = await runCommand(ffmpegCommand(), [
      "-hide_banner", "-nostats", "-i", probe.source,
      "-vf", "fps=2,scale=320:-2:flags=fast_bilinear,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YDIF",
      "-an", "-f", "null", "-",
    ], { timeoutMs: 5 * 60_000 });
    if (result.code !== 0) {
      throw new AgentDemoError("MOTION_ANALYSIS_FAILED", result.stderr.trim().split("\n").slice(-18).join("\n") || `Could not analyze motion in ${probe.source}.`);
    }
    values = [...result.stderr.matchAll(/lavfi\.signalstats\.YDIF=([0-9]+(?:\.[0-9]+)?)/g)]
      .map((match) => Number(match[1]))
      .filter(Number.isFinite)
      .slice(1);
  }
  const average = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
  const median = percentile(values, 0.5);
  const activeRatio = values.length ? values.filter((item) => item >= 0.35).length / values.length : 0;
  const high = percentile(values, 0.95);
  if (values.length < 2) issues.push("Too few temporal samples were available to verify motion.");
  else if (average < 0.25 || activeRatio < 0.2) issues.push("The clip is effectively frozen; real moving video was requested.");
  if (values.length >= 6 && median < 0.15 && high > 3 && activeRatio < 0.35) {
    issues.push("Motion appears as isolated frame jumps rather than continuous animation.");
  }
  return {
    source: probe.source,
    passed: issues.length === 0,
    durationSeconds: probe.durationSeconds,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    samples: values.length,
    averageFrameDifference: Number(average.toFixed(4)),
    medianFrameDifference: Number(median.toFixed(4)),
    activeFrameRatio: Number(activeRatio.toFixed(4)),
    issues,
  };
}

export async function requireMovingVideo(filePath: string): Promise<MotionQualityReport> {
  const report = await inspectMotionQuality(filePath);
  if (!report.passed) {
    throw new AgentDemoError(
      "GENERATED_VIDEO_QUALITY_FAILED",
      `Generated video failed the motion gate: ${report.issues.join(" ")} (${report.source})`,
    );
  }
  return report;
}
