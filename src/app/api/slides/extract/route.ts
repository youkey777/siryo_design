import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createJobId } from "@/lib/paths";
import { initJobStorage, saveJob } from "@/lib/jobs-store";
import { extractSlidesData } from "@/lib/pptx";
import type { JobRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "PPT/PPTXファイルが必要です。" }, { status: 400 });
    }

    const ext = path.extname(file.name || "").toLowerCase();
    if (!ext || (ext !== ".ppt" && ext !== ".pptx")) {
      return NextResponse.json(
        { ok: false, error: "拡張子は .ppt または .pptx のみ対応です。" },
        { status: 400 },
      );
    }

    const jobId = createJobId();
    const storage = initJobStorage(jobId);

    const sourcePptFile = `source/input${ext}`;
    const sourcePptPath = path.join(storage.jobDir, sourcePptFile);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(sourcePptPath, buffer);

    const slidesDir = path.join(storage.sourceDir, "slides");
    fs.mkdirSync(slidesDir, { recursive: true });

    const extractedJsonPath = path.join(storage.sourceDir, "extracted.json");
    const extracted = extractSlidesData({
      sourcePptPath,
      slidesDir,
      extractedJsonPath,
      scriptDir: path.join(process.cwd(), "scripts"),
    });

    const memoDecisions: Record<string, boolean> = {};
    for (const slide of extracted.slides) {
      for (const candidate of slide.memoCandidates) {
        memoDecisions[candidate.id] = candidate.excludedByDefault;
      }
    }

    const job: JobRecord = {
      jobId,
      sourcePptFile,
      createdAt: new Date().toISOString(),
      slideCount: extracted.slideCount,
      slides: extracted.slides,
      memoDecisions,
      designReferenceFiles: [],
      runs: [],
    };

    saveJob(job);

    return NextResponse.json({
      jobId,
      slideCount: job.slideCount,
      slides: job.slides.map((slide) => ({
        ...slide,
        sourceImageUrl: `/api/jobs/${jobId}/asset?file=${encodeURIComponent(
          path.join("source", "slides", slide.sourceImageFile).replaceAll("\\", "/"),
        )}`,
      })),
      memoDecisions,
      designReferenceFiles: [],
      designReferenceUrls: [],
      runs: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "資料読込に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
