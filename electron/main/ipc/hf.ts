import type { IpcMain, IpcMainEvent } from "electron";
import { RECOMMENDED_MODELS, streamChat } from "../services/hf-client";
import { IPC } from "./channels";

interface StreamRequest {
  requestId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  apiKey: string;
}

export function registerHfHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.HF_MODELS_LIST, () => RECOMMENDED_MODELS);

  ipcMain.on(
    IPC.HF_CHAT_STREAM,
    async (event: IpcMainEvent, { requestId, model, messages, apiKey }: StreamRequest) => {
      try {
        for await (const token of streamChat(apiKey, model, messages)) {
          if (event.sender.isDestroyed()) break;
          event.sender.send(IPC.HF_CHAT_TOKEN, { requestId, token });
        }
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.HF_CHAT_END, { requestId });
        }
      } catch (err) {
        if (!event.sender.isDestroyed()) {
          const error = err instanceof Error ? err.message : String(err);
          event.sender.send(IPC.HF_CHAT_ERROR, { requestId, error });
        }
      }
    },
  );
}
