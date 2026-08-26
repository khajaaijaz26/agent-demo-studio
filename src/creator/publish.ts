import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AgentDemoError } from "../errors.js";
import { probeMediaInfo } from "./media.js";
import type { CreatorRenderedOutput } from "./types.js";

export interface PublishMetadata {
  title: string;
  description?: string;
  tags?: string[];
}

export interface YouTubePublishOptions {
  accessToken: string;
  confirmPublish: true;
  privacyStatus?: "private" | "unlisted" | "public";
  notifySubscribers?: boolean;
  categoryId?: string;
  madeForKids?: boolean;
  containsSyntheticMedia?: boolean;
  chunkSizeBytes?: number;
  uploadThumbnail?: boolean;
  uploadCaptions?: boolean;
  captionLanguage?: string;
  captionName?: string;
  captionDraft?: boolean;
  failOnSupplementalError?: boolean;
}

export interface TikTokPublishOptions {
  accessToken: string;
  confirmPublish: true;
  privacyLevel: string;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  isAigc?: boolean;
  brandOrganic?: boolean;
  coverTimestampMs?: number;
  chunkSizeBytes?: number;
}

export interface InstagramPublishOptions {
  accessToken: string;
  instagramAccountId: string;
  publicVideoUrl: string;
  confirmPublish: true;
  apiVersion?: string;
  shareToFeed?: boolean;
  coverUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string | number }; message?: string };
    return parsed.error?.message ?? parsed.message ?? body;
  } catch {
    return body || `${response.status} ${response.statusText}`;
  }
}

async function checkedJson<T>(response: Response, code: string): Promise<T> {
  if (!response.ok) throw new AgentDemoError(code, await responseError(response));
  return await response.json() as T;
}

async function uploadChunks(url: string, filePath: string, headers: Record<string, string>, requestedChunkSize: number, mergeTrailingBytes = false): Promise<Response> {
  const info = await stat(filePath);
  const chunkSize = Math.max(5 * 1024 * 1024, Math.min(64 * 1024 * 1024, requestedChunkSize));
  const chunkCount = mergeTrailingBytes && info.size > chunkSize ? Math.floor(info.size / chunkSize) : Math.ceil(info.size / chunkSize);
  const handle = await open(filePath, "r");
  let finalResponse: Response | undefined;
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * chunkSize;
      const endExclusive = index === chunkCount - 1 ? info.size : Math.min(info.size, start + chunkSize);
      const buffer = Buffer.allocUnsafe(endExclusive - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      const body = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      finalResponse = await fetch(url, {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Length": String(body.length),
          "Content-Range": `bytes ${start}-${start + body.length - 1}/${info.size}`,
        },
        body,
      });
      if (!finalResponse.ok && finalResponse.status !== 308) throw new AgentDemoError("CHUNK_UPLOAD_FAILED", await responseError(finalResponse));
    }
  } finally {
    await handle.close();
  }
  if (!finalResponse) throw new AgentDemoError("EMPTY_UPLOAD", `Cannot upload an empty file: ${filePath}`);
  return finalResponse;
}

async function uploadYouTubeThumbnail(videoId: string, thumbnailPath: string, accessToken: string): Promise<void> {
  const info = await stat(thumbnailPath);
  if (info.size > 2 * 1024 * 1024) throw new AgentDemoError("YOUTUBE_THUMBNAIL_TOO_LARGE", "YouTube custom thumbnails must be 2 MB or smaller.");
  const extension = path.extname(thumbnailPath).toLowerCase();
  const contentType = extension === ".png" ? "image/png" : "image/jpeg";
  const response = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
    body: await readFile(thumbnailPath),
  });
  if (!response.ok) throw new AgentDemoError("YOUTUBE_THUMBNAIL_FAILED", await responseError(response));
}

