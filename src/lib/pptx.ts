import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { looksLikeMemoText, normalizeText } from "@/lib/memo-detector";
import type { ExtractedPptxPayload, ExtractedSlide, SlideInfo } from "@/lib/types";

function runCommand(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} の実行に失敗しました。`);
  }
}

function extractPageFromFilename(name: string): number | null {
  const match = name.match(/(\d+)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function normalizeExportedImages(slidesDir: string, expectedCount: number): Map<number, string> {
  const files = fs
    .readdirSync(slidesDir)
    .filter((name) => /\.(png|PNG)$/i.test(name))
    .map((name) => ({ name, page: extractPageFromFilename(name) }))
    .filter((row) => row.page !== null)
    .sort((a, b) => Number(a.page) - Number(b.page));

  const map = new Map<number, string>();
  for (let i = 0; i < files.length; i += 1) {
    const page = i + 1;
    const finalName = `page${String(page).padStart(3, "0")}.png`;
    const from = path.join(slidesDir, files[i].name);
    const to = path.join(slidesDir, finalName);
    if (from !== to) {
      fs.renameSync(from, to);
    }
    map.set(page, finalName);
  }

  if (map.size < expectedCount) {
    throw new Error(
      "スライド画像の書き出し枚数が不足しています。PowerPoint書き出し設定を確認してください。",
    );
  }

  return map;
}

function buildMemoCandidates(params: {
  slide: ExtractedSlide;
  slideWidth: number;
  slideHeight: number;
}): SlideInfo["memoCandidates"] {
  const { slide, slideWidth, slideHeight } = params;
  const candidates: SlideInfo["memoCandidates"] = [];
  let idx = 1;
  const seen = new Set<string>();

  for (const note of slide.notes) {
    const text = normalizeText(note);
    if (!text || seen.has(`note:${text}`)) {
      continue;
    }
    seen.add(`note:${text}`);
    candidates.push({
      id: `p${slide.page}-memo-${idx}`,
      text,
      source: "note",
      reason: "スピーカーノート",
      excludedByDefault: true,
    });
    idx += 1;
  }

  const shapes = Array.isArray(slide.textShapes)
    ? slide.textShapes
    : slide.textBlocks.map((text) => ({
        text,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      }));

  for (const shape of shapes) {
    const text = normalizeText(shape.text ?? "");
    if (!text || seen.has(`text:${text}`)) {
      continue;
    }

    const topRatio = slideHeight > 0 ? shape.top / slideHeight : undefined;
    const leftRatio = slideWidth > 0 ? shape.left / slideWidth : undefined;
    const widthRatio = slideWidth > 0 ? shape.width / slideWidth : undefined;
    const heightRatio = slideHeight > 0 ? shape.height / slideHeight : undefined;

    if (
      !looksLikeMemoText(text, {
        topRatio,
        leftRatio,
        widthRatio,
        heightRatio,
      })
    ) {
      continue;
    }

    seen.add(`text:${text}`);
    candidates.push({
      id: `p${slide.page}-memo-${idx}`,
      text,
      source: "text",
      reason: "制作メモに見える文言",
      excludedByDefault: true,
    });
    idx += 1;
  }

  return candidates;
}

export function extractSlidesData(params: {
  sourcePptPath: string;
  slidesDir: string;
  extractedJsonPath: string;
  scriptDir: string;
}): { slideCount: number; slides: SlideInfo[] } {
  const { sourcePptPath, slidesDir, extractedJsonPath, scriptDir } = params;

  runCommand("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(scriptDir, "export_slides_png.ps1"),
    "-InputPath",
    sourcePptPath,
    "-OutputDir",
    slidesDir,
  ]);

  runCommand("python", [
    path.join(scriptDir, "extract_pptx_data.py"),
    "--input",
    sourcePptPath,
    "--output",
    extractedJsonPath,
  ]);

  const extracted = JSON.parse(fs.readFileSync(extractedJsonPath, "utf8")) as ExtractedPptxPayload;
  const imageMap = normalizeExportedImages(slidesDir, extracted.slideCount);
  const slideWidth = extracted.slideWidth || 0;
  const slideHeight = extracted.slideHeight || 0;

  const slides: SlideInfo[] = extracted.slides.map((slide) => {
    const sourceImageFile = imageMap.get(slide.page) ?? `page${String(slide.page).padStart(3, "0")}.png`;
    const normalizedTextBlocks = slide.textBlocks.map(normalizeText).filter(Boolean);
    const normalizedNotes = slide.notes.map(normalizeText).filter(Boolean);

    return {
      page: slide.page,
      sourceImageFile,
      textBlocks: normalizedTextBlocks,
      notes: normalizedNotes,
      memoCandidates: buildMemoCandidates({
        slide: {
          ...slide,
          textBlocks: normalizedTextBlocks,
          notes: normalizedNotes,
        },
        slideWidth,
        slideHeight,
      }),
    };
  });

  return { slideCount: extracted.slideCount, slides };
}
