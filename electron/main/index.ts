import { app, BrowserWindow } from "electron";
import { initDatabase } from "./services/database";
import { registerAllIpcHandlers } from "./ipc";
import { createMainWindow, revealMainWindow } from "./window";
import { getApiKey } from "./services/keychain";
import { openRouterProvider } from "./providers";
import { storageService } from "./services/offline";

// Surface any uncaught errors so they appear in Electron's log instead of
// disappearing silently (which would leave the app running with no window).
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});

app.whenReady().then(async () => {
  console.log("[main] app ready — version:", app.getVersion(), "electron:", process.versions.electron);

  // Each setup step is wrapped independently so that a failure in one step
  // does not prevent the window from being created.  The window itself already
  // has a visible fallback page for renderer-load failures.
  try {
    await initDatabase();
    console.log("[main] database init OK");
  } catch (err) {
    console.error("[main] database init FAILED:", err);
  }

  // Ensure the GHchat-managed offline directory tree exists under the
  // platform-specific persistent root (Application Support / LocalAppData).
  // This is a no-op if the directories were already created on a previous run.
  try {
    storageService.ensureDirectories();
    console.log("[main] offline storage dirs ensured at:", storageService.getOfflineRoot());
  } catch (err) {
    console.error("[main] offline storage dir creation FAILED:", err);
  }

  try {
    registerAllIpcHandlers();
    console.log("[main] IPC handlers registered");
  } catch (err) {
    console.error("[main] IPC handler registration FAILED:", err);
  }

  const apiKey = getApiKey();
  console.log("[main] keychain warmup: starting (key present:", apiKey.length > 0, ")");
  openRouterProvider
    .warmupForToken(apiKey)
    .then(() => console.log("[main] keychain warmup: done"))
    .catch((err: unknown) => console.error("[main] keychain warmup: failed:", err));

  // Always create the window last — it must be reached even if the steps
  // above throw, otherwise the app runs invisibly (icon in Dock, no window).
  const win = createMainWindow();
  console.log("[main] window created (id:", win.id, ")");

  app.on("activate", () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      createMainWindow();
    } else {
      revealMainWindow(windows[0]);
    }
  });
}).catch((err) => {
  // app.whenReady() itself rejected — log and quit so the process doesn't
  // linger invisibly as a Dock/menu-bar ghost with no window.
  console.error("[main] app.whenReady FAILED:", err);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

