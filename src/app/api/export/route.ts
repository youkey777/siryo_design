import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import { z } from "zod";
import { ensureDir, getJobDir } from "@/lib/paths";

export const runtime = "nodejs";

const schema = z.object({
  jobId: z.string().min(1),
  format: z.enum(["pdf", "pptx"]),
  slides: z
    .array(
      z.object({
        page: z.number().int().positive(),
        outputImageFile: z.string().min(1),
      }),
    )
    .min(1),
});

const SLIDE_WIDTH_PT = 960;
const SLIDE_HEIGHT_PT = 540;
const PPTX_WIDTH_IN = 13.333;
const PPTX_HEIGHT_IN = 7.5;

function createExportFileName(format: "pdf" | "pptx"): string {
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  return `${timestamp}_slides.${format}`;
}

function resolveFileInJob(jobDir: string, file: string): string {
  const normalized = file.replaceAll("\\", "/");
  const resolved = path.resolve(jobDir, normalized);
  const base = path.resolve(jobDir);
  if (!resolved.startsWith(base)) {
    throw new Error("Invalid file path.");
  }
  return resolved;
}

async function readImageForExport(filePath: string): Promise<{
  mimeType: "image/png" | "image/jpeg";
  bytes: Buffer;
}> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    return {
      mimeType: "image/png",
      bytes: fs.readFileSync(filePath),
    };
  }

  if (ext === ".jpg" || ext === ".jpeg") {
    return {
      mimeType: "image/jpeg",
      bytes: fs.readFileSync(filePath),
    };
  }

  if (ext === ".webp") {
    return {
      mimeType: "image/png",
      bytes: await sharp(filePath).png().toBuffer(),
    };
  }

  throw new Error(`Unsupported image format: ${ext}`);
}

async function exportPdf(outputPath: string, imagePaths: string[]): Promise<void> {
  const pdf = await PDFDocument.create();

  for (const imagePath of imagePaths) {
    const image = await readImageForExport(imagePath);
    const embedded =
      image.mimeType === "image/png"
        ? await pdf.embedPng(image.bytes)
        : await pdf.embedJpg(image.bytes);

    const page = pdf.addPage([SLIDE_WIDTH_PT, SLIDE_HEIGHT_PT]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: SLIDE_WIDTH_PT,
      height: SLIDE_HEIGHT_PT,
    });
  }

  const bytes = await pdf.save();
  fs.writeFileSync(outputPath, Buffer.from(bytes));
}

async function exportPptx(outputPath: string, imagePaths: string[]): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "WIDE_16_9",
    width: PPTX_WIDTH_IN,
    height: PPTX_HEIGHT_IN,
  });
  pptx.layout = "WIDE_16_9";
  pptx.author = "Nanobanana Slide Studio";
  pptx.company = "Nanobanana Slide Studio";
  pptx.subject = "Generated Slides";
  pptx.title = "Generated Slides";

  for (const imagePath of imagePaths) {
    const image = await readImageForExport(imagePath);
    const data = `data:${image.mimeType};base64,${image.bytes.toString("base64")}`;
    const slide = pptx.addSlide();
    slide.addImage({
      data,
      x: 0,
      y: 0,
      w: PPTX_WIDTH_IN,
      h: PPTX_HEIGHT_IN,
    });
  }

  const bytes = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  fs.writeFileSync(outputPath, bytes);
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const jobDir = getJobDir(body.jobId);
    if (!fs.existsSync(jobDir)) {
      return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
    }

    const sortedSlides = [...body.slides].sort((a, b) => a.page - b.page);
    const imagePaths = sortedSlides.map((slide) => {
      const resolved = resolveFileInJob(jobDir, slide.outputImageFile);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Image file not found: ${slide.outputImageFile}`);
      }
      return resolved;
    });

    const exportsDir = path.join(jobDir, "exports");
    ensureDir(exportsDir);
    const fileName = createExportFileName(body.format);
    const outputPath = path.join(exportsDir, fileName);

    if (body.format === "pdf") {
      await exportPdf(outputPath, imagePaths);
    } else {
      await exportPptx(outputPath, imagePaths);
    }

    const file = path.join("exports", fileName).replaceAll("\\", "/");
    return NextResponse.json({
      ok: true,
      format: body.format,
      file,
      url: `/api/jobs/${body.jobId}/asset?file=${encodeURIComponent(file)}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
