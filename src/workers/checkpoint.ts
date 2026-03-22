import { getDb } from "../store/db.js";

export async function checkpointTask(opts: {
  task: string;
  cwd: string;
  correlationId: string;
}): Promise<void> {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO worker_checkpoints (task, cwd, correlation_id, correlationId, status)
    VALUES (?, ?, ?, ?, 'running')
  `).run(opts.task, opts.cwd, opts.correlationId, opts.correlationId);
}

export async function getRunningCheckpoints(): Promise<Array<{
  task: string;
  cwd: string;
  correlation_id: string;
  status: string;
}>> {
  const db = getDb();
  return db.prepare(
    "SELECT task, cwd, correlation_id, status FROM worker_checkpoints WHERE status='running'"
  ).all() as Array<{ task: string; cwd: string; correlation_id: string; status: string }>;
}

export async function recoverCheckpoints(opts: {
  onRequeue: (checkpoint: { task: string; cwd: string; correlation_id: string; status: string }) => void;
}): Promise<void> {
  const checkpoints = await getRunningCheckpoints();
  for (const cp of checkpoints) {
    opts.onRequeue(cp);
  }
}

export async function checkpointComplete(correlationId: string): Promise<void> {
  const db = getDb();
  db.prepare(
    "UPDATE worker_checkpoints SET status='completed' WHERE correlation_id=?"
  ).run(correlationId);
}

export { checkpointTask as writeCheckpoint };
