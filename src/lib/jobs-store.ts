import fs from "node:fs";
import path from "node:path";
import { ensureDir, getJobDir, JOBS_DIR } from "@/lib/paths";
import type { GenerationRun, JobRecord } from "@/lib/types";

export function initJobStorage(jobId: string): {
  jobDir: string;
  sourceDir: string;
  promptsDir: string;
  outputsDir: string;
  responsesDir: string;
  metadataDir: string;
} {
  ensureDir(JOBS_DIR);
  const jobDir = getJobDir(jobId);
  const sourceDir = path.join(jobDir, "source");
  const promptsDir = path.join(jobDir, "prompts");
  const outputsDir = path.join(jobDir, "outputs");
  const responsesDir = path.join(jobDir, "responses");
  const metadataDir = path.join(jobDir, "metadata");

  [jobDir, sourceDir, promptsDir, outputsDir, responsesDir, metadataDir].forEach(ensureDir);

  return { jobDir, sourceDir, promptsDir, outputsDir, responsesDir, metadataDir };
}

export function getJobJsonPath(jobId: string): string {
  return path.join(getJobDir(jobId), "metadata", "job.json");
}

export function saveJob(job: JobRecord): void {
  const jsonPath = getJobJsonPath(job.jobId);
  ensureDir(path.dirname(jsonPath));
  fs.writeFileSync(jsonPath, JSON.stringify(job, null, 2), "utf8");
}

export function loadJob(jobId: string): JobRecord {
  const jsonPath = getJobJsonPath(jobId);
  if (!fs.existsSync(jsonPath)) {
    throw new Error("ジョブが見つかりません。");
  }

  const job = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as JobRecord;
  return {
    ...job,
    runs: Array.isArray(job.runs) ? job.runs : [],
    designReferenceFiles: Array.isArray(job.designReferenceFiles) ? job.designReferenceFiles : [],
  };
}

export function appendRun(jobId: string, run: GenerationRun): JobRecord {
  const job = loadJob(jobId);
  job.runs.push(run);
  saveJob(job);
  return job;
}

export function nextVersionForPage(job: JobRecord, page: number): number {
  const versions = job.runs.flatMap((run) =>
    run.results.filter((result) => result.page === page).map((result) => result.version),
  );
  return versions.length ? Math.max(...versions) + 1 : 1;
}

export function updateMemoDecisions(jobId: string, decisions: Record<string, boolean>): JobRecord {
  const job = loadJob(jobId);
  job.memoDecisions = {
    ...job.memoDecisions,
    ...decisions,
  };
  saveJob(job);
  return job;
}

export function appendDesignReferenceFiles(jobId: string, files: string[]): JobRecord {
  const job = loadJob(jobId);
  const merged = new Set([...(job.designReferenceFiles ?? []), ...files]);
  job.designReferenceFiles = Array.from(merged);
  saveJob(job);
  return job;
}
