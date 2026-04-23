import { app, BrowserWindow } from "electron";
import { initDatabase } from "./services/database";
import { registerAllIpcHandlers } from "./ipc";
import { createMainWindow } from "./window";
import { getApiKey } from "./services/keychain";
import { openRouterProvider } from "./providers";

app.whenReady().then(() => {
  initDatabase();
  registerAllIpcHandlers();
  void openRouterProvider.warmupForToken(getApiKey());
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
