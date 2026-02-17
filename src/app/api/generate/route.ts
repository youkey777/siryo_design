import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendRun, loadJob, nextVersionForPage, updateMemoDecisions } from "@/lib/jobs-store";
import { getApiKey } from "@/lib/settings";
import { parsePageSelection } from "@/lib/page-selection";
import { buildPromptForSlide, getPromptExclusionStats } from "@/lib/prompts";
import { applyLogoLock } from "@/lib/logo-lock";
import { generateImageWithGemini, imageExtensionFromMime } from "@/lib/gemini";
import type { GenerationResult, GenerationRun } from "@/lib/types";
import { getJobDir } from "@/lib/paths";

export const runtime = "nodejs";

const schema = z.object({
  jobId: z.string().min(1),
  pageSelection: z.string().min(1),
  designPrompt: z.string().min(1),
  memoDecisions: z.record(z.string(), z.boolean()).optional(),
});

const IMAGE_MODEL = "gemini-3-pro-image-preview";

function createRunId(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}_${Math.random().toString(36).slice(2, 6)}`;
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
    const pages = parsePageSelection(body.pageSelection, job.slideCount);
    const runId = createRunId();

    const results: GenerationResult[] = [];
    const jobDir = getJobDir(job.jobId);
    const referenceImagePaths = (job.designReferenceFiles ?? []).map((file) => path.join(jobDir, file));
    const logoImagePaths = (job.logoReferenceFiles ?? []).map((file) => path.join(jobDir, file));

    for (const page of pages) {
      const slide = job.slides.find((row) => row.page === page);
      if (!slide) {
        continue;
      }

      const version = nextVersionForPage(job, page);
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
        `[memo-exclusion] job=${job.jobId} page=${page} auto=${stats.autoExcludedCount} manual=${stats.manualExcludedCount}`,
      );

      const promptFile = path
        .join("prompts", `${runId}_page${String(page).padStart(3, "0")}_v${version}.txt`)
        .replaceAll("\\", "/");
      const responseJsonFile = path
        .join("responses", `${runId}_page${String(page).padStart(3, "0")}_v${version}.json`)
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
        }

        const outputImageFile = path
          .join("outputs", `${runId}_page${String(page).padStart(3, "0")}_v${version}.${ext}`)
          .replaceAll("\\", "/");

        fs.writeFileSync(path.join(jobDir, outputImageFile), outputBytes);
        fs.writeFileSync(path.join(jobDir, responseJsonFile), JSON.stringify(generated.responseJson, null, 2), "utf8");

        results.push({
          page,
          version,
          promptFile,
          outputImageFile,
          responseJsonFile,
          status: "success",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成失敗";
        results.push({
          page,
          version,
          promptFile,
          outputImageFile: "",
          responseJsonFile,
          status: "error",
          error: message,
        });
      }

      job = loadJob(job.jobId);
    }

    const run: GenerationRun = {
      runId,
      type: "generate",
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
    const message = error instanceof Error ? error.message : "本生成に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