async function uploadYouTubeCaptions(videoId: string, captionsPath: string, accessToken: string, options: YouTubePublishOptions): Promise<string | undefined> {
  const info = await stat(captionsPath);
  if (info.size > 100 * 1024 * 1024) throw new AgentDemoError("YOUTUBE_CAPTIONS_TOO_LARGE", "YouTube caption tracks must be 100 MB or smaller.");
  const contentType = path.extname(captionsPath).toLowerCase() === ".vtt" ? "text/vtt" : "application/x-subrip";
  const initiate = await fetch("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=resumable&part=snippet", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(info.size),
      "X-Upload-Content-Type": contentType,
    },
    body: JSON.stringify({ snippet: { videoId, language: options.captionLanguage ?? "en", name: options.captionName ?? "Creator captions", isDraft: options.captionDraft ?? false } }),
  });
  if (!initiate.ok) throw new AgentDemoError("YOUTUBE_CAPTIONS_INIT_FAILED", await responseError(initiate));
  const uploadUrl = initiate.headers.get("location");
  if (!uploadUrl) throw new AgentDemoError("YOUTUBE_CAPTIONS_URL_MISSING", "YouTube did not return a resumable caption upload URL.");
  const uploaded = await uploadChunks(uploadUrl, captionsPath, { "Content-Type": contentType }, options.chunkSizeBytes ?? 8 * 1024 * 1024);
  const response = await checkedJson<{ id?: string }>(uploaded, "YOUTUBE_CAPTIONS_FAILED");
  return response.id;
}

function publishErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function tiktokChunkPlan(fileSizeBytes: number, requestedChunkSize = 10 * 1024 * 1024): { chunkSize: number; totalChunks: number } {
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0) throw new AgentDemoError("EMPTY_UPLOAD", "TikTok upload size must be a positive safe integer.");
  if (!Number.isFinite(requestedChunkSize) || requestedChunkSize <= 0) throw new AgentDemoError("TIKTOK_CHUNK_SIZE_INVALID", "TikTok chunk size must be a positive number.");
  const preferredChunkSize = Math.max(5 * 1024 * 1024, Math.min(64 * 1024 * 1024, requestedChunkSize));
  const chunkSize = Math.min(fileSizeBytes, preferredChunkSize);
  const totalChunks = fileSizeBytes <= chunkSize ? 1 : Math.floor(fileSizeBytes / chunkSize);
  if (totalChunks > 1_000) throw new AgentDemoError("TIKTOK_TOO_MANY_CHUNKS", "TikTok accepts at most 1,000 sequential upload chunks. Increase the chunk size or use a smaller export.");
  return { chunkSize, totalChunks };
}

export async function publishToYouTube(output: CreatorRenderedOutput, metadata: PublishMetadata, options: YouTubePublishOptions): Promise<{ platform: "youtube"; videoId: string; url: string; thumbnailUploaded: boolean; captionsTrackId?: string; warnings: string[]; response: unknown }> {
  if (!options.confirmPublish) throw new AgentDemoError("PUBLISH_CONFIRMATION_REQUIRED", "Set confirmPublish to true after reviewing the export and metadata.");
  const privacyStatus = options.privacyStatus ?? "private";
  if (!["private", "unlisted", "public"].includes(privacyStatus)) throw new AgentDemoError("YOUTUBE_PRIVACY_INVALID", "privacyStatus must be private, unlisted, or public.");
  const info = await stat(output.videoPath);
  if (!info.size) throw new AgentDemoError("EMPTY_UPLOAD", `Cannot upload an empty file: ${output.videoPath}`);
  if (info.size > 256 * 1024 * 1024 * 1024) throw new AgentDemoError("YOUTUBE_FILE_TOO_LARGE", "YouTube video uploads must be 256 GB or smaller.");
  const status: Record<string, unknown> = { privacyStatus };
  if (options.madeForKids !== undefined) status.selfDeclaredMadeForKids = options.madeForKids;
  if (options.containsSyntheticMedia !== undefined) status.containsSyntheticMedia = options.containsSyntheticMedia;
  const initiate = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${options.notifySubscribers ?? false}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(info.size),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: { title: metadata.title, description: metadata.description ?? "", tags: metadata.tags ?? [], categoryId: options.categoryId ?? "22" },
      status,
    }),
  });
  if (!initiate.ok) throw new AgentDemoError("YOUTUBE_UPLOAD_INIT_FAILED", await responseError(initiate));
  const uploadUrl = initiate.headers.get("location");
  if (!uploadUrl) throw new AgentDemoError("YOUTUBE_UPLOAD_URL_MISSING", "YouTube did not return a resumable upload URL.");
  const uploaded = await uploadChunks(uploadUrl, output.videoPath, { "Content-Type": "video/mp4" }, options.chunkSizeBytes ?? 16 * 1024 * 1024);
  const response = await checkedJson<{ id?: string }>(uploaded, "YOUTUBE_UPLOAD_FAILED");
  if (!response.id) throw new AgentDemoError("YOUTUBE_VIDEO_ID_MISSING", "YouTube accepted the upload but returned no video id.");
  const warnings: string[] = [];
  let thumbnailUploaded = false;
  let captionsTrackId: string | undefined;
  if (options.uploadThumbnail !== false) {
    try {
      await uploadYouTubeThumbnail(response.id, output.thumbnailPath, options.accessToken);
      thumbnailUploaded = true;
    } catch (error) {
      if (options.failOnSupplementalError) throw error;
      warnings.push(`Video uploaded, but its thumbnail was not set: ${publishErrorMessage(error)}`);
    }
  }
  if (output.captionsPath && options.uploadCaptions !== false) {
    try {
      captionsTrackId = await uploadYouTubeCaptions(response.id, output.captionsPath, options.accessToken, options);
    } catch (error) {
      if (options.failOnSupplementalError) throw error;
      warnings.push(`Video uploaded, but its caption track was not added: ${publishErrorMessage(error)}`);
    }
  }
  return { platform: "youtube", videoId: response.id, url: `https://youtu.be/${response.id}`, thumbnailUploaded, captionsTrackId, warnings, response };
}

