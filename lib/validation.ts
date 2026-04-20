import { z } from "zod";

export const updateSettingsSchema = z.object({
  backendHost: z.string().url().optional(),
  defaultModel: z.string().max(200).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
  dataDirectory: z.string().max(500).optional(),
  performanceMode: z.boolean().optional(),
});

export const createConversationSchema = z.object({
  title: z.string().max(120).optional(),
});

export const renameConversationSchema = z.object({
  title: z.string().min(1).max(120),
});

export const streamChatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1),
  model: z.string().min(1),
  host: z.string().url().optional(),
  regenerate: z.boolean().optional(),
});
