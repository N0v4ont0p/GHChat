import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("ghchat", {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },
  send(channel: string, ...args: unknown[]): void {
    ipcRenderer.send(channel, ...args);
  },
  on(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): () => void {
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
