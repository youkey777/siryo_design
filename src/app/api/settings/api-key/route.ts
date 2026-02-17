import { NextResponse } from "next/server";
import { z } from "zod";
import { saveApiKey } from "@/lib/settings";

export const runtime = "nodejs";

const bodySchema = z.object({
  apiKey: z.string().min(20, "APIキーが短すぎます。"),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { apiKey } = bodySchema.parse(json);
    saveApiKey(apiKey.trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "APIキー保存に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
