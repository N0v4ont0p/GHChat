import { NextResponse } from "next/server";

import { ensureSettings } from "@/lib/db/repository";
import { createProvider } from "@/lib/providers";

export async function GET() {
  const settings = await ensureSettings();

  try {
    const provider = createProvider(settings.backendHost);
    const models = await provider.listModels();

    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      {
        models: [],
        error:
          error instanceof Error
            ? error.message
            : "Unable to retrieve models from Ollama.",
      },
      { status: 503 },
    );
  }
}
