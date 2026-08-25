import { randomUUID } from "node:crypto";
import { errorMessage } from "./errors.js";
import type { JobRecord } from "./types.js";

export class JobManager {
  private readonly jobs = new Map<string, JobRecord>();

  start<T>(
    type: string,
    task: (report: (progress: number, message: string) => void) => Promise<T>,
  ): JobRecord<T> {
    const now = new Date().toISOString();
    const job: JobRecord<T> = {
      id: randomUUID(),
      type,
      state: "queued",
      progress: 0,
      message: "Queued",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);

    queueMicrotask(async () => {
      job.state = "running";
      job.message = "Running";
      job.updatedAt = new Date().toISOString();
      try {
        job.result = await task((progress, message) => {
          job.progress = Math.max(0, Math.min(100, progress));
          job.message = message;
          job.updatedAt = new Date().toISOString();
        });
        job.state = "completed";
        job.progress = 100;
        job.message = "Completed";
      } catch (error) {
        job.state = "failed";
        job.error = errorMessage(error);
        job.message = job.error;
      }
      job.updatedAt = new Date().toISOString();
    });

    return job;
  }

  get<T = unknown>(jobId: string): JobRecord<T> | undefined {
    return this.jobs.get(jobId) as JobRecord<T> | undefined;
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const jobs = new JobManager();
