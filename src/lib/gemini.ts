import fs from "node:fs";
import path from "node:path";

type GeminiGenerationResult = {
  responseJson: unknown;
  imageBytes: Buffer;
  mimeType: string;
  textParts: string[];
};

function detectExt(mimeType: string): string {
  if (mimeType.includes("png")) {
    return "png";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  return "jpg";
}

function mimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

export function imageExtensionFromMime(mimeType: string): string {
  return detectExt(mimeType);
}

export async function generateImageWithGemini(params: {
  apiKey: string;
  model: string;
  prompt: string;
  inputImagePath: string;
  logoImagePaths?: string[];
  referenceImagePaths?: string[];
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
}): Promise<GeminiGenerationResult> {
  const {
    apiKey,
    model,
    prompt,
    inputImagePath,
    logoImagePaths = [],
    referenceImagePaths = [],
    aspectRatio = "16:9",
    imageSize = "2K",
  } = params;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];

  const source = fs.readFileSync(inputImagePath);
  parts.push({
    inlineData: {
      mimeType: mimeTypeFromPath(inputImagePath),
      data: source.toString("base64"),
    },
  });

  for (const logoImagePath of logoImagePaths) {
    if (!fs.existsSync(logoImagePath)) {
      continue;
    }
    const logo = fs.readFileSync(logoImagePath);
    parts.push({
      inlineData: {
        mimeType: mimeTypeFromPath(logoImagePath),
        data: logo.toString("base64"),
      },
    });
  }

  for (const referenceImagePath of referenceImagePaths) {
    if (!fs.existsSync(referenceImagePath)) {
      continue;
    }
    const ref = fs.readFileSync(referenceImagePath);
    parts.push({
      inlineData: {
        mimeType: mimeTypeFromPath(referenceImagePath),
        data: ref.toString("base64"),
      },
    });
  }

  const payload = {
    contents: [
      {
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const responseJson = await response.json();
  if (!response.ok) {
    const message =
      (responseJson as { error?: { message?: string } }).error?.message ?? "Gemini APIエラー";
    throw new Error(message);
  }

  const candidates = (
    responseJson as {
      candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
    }
  ).candidates ?? [];
  const textParts: string[] = [];

  for (const candidate of candidates) {
    for (const part of candidate.content?.parts ?? []) {
      const text = typeof part.text === "string" ? part.text : "";
      if (text) {
        textParts.push(text);
      }
      const inlineData = (part.inlineData ?? part.inline_data) as
        | { mimeType?: string; mime_type?: string; data?: string }
        | undefined;
      if (inlineData?.data) {
        const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? "image/jpeg";
        return {
          responseJson,
          imageBytes: Buffer.from(inlineData.data, "base64"),
          mimeType,
          textParts,
        };
      }
    }
  }

  throw new Error("画像データがレスポンスに含まれていません。");
}
