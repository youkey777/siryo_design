import fs from "node:fs";
import sharp from "sharp";
import type { LogoLockDetection, LogoLockInfo } from "@/lib/types";

type GrayImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

type RgbaImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

type MatchCandidate = {
  x: number;
  y: number;
  score: number;
  width: number;
  height: number;
};

export type LogoLockResult =
  | {
      ok: true;
      imageBytes: Buffer;
      metadata: LogoLockInfo;
    }
  | {
      ok: false;
      error: string;
      metadata: LogoLockInfo;
    };

async function readRgbaImage(input: string | Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data),
    width: info.width,
    height: info.height,
  };
}

function rgbaToGray(image: RgbaImage): GrayImage {
  const out = new Uint8Array(image.width * image.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    const r = image.data[p];
    const g = image.data[p + 1];
    const b = image.data[p + 2];
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { data: out, width: image.width, height: image.height };
}

async function resizeRgba(image: RgbaImage, width: number, height: number): Promise<RgbaImage> {
  const { data, info } = await sharp(Buffer.from(image.data), {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
  })
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data),
    width: info.width,
    height: info.height,
  };
}

function buildLogoMask(rgba: RgbaImage): Uint8Array {
  const out = new Uint8Array(rgba.width * rgba.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = rgba.data[p + 3] >= 24 ? 1 : 0;
  }
  return out;
}

function calcIou(a: MatchCandidate, b: MatchCandidate): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(ax2, bx2);
  const bottom = Math.min(ay2, by2);

  const interW = Math.max(0, right - left);
  const interH = Math.max(0, bottom - top);
  const inter = interW * interH;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function scoreAt(
  source: GrayImage,
  logo: GrayImage,
  mask: Uint8Array,
  startX: number,
  startY: number,
  sampleStep: number,
): number {
  let sum = 0;
  let count = 0;

  for (let y = 0; y < logo.height; y += sampleStep) {
    const sy = startY + y;
    const sourceRowBase = sy * source.width;
    const logoRowBase = y * logo.width;
    for (let x = 0; x < logo.width; x += sampleStep) {
      const mi = logoRowBase + x;
      if (mask[mi] === 0) {
        continue;
      }
      const si = sourceRowBase + startX + x;
      const diff = Math.abs(source.data[si] - logo.data[mi]);
      sum += diff;
      count += 1;
      if (count > 30 && sum / count > 95) {
        return 1;
      }
    }
  }

  if (count === 0) {
    return 1;
  }
  return (sum / count) / 255;
}

function insertTopCandidates(
  list: MatchCandidate[],
  candidate: MatchCandidate,
  maxCount: number,
): void {
  list.push(candidate);
  list.sort((a, b) => a.score - b.score);
  if (list.length > maxCount) {
    list.length = maxCount;
  }
}

function generateCandidateWidths(baseWidth: number, sourceWidth: number): number[] {
  const multipliers = [0.55, 0.7, 0.85, 1.0, 1.2, 1.45, 1.7, 2.0, 2.3];
  const ratioTargets = [0.06, 0.09, 0.12, 0.15, 0.18, 0.22, 0.26, 0.3];
  const set = new Set<number>();

  for (const m of multipliers) {
    set.add(Math.round(baseWidth * m));
  }
  for (const ratio of ratioTargets) {
    set.add(Math.round(sourceWidth * ratio));
  }

  return Array.from(set)
    .filter((w) => w >= 18 && w <= Math.floor(sourceWidth * 0.92))
    .sort((a, b) => a - b);
}

function collectTopMatches(
  source: GrayImage,
  logo: GrayImage,
  mask: Uint8Array,
  maxCandidates: number,
): MatchCandidate[] {
  const maxX = source.width - logo.width;
  const maxY = source.height - logo.height;
  if (maxX < 0 || maxY < 0) {
    return [];
  }

  const coarseStride = 8;
  const top: MatchCandidate[] = [];

  for (let y = 0; y <= maxY; y += coarseStride) {
    for (let x = 0; x <= maxX; x += coarseStride) {
      const score = scoreAt(source, logo, mask, x, y, 3);
      insertTopCandidates(top, { x, y, score, width: logo.width, height: logo.height }, maxCandidates * 2);
    }
  }

  const refined: MatchCandidate[] = [];
  for (const coarse of top) {
    const refineRadius = 12;
    const fromX = Math.max(0, coarse.x - refineRadius);
    const toX = Math.min(maxX, coarse.x + refineRadius);
    const fromY = Math.max(0, coarse.y - refineRadius);
    const toY = Math.min(maxY, coarse.y + refineRadius);
    let best = coarse;

    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        const score = scoreAt(source, logo, mask, x, y, 1);
        if (score < best.score) {
          best = { ...best, x, y, score };
        }
      }
    }
    insertTopCandidates(refined, best, maxCandidates * 3);
  }

  const unique: MatchCandidate[] = [];
  for (const candidate of refined.sort((a, b) => a.score - b.score)) {
    const duplicated = unique.some((existing) => calcIou(existing, candidate) > 0.45);
    if (!duplicated) {
      unique.push(candidate);
    }
    if (unique.length >= maxCandidates) {
      break;
    }
  }

  return unique;
}

function normalizeDetectionPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function buildFailureMetadata(message: string, detections: LogoLockDetection[], logoCount: number): LogoLockInfo {
  return {
    applied: true,
    logoCount,
    detections,
    verificationScores: [],
    verified: false,
    message,
  };
}

async function findLogoDetections(params: {
  sourceImage: RgbaImage;
  logoPath: string;
  maxDetections: number;
}): Promise<LogoLockDetection[]> {
  const { sourceImage, logoPath, maxDetections } = params;
  const trimmedLogoBuffer = await sharp(logoPath).ensureAlpha().trim().toBuffer();
  const logoRaw = await readRgbaImage(trimmedLogoBuffer);
  if (logoRaw.width < 4 || logoRaw.height < 4) {
    return [];
  }

  const sourceScale = Math.min(1, 640 / sourceImage.width);
  const sourceSmall = await resizeRgba(
    sourceImage,
    Math.max(120, Math.round(sourceImage.width * sourceScale)),
    Math.max(68, Math.round(sourceImage.height * sourceScale)),
  );
  const sourceGray = rgbaToGray(sourceSmall);

  const baseWidth = Math.max(20, Math.round(logoRaw.width * sourceScale));
  const candidateWidths = generateCandidateWidths(baseWidth, sourceSmall.width);
  const allCandidates: MatchCandidate[] = [];

  for (const candidateWidth of candidateWidths) {
    const candidateHeight = Math.max(8, Math.round((candidateWidth / logoRaw.width) * logoRaw.height));
    if (candidateHeight >= sourceSmall.height) {
      continue;
    }

    const resized = await resizeRgba(logoRaw, candidateWidth, candidateHeight);
    const logoGray = rgbaToGray(resized);
    const mask = buildLogoMask(resized);
    const matches = collectTopMatches(sourceGray, logoGray, mask, maxDetections);
    allCandidates.push(...matches);
  }

  const deduped: MatchCandidate[] = [];
  for (const candidate of allCandidates.sort((a, b) => a.score - b.score)) {
    const duplicated = deduped.some((existing) => calcIou(existing, candidate) > 0.35);
    if (!duplicated) {
      deduped.push(candidate);
    }
    if (deduped.length >= maxDetections) {
      break;
    }
  }

  return deduped
    .filter((candidate) => candidate.score <= 0.24)
    .map((candidate) => ({
      logoPath: normalizeDetectionPath(logoPath),
      x: Math.round(candidate.x / sourceScale),
      y: Math.round(candidate.y / sourceScale),
      width: Math.round(candidate.width / sourceScale),
      height: Math.round(candidate.height / sourceScale),
      score: candidate.score,
    }));
}

async function renderResizedLogo(
  logoPath: string,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const { data } = await sharp(logoPath)
    .ensureAlpha()
    .trim()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

function verifyDetectionPatch(params: {
  finalImage: RgbaImage;
  detection: LogoLockDetection;
  renderedLogo: Uint8Array;
  scaleX: number;
  scaleY: number;
}): number {
  const { finalImage, detection, renderedLogo, scaleX, scaleY } = params;
  const targetWidth = Math.max(1, Math.round(detection.width * scaleX));
  const targetHeight = Math.max(1, Math.round(detection.height * scaleY));
  const targetLeft = Math.max(0, Math.round(detection.x * scaleX));
  const targetTop = Math.max(0, Math.round(detection.y * scaleY));

  let sum = 0;
  let count = 0;

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const logoIndex = (y * targetWidth + x) * 4;
      const alpha = renderedLogo[logoIndex + 3];
      if (alpha < 20) {
        continue;
      }

      const fx = targetLeft + x;
      const fy = targetTop + y;
      if (fx < 0 || fy < 0 || fx >= finalImage.width || fy >= finalImage.height) {
        continue;
      }

      const finalIndex = (fy * finalImage.width + fx) * 4;
      const dr = Math.abs(finalImage.data[finalIndex] - renderedLogo[logoIndex]);
      const dg = Math.abs(finalImage.data[finalIndex + 1] - renderedLogo[logoIndex + 1]);
      const db = Math.abs(finalImage.data[finalIndex + 2] - renderedLogo[logoIndex + 2]);
      const da = Math.abs(finalImage.data[finalIndex + 3] - renderedLogo[logoIndex + 3]);
      sum += dr + dg + db + da;
      count += 4;
    }
  }

  if (count === 0) {
    return 1;
  }
  return sum / count / 255;
}

