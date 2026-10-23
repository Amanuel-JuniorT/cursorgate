export function apiBase(relayUrl) {
  return relayUrl.replace(/\/$/, "");
}

export async function pair(relayUrl, code, name) {
  const r = await fetch(`${apiBase(relayUrl)}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "pair failed");
  return data;
}

export async function snapshot(relayUrl, token) {
  const r = await fetch(`${apiBase(relayUrl)}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "snapshot failed");
  return data;
}

export async function decide(relayUrl, token, id, decision) {
  const r = await fetch(`${apiBase(relayUrl)}/approvals/${id}/decide`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ decision }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "decide failed");
  return data;
}

export async function ackApproval(relayUrl, token, id) {
  const r = await fetch(`${apiBase(relayUrl)}/approvals/${id}/ack`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("ack failed");
  return r.json();
}

export async function getSettings(relayUrl, token) {
  const r = await fetch(`${apiBase(relayUrl)}/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "settings failed");
  return data.settings || { phoneApprovals: false };
}

export async function setPhoneApprovals(relayUrl, token, phoneApprovals) {
  const r = await fetch(`${apiBase(relayUrl)}/settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ phoneApprovals: !!phoneApprovals }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "settings failed");
  return data.settings || { phoneApprovals: false };
}

export async function sendReply(relayUrl, token, chatId, text, extra = {}) {
  const r = await fetch(`${apiBase(relayUrl)}/replies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chatId,
      text,
      project: extra.project || null,
      title: extra.title || null,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "reply failed");
  return data;
}

export async function getVapidKey(relayUrl) {
  const r = await fetch(`${apiBase(relayUrl)}/vapidPublicKey`);
  const data = await r.json();
  if (!r.ok) throw new Error("vapid failed");
  return data.publicKey;
}

export async function pushSubscribe(relayUrl, token, subscription) {
  const r = await fetch(`${apiBase(relayUrl)}/push/subscribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(subscription),
  });
  if (!r.ok) throw new Error("push subscribe failed");
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(relayUrl, token) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "Push not supported in this browser" };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Notification permission denied" };
  }
  const reg = await navigator.serviceWorker.ready;
  const vapid = await getVapidKey(relayUrl);
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid),
  });
  await pushSubscribe(relayUrl, token, sub.toJSON());
  return { ok: true };
}

export function connectWs(relayUrl, token, onMessage) {
  const u = new URL(apiBase(relayUrl));
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = `?role=device&token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(u.toString());
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
  return ws;
}

/** App-level heartbeat — only call while the main UI is mounted and healthy. */
export function sendLivePing(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "ping", live: true, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function sendApprovalAck(ws, id) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !id) return;
  try {
    ws.send(JSON.stringify({ type: "approval_ack", id }));
  } catch {
    /* ignore */
  }
}
