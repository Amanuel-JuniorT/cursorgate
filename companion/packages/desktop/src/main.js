"use strict";
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
} = require("electron");
const path = require("path");
const services = require("./services.js");
const ops = require("./ops.js");
const projects = require("./projects.js");
const { rendererDir, assetsDir } = require("./paths.js");

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {Tray|null} */
let tray = null;
let quitting = false;

function trayIcon() {
  const iconPath = path.join(assetsDir(), "tray.png");
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
  } catch {
    /* fall through */
  }
  // 16x16 blue-ish PNG as base64 fallback
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANElEQVQ4T2NkYGD4z0ABYBzVMKoBBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYAAAD//wMAAf8D/qYAAAAASUVORK5CYII=";
  return nativeImage.createFromDataURL("data:image/png;base64," + b64);
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 520,
    minHeight: 480,
    title: "Companion",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(rendererDir(), "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  return mainWindow;
}

function broadcastStatus() {
  const s = services.snapshot();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status", s);
  }
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const s = services.snapshot();
  const template = [
    {
      label: "Open Companion",
      click: () => createWindow(),
    },
    { type: "separator" },
    {
      label: s.relay && s.daemon ? "Services: running" : "Services: stopped",
      enabled: false,
    },
    {
      label: "Start services",
      enabled: !(s.relay && s.daemon),
      click: () => {
        services.startAll();
        broadcastStatus();
      },
    },
    {
      label: "Stop services",
      enabled: !!(s.relay || s.daemon),
      click: () => {
        services.stopAll();
        broadcastStatus();
      },
    },
    { type: "separator" },
    {
      label: "Quit Companion",
      click: () => {
        quitting = true;
        services.stopAll();
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(
    s.relay && s.daemon
      ? "Companion — running"
      : "Companion — services stopped"
  );
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on("double-click", () => createWindow());
  updateTrayMenu();
}

function registerIpc() {
  ipcMain.handle("status", () => services.snapshot());
  ipcMain.handle("services:start", () => {
    const s = services.startAll();
    broadcastStatus();
    return s;
  });
  ipcMain.handle("services:stop", () => {
    const s = services.stopAll();
    broadcastStatus();
    return s;
  });
  ipcMain.handle("services:restart", async () => {
    const s = await services.restartAll();
    broadcastStatus();
    return s;
  });
  ipcMain.handle("services:restartRelay", async () => {
    const s = await services.restartRelay();
    broadcastStatus();
    return s;
  });
  ipcMain.handle("services:restartDaemon", async () => {
    const s = await services.restartDaemon();
    broadcastStatus();
    return s;
  });
  ipcMain.handle("logs:get", () => services.getLogs());
  ipcMain.handle("config:get", () => ops.getConfigView());
  ipcMain.handle("config:phoneApprovals", (_e, on) =>
    ops.setPhoneApprovals(!!on)
  );
  ipcMain.handle("install", () => ops.ensureInstall());
  ipcMain.handle("pair", () => ops.startPairing());
  ipcMain.handle("devices", () => ops.listDevices());
  ipcMain.handle("devices:revoke", (_e, id) => ops.revokeDevice(id));
  ipcMain.handle("health", () => ops.relayHealth());
  ipcMain.handle("projects", () => projects.listProjects());
  ipcMain.handle("projects:enable", (_e, p) => projects.enableProject(p));
  ipcMain.handle("projects:disable", (_e, p) => projects.disableProject(p));
  ipcMain.handle("window:show", () => {
    createWindow();
    return true;
  });
  ipcMain.handle("app:quit", () => {
    quitting = true;
    services.stopAll();
    app.quit();
    return true;
  });
}

app.whenReady().then(() => {
  ops.ensureInstall();
  createTray();
  registerIpc();
  services.onStatus(() => broadcastStatus());
  services.startAll();
  createWindow();

  app.on("activate", () => createWindow());
});

app.on("window-all-closed", (e) => {
  // Stay in tray on Windows/Linux
  e.preventDefault?.();
});

app.on("before-quit", () => {
  quitting = true;
  services.stopAll();
});
