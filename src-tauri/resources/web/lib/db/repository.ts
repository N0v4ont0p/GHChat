import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { defaultBackendHost, getDataDir } from "@/lib/config";
import type { AppSettings, MessageRole } from "@/types";

import { db } from "./client";
import { conversations, messages, settings } from "./schema";

const SETTINGS_ID = "app";

function now() {
  return new Date();
}

export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.query.settings.findFirst({
    where: eq(settings.id, SETTINGS_ID),
  });

  if (!existing) {
    const createdAt = now();
    await db.insert(settings).values({
      id: SETTINGS_ID,
      backendHost: defaultBackendHost,
      dataDirectory: getDataDir(),
      defaultModel: "",
      performanceMode: false,
      theme: "dark",
      updatedAt: createdAt,
    });

    return {
      backendHost: defaultBackendHost,
      defaultModel: "",
      performanceMode: false,
      theme: "dark",
      dataDirectory: getDataDir(),
    };
  }

  return {
    backendHost: existing.backendHost,
    defaultModel: existing.defaultModel,
    performanceMode: existing.performanceMode,
    theme: existing.theme,
    dataDirectory: existing.dataDirectory,
  };
}

export async function updateSettings(input: Partial<AppSettings>) {
  const current = await ensureSettings();

  const next = {
    ...current,
    ...input,
    backendHost: input.backendHost?.trim() || current.backendHost,
  };

  await db
    .update(settings)
    .set({
      backendHost: next.backendHost,
      defaultModel: next.defaultModel,
      performanceMode: next.performanceMode,
      theme: next.theme,
      dataDirectory: next.dataDirectory,
      updatedAt: now(),
    })
    .where(eq(settings.id, SETTINGS_ID));

  return next;
}

export async function listConversations() {
  return db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt));
}

export async function getConversation(conversationId: string) {
  return db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });
}

export async function createConversation(title?: string) {
  const id = randomUUID();
  const timestamp = now();

  await db.insert(conversations).values({
    id,
    title: title?.trim() || "New chat",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return getConversation(id);
}

export async function renameConversation(conversationId: string, title: string) {
  const trimmed = title.trim();

  if (!trimmed) {
    return null;
  }

  await db
    .update(conversations)
    .set({ title: trimmed, updatedAt: now() })
    .where(eq(conversations.id, conversationId));

  return getConversation(conversationId);
}

export async function deleteConversation(conversationId: string) {
  await db.delete(conversations).where(eq(conversations.id, conversationId));
}

export async function listMessages(conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

export async function appendMessage(input: {
  conversationId: string;
  role: MessageRole;
  content: string;
}) {
  const messageId = randomUUID();
  const timestamp = now();

  await db.insert(messages).values({
    id: messageId,
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    createdAt: timestamp,
  });

  await db
    .update(conversations)
    .set({
      title:
        input.role === "user"
          ? generateConversationTitle(input.content)
          : undefined,
      updatedAt: timestamp,
    })
    .where(eq(conversations.id, input.conversationId));

  return db.query.messages.findFirst({ where: eq(messages.id, messageId) });
}

function generateConversationTitle(content: string) {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 52 ? `${clean.slice(0, 52)}…` : clean;
}

export async function removeLatestAssistantMessage(conversationId: string) {
  const latest = await db.query.messages.findFirst({
    where: and(
      eq(messages.conversationId, conversationId),
      eq(messages.role, "assistant"),
    ),
    orderBy: desc(messages.createdAt),
  });

  if (latest) {
    await db.delete(messages).where(eq(messages.id, latest.id));
  }
}
