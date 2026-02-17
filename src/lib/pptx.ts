import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { looksLikeMemoText, normalizeText } from "@/lib/memo-detector";
import type { ExtractedPptxPayload, SlideInfo } from "@/lib/types";

function runCommand(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} 実行に失敗しました。`);
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
    throw new Error("スライド画像の書き出し数が不足しています。PowerPoint出力を確認してください。");
  }

  return map;
}

function buildMemoCandidates(slide: { page: number; textBlocks: string[]; notes: string[] }): SlideInfo["memoCandidates"] {
  const candidates: SlideInfo["memoCandidates"] = [];
  let idx = 1;

  for (const note of slide.notes) {
    const text = normalizeText(note);
    if (!text) {
      continue;
    }
    candidates.push({
      id: `p${slide.page}-memo-${idx}`,
      text,
      source: "note",
      reason: "スピーカーノート由来",
      excludedByDefault: true,
    });
    idx += 1;
  }

  for (const block of slide.textBlocks) {
    const text = normalizeText(block);
    if (!text) {
      continue;
    }
    if (!looksLikeMemoText(text)) {
      continue;
    }
    candidates.push({
      id: `p${slide.page}-memo-${idx}`,
      text,
      source: "text",
      reason: "注釈/制作メモらしい文言",
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

  const slides: SlideInfo[] = extracted.slides.map((slide) => {
    const sourceImageFile = imageMap.get(slide.page) ?? `page${String(slide.page).padStart(3, "0")}.png`;
    return {
      page: slide.page,
      sourceImageFile,
      textBlocks: slide.textBlocks.map(normalizeText).filter(Boolean),
      notes: slide.notes.map(normalizeText).filter(Boolean),
      memoCandidates: buildMemoCandidates(slide),
    };
  });

  return { slideCount: extracted.slideCount, slides };
}
