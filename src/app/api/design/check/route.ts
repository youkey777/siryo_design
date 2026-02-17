import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadJob, updateMemoDecisions } from "@/lib/jobs-store";
import { getApiKey } from "@/lib/settings";
import { buildPromptForSlide, getPromptExclusionStats } from "@/lib/prompts";
import { applyLogoLock } from "@/lib/logo-lock";
import { generateImageWithGemini, imageExtensionFromMime } from "@/lib/gemini";
import type { LogoLockInfo } from "@/lib/types";
import { getJobDir } from "@/lib/paths";

export const runtime = "nodejs";

const schema = z.object({
  jobId: z.string().min(1),
  designPrompt: z.string().min(1),
  memoDecisions: z.record(z.string(), z.boolean()).optional(),
});

const IMAGE_MODEL = "gemini-3-pro-image-preview";

function createPreviewRunId(): string {
  const now = new Date();
  return `designcheck_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}_${Math.random().toString(36).slice(2, 6)}`;
}

function fallbackLogoLockInfo(message: string): LogoLockInfo {
  return {
    applied: true,
    logoCount: 0,
    detections: [],
    verificationScores: [],
    verified: false,
    message,
  };
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const apiKey = getApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "APIキーが未設定です。設定画面で登録してください。" },
        { status: 400 },
      );
    }

    const job = body.memoDecisions
      ? updateMemoDecisions(body.jobId, body.memoDecisions)
      : loadJob(body.jobId);

    const targetSlides = [...job.slides].sort((a, b) => a.page - b.page).slice(0, 2);
    if (targetSlides.length === 0) {
      return NextResponse.json(
        { ok: false, error: "対象スライドが見つかりません。" },
        { status: 400 },
      );
    }

    const runId = createPreviewRunId();
    const jobDir = getJobDir(job.jobId);
    const previewDir = path.join(jobDir, "outputs", "design-check");
    const referenceImagePaths = (job.designReferenceFiles ?? []).map((file) => path.join(jobDir, file));
    const logoImagePaths = (job.logoReferenceFiles ?? []).map((file) => path.join(jobDir, file));
    fs.mkdirSync(previewDir, { recursive: true });

    const results: Array<{
      page: number;
      status: "success" | "error";
      imageUrl: string | null;
      promptFile: string;
      outputImageFile: string;
      responseJsonFile: string;
      logoLock?: LogoLockInfo;
      error?: string;
    }> = [];

    for (const slide of targetSlides) {
      const prompt = buildPromptForSlide({
        slide,
        designPrompt: body.designPrompt,
        memoDecisions: job.memoDecisions,
        manualMemoExclusions: job.manualMemoExclusions,
        logoReferenceCount: logoImagePaths.length,
      });

      const stats = getPromptExclusionStats({
        slide,
        memoDecisions: job.memoDecisions,
        manualMemoExclusions: job.manualMemoExclusions,
      });
      console.info(
        `[memo-exclusion] job=${job.jobId} page=${slide.page} auto=${stats.autoExcludedCount} manual=${stats.manualExcludedCount}`,
      );

      const promptFile = path
        .join("prompts", `${runId}_page${String(slide.page).padStart(3, "0")}.txt`)
        .replaceAll("\\", "/");
      const responseJsonFile = path
        .join("responses", `${runId}_page${String(slide.page).padStart(3, "0")}.json`)
        .replaceAll("\\", "/");
      fs.writeFileSync(path.join(jobDir, promptFile), prompt, "utf8");

      try {
        const sourceSlidePath = path.join(jobDir, "source", "slides", slide.sourceImageFile);
        const generated = await generateImageWithGemini({
          apiKey,
          model: IMAGE_MODEL,
          prompt,
          inputImagePath: sourceSlidePath,
          logoImagePaths,
          referenceImagePaths,
          aspectRatio: "16:9",
          imageSize: "2K",
        });

        let outputBytes = generated.imageBytes;
        let ext = imageExtensionFromMime(generated.mimeType);
        let logoLock: LogoLockInfo = {
          applied: false,
          logoCount: 0,
          detections: [],
          verificationScores: [],
          verified: true,
        };

        if (logoImagePaths.length > 0) {
          const lockResult = await applyLogoLock({
            sourceSlidePath,
            generatedImageBytes: generated.imageBytes,
            logoReferencePaths: logoImagePaths,
          });
          if (!lockResult.ok) {
            throw new Error(lockResult.error);
          }
          outputBytes = lockResult.imageBytes;
          ext = "png";
          logoLock = lockResult.metadata;
        }

        const outputImageFile = path
          .join("outputs", "design-check", `${runId}_page${String(slide.page).padStart(3, "0")}.${ext}`)
          .replaceAll("\\", "/");
        fs.writeFileSync(path.join(jobDir, outputImageFile), outputBytes);
        fs.writeFileSync(
          path.join(jobDir, responseJsonFile),
          JSON.stringify(
            {
              geminiResponse: generated.responseJson,
              logoLock,
            },
            null,
            2,
          ),
          "utf8",
        );

        results.push({
          page: slide.page,
          status: "success",
          imageUrl: `/api/jobs/${job.jobId}/asset?file=${encodeURIComponent(outputImageFile)}`,
          promptFile,
          outputImageFile,
          responseJsonFile,
          logoLock,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "デザイン確認生成に失敗しました。";
        results.push({
          page: slide.page,
          status: "error",
          imageUrl: null,
          promptFile,
          outputImageFile: "",
          responseJsonFile,
          logoLock: fallbackLogoLockInfo(message),
          error: message,
        });
      }
    }

    return NextResponse.json({
      runId,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "デザイン確認生成に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
