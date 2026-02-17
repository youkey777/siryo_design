import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteManualMemoExclusion } from "@/lib/jobs-store";

export const runtime = "nodejs";

const schema = z.object({
  jobId: z.string().min(1),
  id: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const updated = deleteManualMemoExclusion(body.jobId, body.id);
    return NextResponse.json({
      ok: true,
      manualMemoExclusions: updated.manualMemoExclusions ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "手動除外の削除に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
