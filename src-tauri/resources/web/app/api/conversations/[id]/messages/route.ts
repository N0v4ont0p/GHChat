import { NextResponse } from "next/server";

import { getConversation, listMessages } from "@/lib/db/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const conversation = await getConversation(id);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = await listMessages(id);
  return NextResponse.json({ messages });
}
