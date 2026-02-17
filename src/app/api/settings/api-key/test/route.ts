import { NextResponse } from "next/server";
import { getApiKey } from "@/lib/settings";

export const runtime = "nodejs";

export async function POST() {
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "APIキー未設定" }, { status: 400 });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: "GET" },
    );
    const payload = await response.json();

    if (!response.ok) {
      const message =
        (payload as { error?: { message?: string } }).error?.message ?? "接続テスト失敗";
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    const modelNames = ((payload as { models?: Array<{ name?: string }> }).models ?? [])
      .map((model) => model.name)
      .filter(Boolean);

    return NextResponse.json({
      ok: true,
      models: {
        nanobananaPro: modelNames.includes("models/gemini-3-pro-image-preview"),
        flashImage: modelNames.includes("models/gemini-2.5-flash-image"),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "接続テスト失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
