import { app, BrowserWindow } from "electron";
import { initDatabase } from "./services/database";
import { registerAllIpcHandlers } from "./ipc";
import { createMainWindow, revealMainWindow } from "./window";
import { getApiKey } from "./services/keychain";
import { openRouterProvider } from "./providers";

app.whenReady().then(() => {
  initDatabase();
  registerAllIpcHandlers();
  void openRouterProvider.warmupForToken(getApiKey());
  createMainWindow();

  app.on("activate", () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      createMainWindow();
    } else {
      revealMainWindow(windows[0]);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
