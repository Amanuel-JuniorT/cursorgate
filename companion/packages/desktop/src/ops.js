"use strict";
const fs = require("fs");
const path = require("path");
const { daemonRequire } = require("./daemonRequire.js");

const {
  loadConfig,
  saveConfig,
  ensureConfig,
  readRelayDaemonToken,
  maskToken,
} = daemonRequire("src/config.js");
const { RelayClient } = daemonRequire("src/relayClient.js");
const { listLanIpv4, bestLanIp } = daemonRequire("src/lan.js");
const { gatePath, installDir } = daemonRequire("src/paths.js");

function getConfigView() {
  let cfg = loadConfig();
  if (!cfg) {
    cfg = ensureConfig({ daemonToken: readRelayDaemonToken() });
  }
  return {
    relayUrl: cfg.relayUrl,
    phoneApprovals: cfg.phoneApprovals === true,
    replyMode: cfg.replyMode || "paste",
    replySubmit: cfg.replySubmit || "enter",
    timeoutSeconds: cfg.timeoutSeconds,
    enabled: cfg.enabled !== false,
    tokenMasked: maskToken(cfg.daemonToken),
    gateInstalled: fs.existsSync(gatePath()),
    lanIp: bestLanIp(),
    lans: listLanIpv4(),
  };
}

function clientFromConfig() {
  let cfg = loadConfig();
  if (!cfg?.daemonToken) {
    cfg = ensureConfig({ daemonToken: readRelayDaemonToken() });
  }
  if (!cfg?.daemonToken) throw new Error("No daemon token — start relay first");
  return { cfg, client: new RelayClient(cfg) };
}

async function relayHealth() {
  try {
    const { client } = clientFromConfig();
    return await client.health();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function startPairing() {
  const { client, cfg } = clientFromConfig();
  const { code, expiresAt } = await client.startPairing();
  const lan = bestLanIp();
  return {
    code,
    expiresAt,
    pwaUrl: lan ? `http://${lan}:5173/` : null,
    relayUrl: lan ? `http://${lan}:8787` : cfg.relayUrl,
  };
}

const LIVE_MS = 30_000;

async function listDevices() {
  const { client } = clientFromConfig();
  const data = await client.listDevices();
  const now = Date.now();
  return (data.devices || [])
    .map((d) => {
      const liveAt = d.lastLiveAt || null;
      const online = !!(liveAt && now - liveAt <= LIVE_MS);
      return {
        ...d,
        online,
        lastLiveAt: liveAt,
      };
    })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      const ta = a.lastLiveAt || 0;
      const tb = b.lastLiveAt || 0;
      return tb - ta;
    });
}

async function revokeDevice(id) {
  const { client } = clientFromConfig();
  return client.revokeDevice(id);
}

async function setPhoneApprovals(on) {
  const cfg = ensureConfig({});
  cfg.phoneApprovals = !!on;
  saveConfig(cfg);
  try {
    const { client } = clientFromConfig();
    await client.setSettings({ phoneApprovals: cfg.phoneApprovals });
  } catch {
    /* relay may be down */
  }
  return getConfigView();
}

function ensureInstall() {
  fs.mkdirSync(installDir(), { recursive: true });
  const src = path.join(
    path.resolve(__dirname, "..", "..", "daemon", "src", "gate.js")
  );
  if (fs.existsSync(src)) fs.copyFileSync(src, gatePath());
  ensureConfig({ daemonToken: readRelayDaemonToken() });
  return getConfigView();
}

module.exports = {
  getConfigView,
  relayHealth,
  startPairing,
  listDevices,
  revokeDevice,
  setPhoneApprovals,
  ensureInstall,
};
