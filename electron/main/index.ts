import { app, BrowserWindow } from "electron";
import { initDatabase } from "./services/database";
import { registerAllIpcHandlers } from "./ipc";
import { createMainWindow, revealMainWindow } from "./window";
import { getApiKey } from "./services/keychain";
import { openRouterProvider } from "./providers";

// Surface any uncaught errors so they appear in Electron's log instead of
// disappearing silently (which would leave the app running with no window).
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});

app.whenReady().then(() => {
  // Each setup step is wrapped independently so that a failure in one step
  // (e.g. better-sqlite3 native binary missing in the packaged app) does not
  // prevent the window from being created.  The window itself already has a
  // visible fallback page for renderer-load failures.
  try {
    initDatabase();
  } catch (err) {
    console.error("[main] initDatabase failed:", err);
  }

  try {
    registerAllIpcHandlers();
  } catch (err) {
    console.error("[main] registerAllIpcHandlers failed:", err);
  }

  void openRouterProvider.warmupForToken(getApiKey());

  // Always create the window last — it must be reached even if the steps
  // above throw, otherwise the app runs invisibly (icon in Dock, no window).
  createMainWindow();

  app.on("activate", () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      createMainWindow();
    } else {
      revealMainWindow(windows[0]);
    }
  });
}).catch((err) => {
  // app.whenReady() itself rejected — last-resort log before the process exits.
  console.error("[main] app.whenReady failed:", err);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
