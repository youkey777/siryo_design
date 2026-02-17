import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadJob, updateMemoDecisions } from "@/lib/jobs-store";
import { parsePageSelection } from "@/lib/page-selection";
import { buildPromptForSlide } from "@/lib/prompts";

export const runtime = "nodejs";

const schema = z.object({
  jobId: z.string().min(1),
  pageSelection: z.string().min(1),
  designPrompt: z.string().min(1),
  memoDecisions: z.record(z.string(), z.boolean()).optional(),
});

const GEMINI_URL = "https://gemini.google.com/app";
const GEMINI_LOGIN_URL =
  "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp";

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    const job = body.memoDecisions
      ? updateMemoDecisions(body.jobId, body.memoDecisions)
      : loadJob(body.jobId);
    const pages = parsePageSelection(body.pageSelection, job.slideCount);

    const perPagePromptDrafts = pages.map((page) => {
      const slide = job.slides.find((row) => row.page === page);
      if (!slide) {
        throw new Error(`ページ ${page} が見つかりません。`);
      }

      const prompt = buildPromptForSlide({
        slide,
        designPrompt: body.designPrompt,
        memoDecisions: job.memoDecisions,
        manualMemoExclusions: job.manualMemoExclusions,
        logoReferenceCount: (job.logoReferenceFiles ?? []).length,
      });

      return {
        page,
        prompt,
        sourceImageUrl: `/api/jobs/${job.jobId}/asset?file=${encodeURIComponent(
          path.join("source", "slides", slide.sourceImageFile).replaceAll("\\", "/"),
        )}`,
      };
    });

    return NextResponse.json({
      geminiUrl: GEMINI_URL,
      geminiLoginUrl: GEMINI_LOGIN_URL,
      previewInstructions: [
        "1. Geminiを開くと、Googleログイン画面が表示されます。",
        "2. ログイン後、Geminiで対象のPowerPointを添付してください。",
        "3. コピー済みのページ別プロンプトを貼り付けて実行してください。",
        "4. 生成結果を見て、本生成または再生成に進んでください。",
      ],
      perPagePromptDrafts,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "デザイン確認プロンプトの作成に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
