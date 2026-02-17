import { NextResponse } from "next/server";
import { getApiKeyStatus } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getApiKeyStatus());
}
