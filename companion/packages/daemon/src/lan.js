"use strict";
const os = require("os");

/**
 * Pick likely Wi-Fi / LAN IPv4 addresses the phone can reach.
 * Skips localhost, link-local, and common VM/host-only ranges.
 */
function listLanIpv4() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(nets || {})) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family !== "IPv4" && a.family !== 4) continue;
      if (a.internal) continue;
      const ip = a.address;
      if (ip.startsWith("169.254.")) continue; // link-local
      // Prefer real LAN; still list VM adapters but mark them.
      const vm =
        /vmware|virtualbox|vbox|hyper-v|vethernet|loopback|docker|wsl/i.test(name) ||
        ip.startsWith("192.168.56.") ||
        ip.startsWith("192.168.44.") ||
        ip.startsWith("192.168.210.");
      out.push({ name, ip, vm });
    }
  }
  out.sort((a, b) => Number(a.vm) - Number(b.vm));
  return out;
}

function bestLanIp() {
  const list = listLanIpv4();
  const preferred = list.find((x) => !x.vm);
  return preferred?.ip || list[0]?.ip || null;
}

module.exports = { listLanIpv4, bestLanIp };
