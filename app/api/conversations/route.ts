import { NextResponse } from "next/server";

import { createConversation, listConversations } from "@/lib/db/repository";
import { createConversationSchema } from "@/lib/validation";

export async function GET() {
  const conversations = await listConversations();
  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = createConversationSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const conversation = await createConversation(parsed.data.title);
  return NextResponse.json({ conversation }, { status: 201 });
}
