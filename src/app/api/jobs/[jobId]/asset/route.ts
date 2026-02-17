import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getJobDir } from "@/lib/paths";

export const runtime = "nodejs";

function contentTypeFromExt(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");

    if (!file) {
      return NextResponse.json({ ok: false, error: "file パラメータが必要です。" }, { status: 400 });
    }

    const baseDir = getJobDir(jobId);
    const normalized = file.replaceAll("\\", "/");
    const resolved = path.resolve(baseDir, normalized);
    const base = path.resolve(baseDir);

    if (!resolved.startsWith(base)) {
      return NextResponse.json({ ok: false, error: "不正なファイルパスです。" }, { status: 400 });
    }

    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ ok: false, error: "ファイルが見つかりません。" }, { status: 404 });
    }

    const body = fs.readFileSync(resolved);
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentTypeFromExt(resolved),
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ファイル取得に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
