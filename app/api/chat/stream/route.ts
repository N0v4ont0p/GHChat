import { NextResponse } from "next/server";

import {
  appendMessage,
  createConversation,
  getConversation,
  listMessages,
  removeLatestAssistantMessage,
} from "@/lib/db/repository";
import { createProvider } from "@/lib/providers";
import { streamChatSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = streamChatSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid chat payload" }, { status: 400 });
  }

  const input = parsed.data;
  let conversationId = input.conversationId;

  if (!conversationId) {
    const conversation = await createConversation(input.message);
    conversationId = conversation?.id;
  }

  if (!conversationId) {
    return NextResponse.json(
      { error: "Unable to create conversation" },
      { status: 500 },
    );
  }

  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (input.regenerate) {
    await removeLatestAssistantMessage(conversationId);
  } else {
    await appendMessage({
      conversationId,
      role: "user",
      content: input.message,
    });
  }

  const history = await listMessages(conversationId);
  const provider = createProvider(input.host);

  const encoder = new TextEncoder();
  let accumulated = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await provider.streamChat({
          model: input.model,
          signal: request.signal,
          messages: history.map((entry) => ({
            role: entry.role,
            content: entry.content,
          })),
          onToken(token) {
            accumulated += token;
            controller.enqueue(encoder.encode(token));
          },
        });

        if (accumulated.trim()) {
          await appendMessage({
            conversationId,
            role: "assistant",
            content: accumulated,
          });
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      if (accumulated.trim()) {
        void appendMessage({
          conversationId,
          role: "assistant",
          content: `${accumulated}\n\n*Generation interrupted.*`,
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Conversation-Id": conversationId,
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
