import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { appendLogoReferenceFiles, loadJob } from "@/lib/jobs-store";
import { getJobDir } from "@/lib/paths";

export const runtime = "nodejs";

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "logo.png";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const jobId = String(formData.get("jobId") ?? "").trim();
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "jobId が必要です。" }, { status: 400 });
    }

    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File && item.size > 0);

    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "ロゴ画像を選択してください。" }, { status: 400 });
    }

    const job = loadJob(jobId);
    const jobDir = getJobDir(job.jobId);
    const refsDir = path.join(jobDir, "source", "logo-references");
    fs.mkdirSync(refsDir, { recursive: true });

    const savedFiles: string[] = [];

    for (const [index, file] of files.entries()) {
      const ext = path.extname(file.name || "").toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json(
          { ok: false, error: "ロゴ画像は png/jpg/jpeg/webp のみ対応です。" },
          { status: 400 },
        );
      }

      const safeName = sanitizeFileName(file.name);
      const savedName = `${Date.now()}_${index}_${safeName}`;
      const relativePath = path.join("source", "logo-references", savedName).replaceAll("\\", "/");
      const absolutePath = path.join(jobDir, relativePath);

      const bytes = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(absolutePath, bytes);
      savedFiles.push(relativePath);
    }

    const updated = appendLogoReferenceFiles(job.jobId, savedFiles);
    const logoReferenceFiles = updated.logoReferenceFiles ?? [];

    return NextResponse.json({
      ok: true,
      logoReferenceFiles,
      logoReferenceUrls: logoReferenceFiles.map((file) => ({
        file,
        url: `/api/jobs/${job.jobId}/asset?file=${encodeURIComponent(file)}`,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ロゴ画像アップロードに失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
