/* global companion */
const $ = (sel) => document.querySelector(sel);

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function setStatus(s) {
  const both = s.relay && s.daemon;
  const any = s.relay || s.daemon;
  const dot = $("#svc-dot");
  dot.className = "dot " + (both ? "on" : any ? "partial" : "off");
  $("#svc-line").textContent = both
    ? `Relay + daemon running${s.relayPid ? ` (pids ${s.relayPid}, ${s.daemonPid})` : ""}`
    : any
      ? `Partial: relay=${s.relay} daemon=${s.daemon}`
      : "Services stopped";
  $("#btn-start").disabled = both;
  $("#btn-stop").disabled = !any;
}

async function refreshOverview() {
  const cfg = await companion.getConfig();
  const health = await companion.health();
  const s = await companion.getStatus();
  setStatus(s);
  $("#overview-status").innerHTML = `
    Gate: ${cfg.gateInstalled ? "installed" : "missing"} ·
    Phone approvals: <strong>${cfg.phoneApprovals ? "ON" : "OFF"}</strong> ·
    Reply: ${cfg.replyMode}
  `;
  if (health && health.ok !== false && health.devices !== undefined) {
    $("#overview-health").textContent = `Relay OK — devices=${health.devices}, live=${health.liveDevices ?? "?"}, pending=${health.pendingApprovals ?? 0}`;
  } else {
    $("#overview-health").textContent = health?.error
      ? `Relay: ${health.error}`
      : "Relay: waiting…";
  }
  if (cfg.lanIp) {
    $("#lan-hint").innerHTML = `This PC LAN: <code>http://${cfg.lanIp}:5173/</code> → relay <code>http://${cfg.lanIp}:8787</code>`;
  }
  $("#chk-phone").checked = !!cfg.phoneApprovals;
  $("#settings-meta").textContent = `Relay ${cfg.relayUrl} · token ${cfg.tokenMasked}`;
}

