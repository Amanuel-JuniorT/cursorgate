"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companion", {
  getStatus: () => ipcRenderer.invoke("status"),
  startServices: () => ipcRenderer.invoke("services:start"),
  stopServices: () => ipcRenderer.invoke("services:stop"),
  restartServices: () => ipcRenderer.invoke("services:restart"),
  restartRelay: () => ipcRenderer.invoke("services:restartRelay"),
  restartDaemon: () => ipcRenderer.invoke("services:restartDaemon"),
  getLogs: () => ipcRenderer.invoke("logs:get"),
  onStatus: (cb) => {
    const handler = (_e, s) => cb(s);
    ipcRenderer.on("status", handler);
    return () => ipcRenderer.removeListener("status", handler);
  },
  getConfig: () => ipcRenderer.invoke("config:get"),
  setPhoneApprovals: (on) => ipcRenderer.invoke("config:phoneApprovals", on),
  ensureInstall: () => ipcRenderer.invoke("install"),
  pair: () => ipcRenderer.invoke("pair"),
  devices: () => ipcRenderer.invoke("devices"),
  revoke: (id) => ipcRenderer.invoke("devices:revoke", id),
  health: () => ipcRenderer.invoke("health"),
  projects: () => ipcRenderer.invoke("projects"),
  enableProject: (p) => ipcRenderer.invoke("projects:enable", p),
  disableProject: (p) => ipcRenderer.invoke("projects:disable", p),
  show: () => ipcRenderer.invoke("window:show"),
  quit: () => ipcRenderer.invoke("app:quit"),
});
