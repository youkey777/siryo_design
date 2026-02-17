import fs from "node:fs";
import sharp from "sharp";

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

export type LogoLockDetection = {
  logoPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

export type LogoLockResult =
  | {
      ok: true;
      imageBytes: Buffer;
      detections: LogoLockDetection[];
    }
  | {
      ok: false;
      error: string;
      detections: LogoLockDetection[];
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
  return {
    data: out,
    width: image.width,
    height: image.height,
  };
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
      if (count > 24 && sum / count > 90) {
        return 1;
      }
    }
  }

  if (count === 0) {
    return 1;
  }
  return (sum / count) / 255;
}

function generateCandidateWidths(baseWidth: number, sourceWidth: number): number[] {
  const multipliers = [0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.2];
  const percentageTargets = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28];
  const set = new Set<number>();

  for (const m of multipliers) {
    set.add(Math.round(baseWidth * m));
  }
  for (const p of percentageTargets) {
    set.add(Math.round(sourceWidth * p));
  }

  return Array.from(set)
    .filter((w) => w >= 18 && w <= Math.floor(sourceWidth * 0.92))
    .sort((a, b) => a - b);
}

function findBestMatch(source: GrayImage, logo: GrayImage, mask: Uint8Array): {
  x: number;
  y: number;
  score: number;
} {
  const maxX = source.width - logo.width;
  const maxY = source.height - logo.height;
  const coarseStride = 10;
  let best = { x: 0, y: 0, score: Number.POSITIVE_INFINITY };

  for (let y = 0; y <= maxY; y += coarseStride) {
    for (let x = 0; x <= maxX; x += coarseStride) {
      const score = scoreAt(source, logo, mask, x, y, 3);
      if (score < best.score) {
        best = { x, y, score };
      }
    }
  }

  const refineRadius = 24;
  const startX = Math.max(0, best.x - refineRadius);
  const endX = Math.min(maxX, best.x + refineRadius);
  const startY = Math.max(0, best.y - refineRadius);
  const endY = Math.min(maxY, best.y + refineRadius);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const score = scoreAt(source, logo, mask, x, y, 1);
      if (score < best.score) {
        best = { x, y, score };
      }
    }
  }

  return best;
}

async function findLogoOnSource(params: {
  sourceImage: RgbaImage;
  logoPath: string;
}): Promise<LogoLockDetection | null> {
  const { sourceImage, logoPath } = params;
  const trimmedLogoBuffer = await sharp(logoPath)
    .ensureAlpha()
    .trim()
    .toBuffer();
  const logoRaw = await readRgbaImage(trimmedLogoBuffer);
  if (logoRaw.width < 4 || logoRaw.height < 4) {
    return null;
  }

  const sourceScale = Math.min(1, 640 / sourceImage.width);
  const sourceSmall = await resizeRgba(
    sourceImage,
    Math.max(120, Math.round(sourceImage.width * sourceScale)),
    Math.max(68, Math.round(sourceImage.height * sourceScale)),
  );
  const sourceGray = rgbaToGray(sourceSmall);
  const baseWidth = Math.max(20, Math.round(logoRaw.width * sourceScale));
  const candidates = generateCandidateWidths(baseWidth, sourceSmall.width);

  let bestDetection: LogoLockDetection | null = null;

  for (const candidateWidth of candidates) {
    const candidateHeight = Math.max(8, Math.round((candidateWidth / logoRaw.width) * logoRaw.height));
    if (candidateHeight >= sourceSmall.height) {
      continue;
    }

    const logoResized = await resizeRgba(logoRaw, candidateWidth, candidateHeight);
    const logoGray = rgbaToGray(logoResized);
    const mask = buildLogoMask(logoResized);
    const best = findBestMatch(sourceGray, logoGray, mask);

    if (!bestDetection || best.score < bestDetection.score) {
      bestDetection = {
        logoPath,
        x: Math.round(best.x / sourceScale),
        y: Math.round(best.y / sourceScale),
        width: Math.round(candidateWidth / sourceScale),
        height: Math.round(candidateHeight / sourceScale),
        score: best.score,
      };
    }
  }

  if (!bestDetection) {
    return null;
  }
  if (bestDetection.score > 0.22) {
    return null;
  }
  return bestDetection;
}

export async function applyLogoLock(params: {
  sourceSlidePath: string;
  generatedImageBytes: Buffer;
  logoReferencePaths: string[];
}): Promise<LogoLockResult> {
  const { sourceSlidePath, generatedImageBytes, logoReferencePaths } = params;
  if (logoReferencePaths.length === 0) {
    return { ok: true, imageBytes: generatedImageBytes, detections: [] };
  }

  const sourceImage = await readRgbaImage(sourceSlidePath);
  const detections: LogoLockDetection[] = [];

  for (const logoPath of logoReferencePaths) {
    if (!fs.existsSync(logoPath)) {
      continue;
    }
    const detection = await findLogoOnSource({ sourceImage, logoPath });
    if (!detection) {
      return {
        ok: false,
        error: `ロゴ位置検出に失敗しました: ${logoPath.split(/[\\/]/).pop()}`,
        detections,
      };
    }
    detections.push(detection);
  }

  const generatedMeta = await sharp(generatedImageBytes).metadata();
  const generatedWidth = generatedMeta.width ?? 0;
  const generatedHeight = generatedMeta.height ?? 0;
  if (generatedWidth <= 0 || generatedHeight <= 0) {
    return {
      ok: false,
      error: "生成画像のサイズ取得に失敗しました。",
      detections,
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

      const input = await sharp(detection.logoPath)
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

  const imageBytes = await sharp(generatedImageBytes).composite(composites).png().toBuffer();
  return {
    ok: true,
    imageBytes,
    detections,
  };
}