async function refreshDevices() {
  const list = $("#device-list");
  list.innerHTML = "<div class='meta'>Loading…</div>";
  try {
    const devices = await companion.devices();
    if (!devices.length) {
      list.innerHTML = "<div class='meta'>No paired devices.</div>";
      return;
    }
    list.innerHTML = "";
    for (const d of devices) {
      const row = document.createElement("div");
      row.className = "row";
      const liveLabel = d.online
        ? "Online"
        : d.lastLiveAt
          ? `Last seen ${new Date(d.lastLiveAt).toLocaleString()}`
          : "Never online";
      row.innerHTML = `
        <div style="min-width:0;flex:1">
          <div class="title">
            <span class="dot ${d.online ? "on" : "off"}" title="${d.online ? "Online" : "Offline"}"></span>
            ${escapeHtml(d.name || "phone")}
            <span class="badge ${d.online ? "on" : ""}">${d.online ? "online" : "offline"}</span>
          </div>
          <div class="sub">${escapeHtml(d.id)}</div>
          <div class="sub">${escapeHtml(liveLabel)}</div>
        </div>
        <button type="button" class="btn muted" data-id="${escapeHtml(d.id)}">Revoke</button>
      `;
      row.querySelector("button").onclick = async () => {
        await companion.revoke(d.id);
        toast("Device revoked");
        refreshDevices();
      };
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div class="meta">${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function refreshProjects() {
  const list = $("#project-list");
  list.innerHTML = "<div class='meta'>Scanning…</div>";
  try {
    const items = await companion.projects();
    if (!items.length) {
      list.innerHTML =
        "<div class='meta'>No Cursor project folders found yet.</div>";
      return;
    }
    list.innerHTML = "";
    for (const p of items) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <div style="min-width:0;flex:1">
          <div class="title">${escapeHtml(p.name)}
            <span class="badge ${p.companion ? "on" : ""}">${p.companion ? "enabled" : "off"}</span>
          </div>
          <div class="sub">${escapeHtml(p.path)}</div>
        </div>
        <button type="button" class="btn ${p.companion ? "muted" : "accent"}">
          ${p.companion ? "Remove" : "Enable"}
        </button>
      `;
      row.querySelector("button").onclick = async () => {
        try {
          if (p.companion) await companion.disableProject(p.path);
          else await companion.enableProject(p.path);
          toast(p.companion ? "Hook removed" : "Companion enabled");
          refreshProjects();
        } catch (e) {
          toast(e.message || String(e));
        }
      };
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div class="meta">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let devicesTimer = null;

function showTab(name) {
  if (devicesTimer) {
    clearInterval(devicesTimer);
    devicesTimer = null;
  }
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.id === "tab-" + name);
  });
  if (name === "devices") {
    refreshDevices();
    devicesTimer = setInterval(refreshDevices, 5000);
  }
  if (name === "projects") refreshProjects();
  if (name === "logs") {
    refreshLogs();
    devicesTimer = setInterval(refreshLogs, 3000);
  }
  if (name === "overview" || name === "settings") refreshOverview();
}

async function refreshLogs() {
  const relayEl = $("#log-relay");
  const daemonEl = $("#log-daemon");
  try {
    const logs = await companion.getLogs();
    const relayText = (logs.relay || []).join("\n") || "(no relay output yet)";
    const daemonText =
      (logs.daemon || []).join("\n") || "(no daemon output yet)";
    const stickRelay =
      relayEl.scrollTop + relayEl.clientHeight >= relayEl.scrollHeight - 40;
    const stickDaemon =
      daemonEl.scrollTop + daemonEl.clientHeight >= daemonEl.scrollHeight - 40;
    relayEl.textContent = relayText;
    daemonEl.textContent = daemonText;
    if (stickRelay) relayEl.scrollTop = relayEl.scrollHeight;
    if (stickDaemon) daemonEl.scrollTop = daemonEl.scrollHeight;
  } catch (e) {
    relayEl.textContent = e.message || String(e);
  }
}

document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => showTab(b.dataset.tab));
});

$("#btn-start").onclick = async () => {
  await companion.startServices();
  toast("Starting services…");
  setTimeout(refreshOverview, 1200);
};

$("#btn-stop").onclick = async () => {
  await companion.stopServices();
  toast("Services stopped");
  refreshOverview();
};

$("#btn-pair").onclick = async () => {
  const box = $("#pair-result");
  box.classList.remove("hidden");
  box.innerHTML = "<div class='meta'>Requesting code…</div>";
  try {
    const r = await companion.pair();
    box.innerHTML = `
      <div class="code">${escapeHtml(r.code)}</div>
      <div class="meta">Expires ${new Date(r.expiresAt).toLocaleString()}</div>
      <p class="hint">PWA: <code>${escapeHtml(r.pwaUrl || "http://&lt;LAN&gt;:5173/")}</code></p>
      <p class="hint">Relay URL on phone: <code>${escapeHtml(r.relayUrl)}</code></p>
    `;
  } catch (e) {
    box.innerHTML = `<div class="meta">${escapeHtml(e.message || String(e))}</div>`;
  }
};

$("#btn-refresh-devices").onclick = () => refreshDevices();
$("#btn-refresh-projects").onclick = () => refreshProjects();
$("#btn-logs-refresh").onclick = () => refreshLogs();
$("#btn-restart-all").onclick = async () => {
  toast("Restarting services…");
  await companion.restartServices();
  setTimeout(refreshLogs, 600);
  refreshOverview();
};
$("#btn-restart-relay").onclick = async () => {
  toast("Restarting relay…");
  await companion.restartRelay();
  setTimeout(refreshLogs, 400);
  refreshOverview();
};
$("#btn-restart-daemon").onclick = async () => {
  toast("Restarting daemon…");
  await companion.restartDaemon();
  setTimeout(refreshLogs, 400);
  refreshOverview();
};

$("#chk-phone").onchange = async (e) => {
  await companion.setPhoneApprovals(e.target.checked);
  toast(e.target.checked ? "Phone approvals ON" : "Phone approvals OFF");
  refreshOverview();
};

$("#btn-quit").onclick = () => companion.quit();

companion.onStatus(setStatus);

companion.ensureInstall().then(() => {
  refreshOverview();
  setInterval(refreshOverview, 8000);
});