export async function applyLogoLock(params: {
  sourceSlidePath: string;
  generatedImageBytes: Buffer;
  logoReferencePaths: string[];
}): Promise<LogoLockResult> {
  const { sourceSlidePath, generatedImageBytes, logoReferencePaths } = params;
  const existingLogos = logoReferencePaths.filter((logoPath) => fs.existsSync(logoPath));
  if (existingLogos.length === 0) {
    return {
      ok: true,
      imageBytes: generatedImageBytes,
      metadata: {
        applied: false,
        logoCount: 0,
        detections: [],
        verificationScores: [],
        verified: true,
      },
    };
  }

  const sourceImage = await readRgbaImage(sourceSlidePath);
  const detections: LogoLockDetection[] = [];
  for (const logoPath of existingLogos) {
    const matches = await findLogoDetections({
      sourceImage,
      logoPath,
      maxDetections: 3,
    });
    if (matches.length === 0) {
      const message = `ロゴ位置検出に失敗しました: ${normalizeDetectionPath(logoPath)}`;
      return {
        ok: false,
        error: message,
        metadata: buildFailureMetadata(message, detections, existingLogos.length),
      };
    }
    detections.push(...matches);
  }

  const generatedMeta = await sharp(generatedImageBytes).metadata();
  const generatedWidth = generatedMeta.width ?? 0;
  const generatedHeight = generatedMeta.height ?? 0;
  if (generatedWidth <= 0 || generatedHeight <= 0) {
    const message = "生成画像のサイズ取得に失敗しました。";
    return {
      ok: false,
      error: message,
      metadata: buildFailureMetadata(message, detections, existingLogos.length),
    };
  }

  const scaleX = generatedWidth / sourceImage.width;
  const scaleY = generatedHeight / sourceImage.height;

  const composites = await Promise.all(
    detections.map(async (detection) => {
      const targetWidth = Math.max(1, Math.round(detection.width * scaleX));
      const targetHeight = Math.max(1, Math.round(detection.height * scaleY));
      const targetLeft = Math.max(0, Math.round(detection.x * scaleX));
      const targetTop = Math.max(0, Math.round(detection.y * scaleY));

      const input = await sharp(existingLogos.find((logoPath) => normalizeDetectionPath(logoPath) === detection.logoPath)!)
        .ensureAlpha()
        .trim()
        .resize(targetWidth, targetHeight, { fit: "fill" })
        .png()
        .toBuffer();

      return {
        input,
        left: targetLeft,
        top: targetTop,
      };
    }),
  );

  const lockedImageBytes = await sharp(generatedImageBytes).composite(composites).png().toBuffer();
  const finalImage = await readRgbaImage(lockedImageBytes);

  const verificationScores: number[] = [];
  for (const detection of detections) {
    const sourceLogoPath = existingLogos.find(
      (logoPath) => normalizeDetectionPath(logoPath) === detection.logoPath,
    );
    if (!sourceLogoPath) {
      continue;
    }

    const targetWidth = Math.max(1, Math.round(detection.width * scaleX));
    const targetHeight = Math.max(1, Math.round(detection.height * scaleY));
    const renderedLogo = await renderResizedLogo(sourceLogoPath, targetWidth, targetHeight);
    const score = verifyDetectionPatch({
      finalImage,
      detection,
      renderedLogo,
      scaleX,
      scaleY,
    });
    verificationScores.push(score);
  }

  const failedScore = verificationScores.find((score) => score > 0.08);
  if (failedScore !== undefined) {
    const message = `ロゴ固定検証に失敗しました。（一致スコア: ${failedScore.toFixed(3)}）`;
    return {
      ok: false,
      error: message,
      metadata: buildFailureMetadata(message, detections, existingLogos.length),
    };
  }

  return {
    ok: true,
    imageBytes: lockedImageBytes,
    metadata: {
      applied: true,
      logoCount: existingLogos.length,
      detections,
      verificationScores,
      verified: true,
    },
  };
}