export async function publishToTikTok(output: CreatorRenderedOutput, metadata: PublishMetadata, options: TikTokPublishOptions): Promise<{ platform: "tiktok"; publishId: string; statusEndpoint: string; creator: unknown }> {
  if (!options.confirmPublish) throw new AgentDemoError("PUBLISH_CONFIRMATION_REQUIRED", "Set confirmPublish to true after reviewing the export and metadata.");
  const authorization = { Authorization: `Bearer ${options.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
  const creatorResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: authorization });
  const creator = await checkedJson<{ data?: { privacy_level_options?: string[]; max_video_post_duration_sec?: number } }>(creatorResponse, "TIKTOK_CREATOR_INFO_FAILED");
  const allowedPrivacy = creator.data?.privacy_level_options ?? [];
  if (allowedPrivacy.length && !allowedPrivacy.includes(options.privacyLevel)) throw new AgentDemoError("TIKTOK_PRIVACY_INVALID", `privacyLevel must be one of: ${allowedPrivacy.join(", ")}`);
  const probe = await probeMediaInfo(output.videoPath);
  if (creator.data?.max_video_post_duration_sec && probe.durationSeconds > creator.data.max_video_post_duration_sec) throw new AgentDemoError("TIKTOK_DURATION_EXCEEDED", `The creator's current maximum is ${creator.data.max_video_post_duration_sec}s; this video is ${probe.durationSeconds.toFixed(1)}s.`);
  const coverTimestampMs = options.coverTimestampMs ?? Math.min(1_000, Math.max(0, Math.floor(probe.durationSeconds * 1_000)));
  if (!Number.isFinite(coverTimestampMs) || coverTimestampMs < 0 || coverTimestampMs > probe.durationSeconds * 1_000) throw new AgentDemoError("TIKTOK_COVER_INVALID", `coverTimestampMs must be between 0 and ${Math.floor(probe.durationSeconds * 1_000)} for this export.`);
  const file = await stat(output.videoPath);
  const { chunkSize, totalChunks } = tiktokChunkPlan(file.size, options.chunkSizeBytes);
  const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: authorization,
    body: JSON.stringify({
      post_info: {
        title: [metadata.title, metadata.description, ...(metadata.tags ?? []).map((tag) => tag.startsWith("#") ? tag : `#${tag}`)].filter(Boolean).join(" ").slice(0, 2200),
        privacy_level: options.privacyLevel,
        disable_comment: options.disableComment ?? false,
        disable_duet: options.disableDuet ?? false,
        disable_stitch: options.disableStitch ?? false,
        video_cover_timestamp_ms: Math.floor(coverTimestampMs),
        ...(options.isAigc === undefined ? {} : { is_aigc: options.isAigc }),
        ...(options.brandOrganic === undefined ? {} : { brand_organic_toggle: options.brandOrganic }),
      },
      source_info: { source: "FILE_UPLOAD", video_size: file.size, chunk_size: chunkSize, total_chunk_count: totalChunks },
    }),
  });
  const initialized = await checkedJson<{ data?: { publish_id?: string; upload_url?: string } }>(initResponse, "TIKTOK_UPLOAD_INIT_FAILED");
  const publishId = initialized.data?.publish_id;
  const uploadUrl = initialized.data?.upload_url;
  if (!publishId || !uploadUrl) throw new AgentDemoError("TIKTOK_UPLOAD_URL_MISSING", "TikTok did not return publish_id and upload_url.");
  await uploadChunks(uploadUrl, output.videoPath, { "Content-Type": "video/mp4" }, chunkSize, true);
  return { platform: "tiktok", publishId, statusEndpoint: "https://open.tiktokapis.com/v2/post/publish/status/fetch/", creator };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function publishToInstagram(output: CreatorRenderedOutput, metadata: PublishMetadata, options: InstagramPublishOptions): Promise<{ platform: "instagram"; mediaId: string; containerId: string; response: unknown }> {
  if (!options.confirmPublish) throw new AgentDemoError("PUBLISH_CONFIRMATION_REQUIRED", "Set confirmPublish to true after reviewing the export and metadata.");
  if (!/^https:\/\//i.test(options.publicVideoUrl)) throw new AgentDemoError("PUBLIC_VIDEO_URL_REQUIRED", "Instagram publishing requires an HTTPS URL that Meta can fetch.");
  const version = options.apiVersion ?? process.env.AGENT_DEMO_META_API_VERSION ?? "v23.0";
  const baseUrl = `https://graph.facebook.com/${version}`;
  const createBody = new URLSearchParams({
    access_token: options.accessToken,
    media_type: "REELS",
    video_url: options.publicVideoUrl,
    caption: [metadata.title, metadata.description, ...(metadata.tags ?? []).map((tag) => tag.startsWith("#") ? tag : `#${tag}`)].filter(Boolean).join("\n\n"),
    share_to_feed: String(options.shareToFeed ?? true),
  });
  if (options.coverUrl) createBody.set("cover_url", options.coverUrl);
  const createResponse = await fetch(`${baseUrl}/${encodeURIComponent(options.instagramAccountId)}/media`, { method: "POST", body: createBody });
  const created = await checkedJson<{ id?: string }>(createResponse, "INSTAGRAM_CONTAINER_FAILED");
  if (!created.id) throw new AgentDemoError("INSTAGRAM_CONTAINER_ID_MISSING", "Instagram returned no media container id.");
  const timeoutAt = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  let ready = false;
  while (Date.now() < timeoutAt) {
    const statusResponse = await fetch(`${baseUrl}/${encodeURIComponent(created.id)}?fields=status_code,status&access_token=${encodeURIComponent(options.accessToken)}`);
    const status = await checkedJson<{ status_code?: string; status?: string }>(statusResponse, "INSTAGRAM_STATUS_FAILED");
    if (status.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (["ERROR", "EXPIRED"].includes(status.status_code ?? "")) throw new AgentDemoError("INSTAGRAM_PROCESSING_FAILED", status.status ?? `Container status: ${status.status_code}`);
    await delay(Math.max(1_000, options.pollIntervalMs ?? 5_000));
  }
  if (!ready) throw new AgentDemoError("INSTAGRAM_PROCESSING_TIMEOUT", "Instagram did not finish processing the Reel before the timeout.");
  const publishResponse = await fetch(`${baseUrl}/${encodeURIComponent(options.instagramAccountId)}/media_publish`, { method: "POST", body: new URLSearchParams({ access_token: options.accessToken, creation_id: created.id }) });
  const published = await checkedJson<{ id?: string }>(publishResponse, "INSTAGRAM_PUBLISH_FAILED");
  if (!published.id) throw new AgentDemoError("INSTAGRAM_MEDIA_ID_MISSING", "Instagram returned no published media id.");
  return { platform: "instagram", mediaId: published.id, containerId: created.id, response: published };
}

export function publishMetadataFromOutput(output: CreatorRenderedOutput, title: string, description = "", tags: string[] = []): PublishMetadata {
  return { title: title || path.parse(output.videoPath).name, description, tags };
}
