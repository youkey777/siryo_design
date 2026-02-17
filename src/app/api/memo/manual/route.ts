import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertManualMemoExclusion } from "@/lib/jobs-store";

export const runtime = "nodejs";

const schema = z.object({
  jobId: z.string().min(1),
  item: z.object({
    id: z.string().optional(),
    page: z.number().int().positive(),
    text: z.string().min(1),
    enabled: z.boolean().default(true),
  }),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const updated = upsertManualMemoExclusion(body.jobId, body.item);

    return NextResponse.json({
      ok: true,
      manualMemoExclusions: updated.manualMemoExclusions ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "手動除外の保存に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
