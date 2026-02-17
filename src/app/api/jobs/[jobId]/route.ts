import { NextResponse } from "next/server";
import { loadJob } from "@/lib/jobs-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const job = loadJob(jobId);
    const designReferenceFiles = job.designReferenceFiles ?? [];

    return NextResponse.json({
      ...job,
      slides: job.slides.map((slide) => ({
        ...slide,
        sourceImageUrl: `/api/jobs/${jobId}/asset?file=${encodeURIComponent(
          `source/slides/${slide.sourceImageFile}`,
        )}`,
      })),
      designReferenceFiles,
      designReferenceUrls: designReferenceFiles.map((file) => ({
        file,
        url: `/api/jobs/${jobId}/asset?file=${encodeURIComponent(file)}`,
      })),
      runs: job.runs.map((run) => ({
        ...run,
        results: run.results.map((result) => ({
          ...result,
          imageUrl:
            result.status === "success"
              ? `/api/jobs/${jobId}/asset?file=${encodeURIComponent(result.outputImageFile)}`
              : null,
        })),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ジョブ取得に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
}
