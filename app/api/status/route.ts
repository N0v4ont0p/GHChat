import { NextResponse } from "next/server";

import { ensureSettings } from "@/lib/db/repository";
import { detectOllamaState } from "@/lib/ollama/detection";

export async function GET() {
  const settings = await ensureSettings();
  const detection = await detectOllamaState(settings.backendHost);

  return NextResponse.json({
    ...detection,
    provider: "ollama",
  });
}
