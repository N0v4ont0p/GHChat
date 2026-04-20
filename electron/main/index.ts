import { app, BrowserWindow } from "electron";
import { initDatabase } from "./services/database";
import { registerAllIpcHandlers } from "./ipc";
import { createMainWindow } from "./window";

app.whenReady().then(() => {
  initDatabase();
  registerAllIpcHandlers();
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
