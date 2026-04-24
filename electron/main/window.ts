import { BrowserWindow, Rectangle, screen, shell } from "electron";
import { join } from "path";

const WINDOW_BACKGROUND = "#09090b";
const OFFSCREEN_VISIBLE_AREA_THRESHOLD = 0.2;
const RECOVER_BOUNDS_WITH_ANIMATION = false;

const FALLBACK_HTML = encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GHchat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: #09090b; color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { display: flex; align-items: center; justify-content: center; -webkit-app-region: drag; }
    .box { text-align: center; max-width: 320px; padding: 2rem; -webkit-app-region: no-drag; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
    p { font-size: 0.875rem; color: #6b7280; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="box">
    <h1>GHchat failed to start</h1>
    <p>The renderer could not be loaded.<br/>Please restart the app.</p>
  </div>
</body>
</html>`);

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: WINDOW_BACKGROUND,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  const showWindow = () => {
    if (!win.isDestroyed()) {
      revealMainWindow(win);
    }
  };

  const loadFallback = (reason: string) => {
    console.error("[window] renderer fallback:", reason);
    // Load a visible fallback page so the window is never blank/transparent
    void win.webContents
      .loadURL("data:text/html;charset=utf-8," + FALLBACK_HTML)
      .then(showWindow)
      .catch(showWindow);
  };

  win.once("ready-to-show", showWindow);
  const safetyShowTimeout = setTimeout(showWindow, 2500);
  win.once("show", () => clearTimeout(safetyShowTimeout));
  win.once("closed", () => clearTimeout(safetyShowTimeout));

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    loadFallback(`did-fail-load (${code}): ${desc}`);
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    loadFallback(`render-process-gone: ${details.reason}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

function getDisplayWorkArea(targetBounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(targetBounds);
  return display.workArea;
}

function isMostlyOffscreen(windowBounds: Rectangle, visibleBounds: Rectangle): boolean {
  if (windowBounds.width <= 0 || windowBounds.height <= 0) return true;

  const intersectionLeft = Math.max(windowBounds.x, visibleBounds.x);
  const intersectionTop = Math.max(windowBounds.y, visibleBounds.y);
  const intersectionRight = Math.min(
    windowBounds.x + windowBounds.width,
    visibleBounds.x + visibleBounds.width,
  );
  const intersectionBottom = Math.min(
    windowBounds.y + windowBounds.height,
    visibleBounds.y + visibleBounds.height,
  );
  const visibleWidth = Math.max(0, intersectionRight - intersectionLeft);
  const visibleHeight = Math.max(0, intersectionBottom - intersectionTop);
  const visibleArea = visibleWidth * visibleHeight;
  const windowArea = windowBounds.width * windowBounds.height;
  return visibleArea / windowArea < OFFSCREEN_VISIBLE_AREA_THRESHOLD;
}

function centerInsideVisibleArea(windowBounds: Rectangle, visibleBounds: Rectangle): Rectangle {
  const width = Math.min(windowBounds.width, visibleBounds.width);
  const height = Math.min(windowBounds.height, visibleBounds.height);
  const x = Math.round(visibleBounds.x + (visibleBounds.width - width) / 2);
  const y = Math.round(visibleBounds.y + (visibleBounds.height - height) / 2);
  return { x, y, width, height };
}

export function revealMainWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) {
    win.restore();
  }

  const bounds = win.getBounds();
  const visibleBounds = getDisplayWorkArea(bounds);
  if (isMostlyOffscreen(bounds, visibleBounds)) {
    const centered = centerInsideVisibleArea(bounds, visibleBounds);
    win.setBounds(centered, RECOVER_BOUNDS_WITH_ANIMATION);
  }

  win.show();
  win.focus();
}
