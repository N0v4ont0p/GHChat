import { NextResponse } from "next/server";

import {
  deleteConversation,
  getConversation,
  renameConversation,
} from "@/lib/db/repository";
import { renameConversationSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await request.json();
  const parsed = renameConversationSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 });
  }

  const conversation = await renameConversation(id, parsed.data.title);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const existing = await getConversation(id);

  if (!existing) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  await deleteConversation(id);
  return NextResponse.json({ ok: true });
}
