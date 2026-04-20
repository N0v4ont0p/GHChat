export type MessageRole = "user" | "assistant" | "system";

export type BackendStatus =
  | "online"
  | "unreachable"
  | "not_running"
  | "not_detected";

export interface AppSettings {
  backendHost: string;
  defaultModel: string;
  theme: "dark" | "light" | "system";
  dataDirectory: string;
  performanceMode: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  size?: string;
  family?: string;
  modifiedAt?: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}
