import fs from "node:fs";
import path from "node:path";

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function createJobId(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const stamp = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${date}_${stamp}_${rand}`;
}

export function getJobDir(jobId: string): string {
  return path.join(JOBS_DIR, jobId);
}

export function safeJoin(baseDir: string, target: string): string {
  const resolved = path.resolve(baseDir, target);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base)) {
    throw new Error("不正なパスです。");
  }
  return resolved;
}
