import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendRun, loadJob, nextVersionForPage, updateMemoDecisions } from "@/lib/jobs-store";
import { getApiKey } from "@/lib/settings";
import { buildPromptForSlide, getPromptExclusionStats } from "@/lib/prompts";
import { applyLogoLock } from "@/lib/logo-lock";
import { generateImageWithGemini, imageExtensionFromMime } from "@/lib/gemini";
import type { GenerationResult, GenerationRun, LogoLockInfo } from "@/lib/types";
import { getJobDir } from "@/lib/paths";

export const runtime = "nodejs";

const schema = z.object({
  jobId: z.string().min(1),
  designPrompt: z.string().min(1),
  memoDecisions: z.record(z.string(), z.boolean()).optional(),
  edits: z
    .array(
      z.object({
        page: z.number().int().positive(),
        fixPrompt: z.string().min(1),
      }),
    )
    .min(1),
});

const IMAGE_MODEL = "gemini-3-pro-image-preview";

function createRunId(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}_${Math.random().toString(36).slice(2, 6)}`;
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

    let job = body.memoDecisions ? updateMemoDecisions(body.jobId, body.memoDecisions) : loadJob(body.jobId);
    const runId = createRunId();

    const results: GenerationResult[] = [];
    const jobDir = getJobDir(job.jobId);
    const referenceImagePaths = (job.designReferenceFiles ?? []).map((file) => path.join(jobDir, file));
    const logoImagePaths = (job.logoReferenceFiles ?? []).map((file) => path.join(jobDir, file));

    for (const edit of body.edits) {
      const slide = job.slides.find((row) => row.page === edit.page);
      if (!slide) {
        results.push({
          page: edit.page,
          version: 0,
          promptFile: "",
          outputImageFile: "",
          responseJsonFile: "",
          status: "error",
          logoLock: fallbackLogoLockInfo(`ページ ${edit.page} が見つかりません。`),
          error: `ページ ${edit.page} が見つかりません。`,
        });
        continue;
      }

      const version = nextVersionForPage(job, edit.page);
      const prompt = buildPromptForSlide({
        slide,
        designPrompt: body.designPrompt,
        memoDecisions: job.memoDecisions,
        manualMemoExclusions: job.manualMemoExclusions,
        extraFixPrompt: edit.fixPrompt,
        logoReferenceCount: logoImagePaths.length,
      });

      const stats = getPromptExclusionStats({
        slide,
        memoDecisions: job.memoDecisions,
        manualMemoExclusions: job.manualMemoExclusions,
      });
      console.info(
        `[memo-exclusion] job=${job.jobId} page=${edit.page} auto=${stats.autoExcludedCount} manual=${stats.manualExcludedCount}`,
      );

      const promptFile = path
        .join("prompts", `${runId}_page${String(edit.page).padStart(3, "0")}_v${version}.txt`)
        .replaceAll("\\", "/");
      const responseJsonFile = path
        .join("responses", `${runId}_page${String(edit.page).padStart(3, "0")}_v${version}.json`)
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
          .join("outputs", `${runId}_page${String(edit.page).padStart(3, "0")}_v${version}.${ext}`)
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
          page: edit.page,
          version,
          promptFile,
          outputImageFile,
          responseJsonFile,
          status: "success",
          logoLock,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "再生成に失敗しました。";
        results.push({
          page: edit.page,
          version,
          promptFile,
          outputImageFile: "",
          responseJsonFile,
          status: "error",
          logoLock: fallbackLogoLockInfo(message),
          error: message,
        });
      }

      job = loadJob(job.jobId);
    }

    const run: GenerationRun = {
      runId,
      type: "regenerate",
      model: IMAGE_MODEL,
      createdAt: new Date().toISOString(),
      results,
    };

    appendRun(body.jobId, run);

    return NextResponse.json({
      runId,
      results: results.map((result) => ({
        ...result,
        imageUrl:
          result.status === "success"
            ? `/api/jobs/${body.jobId}/asset?file=${encodeURIComponent(result.outputImageFile)}`
            : null,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "再生成に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
