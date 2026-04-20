import { NextResponse } from "next/server";

import { ensureSettings, updateSettings } from "@/lib/db/repository";
import { updateSettingsSchema } from "@/lib/validation";

export async function GET() {
  const settings = await ensureSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  const payload = await request.json();
  const result = updateSettingsSchema.safeParse(payload);

  if (!result.success) {
    return NextResponse.json(
      {
        error: "Invalid settings payload",
        issues: result.error.issues,
      },
      { status: 400 },
    );
  }

  const updated = await updateSettings(result.data);
  return NextResponse.json(updated);
}
