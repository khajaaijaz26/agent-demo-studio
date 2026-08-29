import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import type { CreatorVoiceConsent } from "../creator/types.js";

export interface LocalVoiceCloneOptions {
  referencePath: string;
  consent: CreatorVoiceConsent;
  endpoint?: string;
  voice?: string;
  rate?: number;
  language?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface VoiceCloneResponse {
  outputPath?: string;
  audioBase64?: string;
  format?: string;
}

function localEndpoint(value?: string): string {
  const raw = value || process.env.AGENT_DEMO_VOICE_CLONE_URL;
  if (!raw) throw new Error("A local voice-clone adapter is not configured. Set AGENT_DEMO_VOICE_CLONE_URL to its loopback endpoint.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The local voice-clone endpoint is invalid.");
  }
  if (!(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase()))) {
    throw new Error("Voice cloning is restricted to a loopback-only local adapter.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The voice-clone endpoint must use HTTP or HTTPS.");
  if (url.username || url.password || url.hash) throw new Error("The voice-clone endpoint cannot contain credentials or a fragment.");
  return url.toString();
}

function validateConsent(consent: CreatorVoiceConsent): void {
  if (!consent.confirmed || !consent.speakerName?.trim()) {
    throw new Error("Voice cloning requires a named speaker and an explicit authorization confirming that the speaker approved this use.");
  }
}

/**
 * Calls a loopback adapter around a locally installed XTTS, F5-TTS, OpenVoice,
 * or equivalent engine. The tiny protocol is documented in docs/LOCAL-AI.md.
 */
export async function generateLocalClonedSpeech(text: string, outputPath: string, options: LocalVoiceCloneOptions): Promise<string> {
  validateConsent(options.consent);
  if (!text.trim()) throw new Error("Voice-clone narration cannot be empty.");
  const referencePath = path.resolve(options.referencePath);
  await access(referencePath, constants.R_OK);
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  const endpoint = localEndpoint(options.endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10 * 60_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        text,
        outputPath: path.resolve(outputPath),
        referenceAudioPath: referencePath,
        speakerName: options.consent.speakerName.trim(),
        consentScope: options.consent.scope?.trim() || "this video project",
        voice: options.voice,
        rate: options.rate,
        language: options.language ?? "en",
      }),
    });
    if (!response.ok) throw new Error(`Local voice-clone adapter returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.startsWith("audio/")) {
      await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
      return outputPath;
    }
    const payload = await response.json() as VoiceCloneResponse;
    if (payload.audioBase64) {
      await writeFile(outputPath, Buffer.from(payload.audioBase64, "base64"));
      return outputPath;
    }
    const resolvedOutput = path.resolve(payload.outputPath || outputPath);
    if (resolvedOutput !== path.resolve(outputPath)) throw new Error("The local voice-clone adapter returned a path outside the requested output file.");
    await access(resolvedOutput, constants.R_OK);
    return resolvedOutput;
  } finally {
    clearTimeout(timer);
  }
}
