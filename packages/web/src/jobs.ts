import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import path from "path";
import { runPipeline, buildConfig } from "@viet-dubber/pipeline";
import type { ProgressEvent } from "@viet-dubber/shared";

export type JobStatus = "pending" | "running" | "done" | "error";

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  createdAt: number;
  events: ProgressEvent[];
  outputPath?: string;
  outputFileName?: string;
  error?: string;
}

interface InternalJob extends Job {
  emitter: EventEmitter;
}

const jobs = new Map<string, InternalJob>();

export function listJobs(): Job[] {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ emitter: _emitter, ...rest }) => rest);
}

export function getJob(id: string): Job | undefined {
  const j = jobs.get(id);
  if (!j) return undefined;
  const { emitter: _emitter, ...rest } = j;
  return rest;
}

/** Subscribe SSE: replay past events, then forward new ones. Returns unsubscribe. */
export function subscribeJob(
  id: string,
  onEvent: (event: ProgressEvent) => void,
): (() => void) | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  // Replay
  for (const ev of job.events) onEvent(ev);

  // If already finished, no need to subscribe
  if (job.status === "done" || job.status === "error") {
    return () => {};
  }

  const listener = (ev: ProgressEvent): void => onEvent(ev);
  job.emitter.on("event", listener);
  return () => job.emitter.off("event", listener);
}

/** Create + start a new dub job. Returns job id immediately, pipeline runs async. */
export function createJob(url: string): Job {
  const id = randomUUID();
  const job: InternalJob = {
    id,
    url,
    status: "pending",
    createdAt: Date.now(),
    events: [],
    emitter: new EventEmitter(),
  };
  jobs.set(id, job);

  // Run pipeline async — không await
  void runJob(job);

  const { emitter: _emitter, ...publicView } = job;
  return publicView;
}

async function runJob(job: InternalJob): Promise<void> {
  job.status = "running";

  const onProgress = (event: ProgressEvent): void => {
    job.events.push(event);
    job.emitter.emit("event", event);
  };

  try {
    const config = buildConfig({ url: job.url });
    const result = await runPipeline(config, onProgress);
    job.outputPath = result.outputPath;
    job.outputFileName = path.basename(result.outputPath);
    job.status = "done";
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    job.error = detail;
    job.status = "error";
    const errEvent: ProgressEvent = {
      step: "done",
      status: "error",
      message: detail,
    };
    job.events.push(errEvent);
    job.emitter.emit("event", errEvent);
  } finally {
    job.emitter.emit("end");
  }
}

/** Đăng ký 'end' listener — fire khi job xong hoặc error. */
export function onJobEnd(id: string, cb: () => void): (() => void) | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (job.status === "done" || job.status === "error") {
    cb();
    return () => {};
  }
  job.emitter.once("end", cb);
  return () => job.emitter.off("end", cb);
}
