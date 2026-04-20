import type { IpcRendererEvent } from "electron";

interface GHChatAPI {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, ...args: unknown[]): void;
  on(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): () => void;
}

declare global {
  interface Window {
    ghchat: GHChatAPI;
  }
}
