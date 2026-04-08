import { randomUUID } from "crypto";
import { getDb } from "../store/db.js";
import { createLogger } from "../observability/logger.js";
import { runInternalMessage } from "../copilot/orchestrator.js";

const log = createLogger("job-runner");

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface DurableJob {
  id: string;
  kind: string;
  prompt: string;
  step_count: number;
  status: JobStatus;
  current_step: number;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

const activeRuns = new Map<string, Promise<void>>();

function now(): number {
  return Date.now();
}

function logEvent(jobId: string, eventType: string, payload: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO job_events (id, job_id, event_type, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), jobId, eventType, JSON.stringify(payload), now());
}

function getJob(jobId: string): DurableJob | undefined {
  const db = getDb();
  return db.prepare(
    `SELECT id, kind, prompt, step_count, status, current_step, result, error, created_at, updated_at, started_at, finished_at
     FROM jobs WHERE id = ?`
  ).get(jobId) as DurableJob | undefined;
}

function getCompletedOutputs(jobId: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT output FROM job_steps
     WHERE job_id = ? AND status = 'completed'
     ORDER BY step_index ASC`
  ).all(jobId) as Array<{ output: string | null }>;
  return rows.map((row) => row.output).filter((output): output is string => !!output);
}

function buildStepPrompt(job: DurableJob, stepIndex: number, priorOutputs: string[]): string {
  const previous = priorOutputs.length === 0
    ? "No prior completed steps."
    : priorOutputs.map((output, index) => `Step ${index + 1} output:\n${output}`).join("\n\n");

  return [
    `Durable marathon job ${job.id}`,
    `Primary prompt: ${job.prompt}`,
    `Current step: ${stepIndex}/${job.step_count}`,
    "Continue the work from the previous steps.",
    "Return concrete progress for this step and what should happen next.",
    "",
    previous,
  ].join("\n");
}

export function createJob(prompt: string, stepCount: number, kind = "marathon"): DurableJob {
  const db = getDb();
  const ts = now();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO jobs (id, kind, prompt, step_count, status, current_step, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).run(id, kind, prompt, stepCount, ts, ts);

  const insertStep = db.prepare(
    `INSERT INTO job_steps (id, job_id, step_index, prompt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  );

  for (let step = 1; step <= stepCount; step++) {
    insertStep.run(randomUUID(), id, step, prompt, ts, ts);
  }

  logEvent(id, "job_created", { stepCount, kind });
  return getJob(id)!;
}

export async function runJob(jobId: string): Promise<void> {
  if (activeRuns.has(jobId)) return activeRuns.get(jobId)!;

  const promise = (async () => {
    const db = getDb();
    let job = getJob(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);
    if (job.status === "completed" || job.status === "cancelled") return;

    const startTs = now();
    db.prepare(
      `UPDATE jobs
       SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?, error = NULL
       WHERE id = ?`
    ).run(startTs, startTs, jobId);
    logEvent(jobId, "job_started", { resumed: job.current_step > 0 });

    const staleRunning = db.prepare(
      `UPDATE job_steps
       SET status = 'pending', started_at = NULL, updated_at = ?
       WHERE job_id = ? AND status = 'running'`
    );
    staleRunning.run(startTs, jobId);

    const nextSteps = db.prepare(
      `SELECT id, step_index FROM job_steps
       WHERE job_id = ? AND status IN ('pending', 'failed')
       ORDER BY step_index ASC`
    ).all(jobId) as Array<{ id: string; step_index: number }>;

    for (const step of nextSteps) {
      const stepStartedAt = now();
      db.prepare(
        `UPDATE jobs SET current_step = ?, updated_at = ? WHERE id = ?`
      ).run(step.step_index - 1, stepStartedAt, jobId);
      db.prepare(
        `UPDATE job_steps
         SET status = 'running', started_at = ?, updated_at = ?, error = NULL
         WHERE id = ?`
      ).run(stepStartedAt, stepStartedAt, step.id);
      logEvent(jobId, "step_started", { step: step.step_index });

      job = getJob(jobId)!;
      const prompt = buildStepPrompt(job, step.step_index, getCompletedOutputs(jobId));

      try {
        const output = await runInternalMessage(prompt);
        const finishedAt = now();
        db.prepare(
          `UPDATE job_steps
           SET status = 'completed', output = ?, finished_at = ?, updated_at = ?
           WHERE id = ?`
        ).run(output, finishedAt, finishedAt, step.id);
        db.prepare(
          `UPDATE jobs
           SET current_step = ?, updated_at = ?
           WHERE id = ?`
        ).run(step.step_index, finishedAt, jobId);
        logEvent(jobId, "step_completed", { step: step.step_index, outputPreview: output.slice(0, 200) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failedAt = now();
        db.prepare(
          `UPDATE job_steps
           SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
           WHERE id = ?`
        ).run(message, failedAt, failedAt, step.id);
        db.prepare(
          `UPDATE jobs
           SET status = 'failed', error = ?, updated_at = ?, finished_at = ?
           WHERE id = ?`
        ).run(message, failedAt, failedAt, jobId);
        logEvent(jobId, "job_failed", { step: step.step_index, error: message });
        throw err;
      }
    }

    const finalOutput = getCompletedOutputs(jobId).at(-1) ?? "";
    const completedAt = now();
    db.prepare(
      `UPDATE jobs
       SET status = 'completed', current_step = step_count, result = ?, updated_at = ?, finished_at = ?
       WHERE id = ?`
    ).run(finalOutput, completedAt, completedAt, jobId);
    logEvent(jobId, "job_completed", { resultPreview: finalOutput.slice(0, 200) });
    log.info("Job completed", { jobId });
  })().finally(() => {
    activeRuns.delete(jobId);
  });

  activeRuns.set(jobId, promise);
  return promise;
}

export async function resumeJobs(): Promise<void> {
  const db = getDb();
  const resumable = db.prepare(
    `SELECT id FROM jobs WHERE status IN ('pending', 'running') ORDER BY created_at ASC`
  ).all() as Array<{ id: string }>;

  for (const job of resumable) {
    db.prepare(
      `UPDATE jobs SET status = 'pending', updated_at = ? WHERE id = ?`
    ).run(now(), job.id);
    logEvent(job.id, "job_resumed", {});
    void runJob(job.id).catch((err) => {
      log.error("Resumed job failed", { jobId: job.id, err: String(err) });
    });
  }
}
