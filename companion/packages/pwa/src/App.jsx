import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clearSession, loadSession, saveSession } from "./storage.js";
import { formatMessage } from "./formatMessage.js";
import {
  ackApproval,
  connectWs,
  decide,
  enablePush,
  getSettings,
  pair,
  sendApprovalAck,
  sendLivePing,
  sendReply,
  setPhoneApprovals,
  snapshot,
} from "./api.js";

/**
 * Default relay URL:
 * - HTTPS / Fly / same-origin PWA → location.origin
 * - Vite dev (:5173) → same host, port 8787
 */
function defaultRelayUrl() {
  try {
    const u = new URL(window.location.href);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    if (
      u.protocol === "https:" ||
      port === "8787" ||
      port === "443" ||
      port === "80"
    ) {
      return u.origin;
    }
    if (port === "5173") {
      u.port = "8787";
      u.pathname = "/";
      u.search = "";
      u.hash = "";
      return u.origin;
    }
    return u.origin;
  } catch {
    return "http://127.0.0.1:8787";
  }
}

function PairScreen({ onPaired }) {
  const [relayUrl, setRelayUrl] = useState(
    () => localStorage.getItem("companion.relayUrl") || defaultRelayUrl()
  );
  const [code, setCode] = useState("");
  const [name, setName] = useState("Android");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      localStorage.setItem("companion.relayUrl", relayUrl);
      const data = await pair(relayUrl, code.trim(), name.trim() || "phone");
      const session = {
        relayUrl: relayUrl.replace(/\/$/, ""),
        deviceId: data.deviceId,
        token: data.token,
        name: data.name,
      };
      saveSession(session);
      onPaired(session);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">Companion</div>
      </div>
      <p className="hint">
        Pair with your PC. On the PC run <code>companion pair</code>, then enter
        the code. Use your PC&apos;s LAN IP (not 127.0.0.1) so the phone can reach
        the relay.
      </p>
      <form className="card" onSubmit={submit}>
        <label>Relay URL</label>
        <input
          value={relayUrl}
          onChange={(e) => setRelayUrl(e.target.value)}
          placeholder="http://192.168.x.x:8787"
          autoComplete="off"
        />
        <label>Pairing code</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          placeholder="6-digit code"
          required
        />
        <label>Device name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        {error ? (
          <p className="hint" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
        <div style={{ marginTop: 14 }}>
          <button className="btn-accent" type="submit" disabled={busy}>
            {busy ? "Pairing…" : "Pair device"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ApprovalCard({ item, onDecide, onDismiss }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const act = async (decision) => {
    setBusy(true);
    setErr("");
    try {
      await onDecide(item.id, decision);
    } catch (e) {
      setErr(e.message || String(e));
      // Still drop the card if it was already settled on the PC
      onDismiss?.(item.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>Shell approval</h2>
      <div className="meta">{item.project}</div>
      <div className="cmd">{item.command}</div>
      {err ? (
        <p className="hint" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}
      <div className="row">
        <button className="btn-ok" disabled={busy} onClick={() => act("approve")}>
          Approve
        </button>
        <button
          className="btn-danger"
          disabled={busy}
          onClick={() => act("deny")}
        >
          Deny
        </button>
        <button
          className="btn-muted"
          disabled={busy}
          onClick={() => act("pass")}
        >
          Pass
        </button>
      </div>
    </div>
  );
}

function groupChatsByProject(chats) {
  const map = new Map();
  for (const c of chats) {
    const key = c.project || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  }
  return [...map.entries()]
    .map(([project, items]) => ({
      project,
      items: items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
      updatedAt: Math.max(...items.map((i) => i.updatedAt || 0)),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function ProjectList({ chats, onOpenProject }) {
  const groups = useMemo(() => groupChatsByProject(chats), [chats]);
  if (!groups.length) {
    return (
      <div className="empty">
        No mirrored chats yet. Keep the PC awake and run{" "}
        <code>companion daemon</code>, then pull to refresh in Settings.
      </div>
    );
  }
  return groups.map((g) => (
    <button
      key={g.project}
      className="card project-card"
      type="button"
      onClick={() => onOpenProject(g.project)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ margin: 0 }}>{g.project}</h2>
        <span className="badge">{g.items.length} chat{g.items.length === 1 ? "" : "s"}</span>
      </div>
      <div className="meta">
        {g.items[0]?.title || "Chat"} ·{" "}
        {g.updatedAt ? new Date(g.updatedAt).toLocaleString() : ""}
      </div>
    </button>
  ));
}

function ChatList({ chats, project, onOpen, onBack }) {
  const items = chats
    .filter((c) => (c.project || "Other") === project)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return (
    <div>
      <button className="btn-muted" style={{ marginBottom: 10 }} type="button" onClick={onBack}>
        ← Projects
      </button>
      <h2 className="section-title">{project}</h2>
      {!items.length ? (
        <div className="empty">No chats in this project.</div>
      ) : (
        items.map((c) => (
          <button
            key={c.id}
            className="card"
            type="button"
            style={{
              width: "100%",
              textAlign: "left",
              border: 0,
              color: "inherit",
              cursor: "pointer",
            }}
            onClick={() => onOpen(c.id)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: "0.95rem" }}>{c.title || "Chat"}</h2>
              <span className={`badge ${c.status || ""}`}>{c.status || "idle"}</span>
            </div>
            <div className="meta">
              {c.updatedAt ? new Date(c.updatedAt).toLocaleString() : ""}
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function ChatView({ chat, replies, onBack, onReply }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const listRef = useRef(null);
  const stickBottom = useRef(true);
  const messages = chat.messages || [];
  const related = replies.filter((r) => r.chatId === chat.id).slice(-5);

  const scrollToBottom = useCallback((behavior = "smooth") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickBottom.current = true;
    setShowJump(false);
  }, []);

  const onMessagesScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = dist < 80;
    stickBottom.current = nearBottom;
    setShowJump(!nearBottom && el.scrollHeight > el.clientHeight + 40);
  };

  useEffect(() => {
    stickBottom.current = true;
    setShowJump(false);
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [chat.id, scrollToBottom]);

  useEffect(() => {
    if (!stickBottom.current) {
      setShowJump(true);
      return;
    }
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messages.length, scrollToBottom]);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      stickBottom.current = true;
      await onReply(chat.id, text.trim());
      setText("");
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (r) => {
    if (r.status === "queued") return "Sending to PC…";
    if (r.status === "delivered_to_cursor") return "Sent into Cursor";
    if (r.status === "delivered_to_clipboard") return "On PC clipboard";
    if (r.status === "delivered_to_inbox") return "On PC inbox file";
    return r.status;
  };

  return (
    <div>
      <button className="btn-muted" style={{ marginBottom: 10 }} type="button" onClick={onBack}>
        ← Chats
      </button>
      <div className="card">
        <h2>{chat.project}</h2>
        <div className="meta">{chat.title}</div>
        <div className="messages-wrap">
          <div
            className="messages"
            ref={listRef}
            onScroll={onMessagesScroll}
          >
            {messages.map((m) => {
              const { timestamp, body } = formatMessage(m.content);
              const isUser =
                m.role === "user" || m.role === "human" || m.fromPhone;
              return (
                <div
                  key={m.id}
                  className={`bubble ${isUser ? "user" : "assistant"}`}
                >
                  {timestamp ? (
                    <div className="bubble-time">{timestamp}</div>
                  ) : null}
                  <div className="bubble-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {body}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}
          </div>
          {showJump ? (
            <button
              type="button"
              className="jump-latest"
              onClick={() => scrollToBottom("smooth")}
              aria-label="Jump to latest"
            >
              ↓ Latest
            </button>
          ) : null}
        </div>
        <form onSubmit={submit}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply from phone…"
          />
          <p className="hint">
            On Windows the PC daemon pastes into the focused Cursor chat
            (clipboard → Ctrl+V → Enter). Keep Cursor open on the right chat.
            Fallback: clipboard / inbox file if paste fails.
          </p>
          <button className="btn-accent" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send to Cursor"}
          </button>
        </form>
        {related.map((r) => (
          <div key={r.id} className="reply-status">
            {statusLabel(r)}
            {r.detail ? ` — ${String(r.detail).slice(0, 80)}` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function MainApp({ session, onLogout }) {
  const [tab, setTab] = useState("approvals");
  const [approvals, setApprovals] = useState([]);
  const [chats, setChats] = useState([]);
  const [replies, setReplies] = useState([]);
  const [openProject, setOpenProject] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [phoneApprovals, setPhoneApprovalsState] = useState(false);
  const [approvalsBusy, setApprovalsBusy] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(null);
  const wsRef = useRef(null);

  const applySnapshot = useCallback((snap) => {
    if (snap.approvals) {
      setApprovals(
        snap.approvals.filter((a) => !a.status || a.status === "pending")
      );
    }
    if (snap.chats) setChats(snap.chats);
    if (snap.replyQueue) setReplies(snap.replyQueue);
    if (snap.settings && typeof snap.settings.phoneApprovals === "boolean") {
      setPhoneApprovalsState(snap.settings.phoneApprovals);
    }
  }, []);

  const refresh = useCallback(async () => {
    const snap = await snapshot(session.relayUrl, session.token);
    applySnapshot(snap);
    try {
      const s = await getSettings(session.relayUrl, session.token);
      setPhoneApprovalsState(s.phoneApprovals === true);
    } catch {
      /* ignore */
    }
  }, [session, applySnapshot]);

  useEffect(() => {
    refresh().catch(() => {});
    (async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          setPushSubscribed(false);
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setPushSubscribed(!!sub);
      } catch {
        setPushSubscribed(false);
      }
    })();
    const ws = connectWs(session.relayUrl, session.token, (msg) => {
      if (msg.type === "hello") setConnected(true);
      if (msg.type === "state_snapshot") applySnapshot(msg);
      if (msg.type === "settings" && msg.settings) {
        setPhoneApprovalsState(msg.settings.phoneApprovals === true);
      }
      if (msg.type === "approval_request" && msg.approval) {
        // Prove the UI is alive — gate waits ~5s for this ACK
        sendApprovalAck(wsRef.current, msg.approval.id);
        ackApproval(session.relayUrl, session.token, msg.approval.id).catch(
          () => {}
        );
        setApprovals((prev) => {
          const rest = prev.filter((a) => a.id !== msg.approval.id);
          return [msg.approval, ...rest];
        });
        setTab("approvals");
        // Local banner when Web Push isn't subscribed (or app is open)
        try {
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            const a = msg.approval;
            new Notification(`Cursor · ${a.project || "shell"}`, {
              body: String(a.command || "").slice(0, 120),
              tag: `approval-${a.id}`,
            });
          }
        } catch {
          /* ignore */
        }
      }
      if (msg.type === "approval_settled" && msg.approval) {
        setApprovals((prev) => prev.filter((a) => a.id !== msg.approval.id));
      }
      if (msg.type === "chat_upsert" && msg.chat) {
        setChats((prev) => {
          const rest = prev.filter((c) => c.id !== msg.chat.id);
          return [
            { ...msg.chat, messages: msg.messages || msg.chat.messages || [] },
            ...rest,
          ];
        });
      }
      if (msg.type === "agent_finished") {
        setChats((prev) =>
          prev.map((c) =>
            c.id === msg.chatId ? { ...c, status: "finished" } : c
          )
        );
      }
      if (msg.type === "reply_status" && msg.reply) {
        setReplies((prev) => {
          const rest = prev.filter((r) => r.id !== msg.reply.id);
          return [...rest, msg.reply];
        });
      }
      if (msg.type === "reply_queue" && msg.reply) {
        setReplies((prev) => [...prev, msg.reply]);
      }
      if (msg.type === "revoke_device") {
        clearSession();
        onLogout();
      }
    });
    ws.onopen = () => {
      setConnected(true);
      sendLivePing(ws);
    };
    ws.onclose = () => setConnected(false);
    wsRef.current = ws;
    const beat = setInterval(() => sendLivePing(wsRef.current), 10000);
    return () => {
      clearInterval(beat);
      ws.close();
    };
  }, [session, applySnapshot, onLogout]);

  const dismissApproval = (id) => {
    setApprovals((prev) => prev.filter((a) => a.id !== id));
  };

  const onDecide = async (id, decision) => {
    await decide(session.relayUrl, session.token, id, decision);
    dismissApproval(id);
  };

  const onReply = async (chatId, text) => {
    const chat = chats.find((c) => c.id === chatId);
    const { reply } = await sendReply(
      session.relayUrl,
      session.token,
      chatId,
      text,
      { project: chat?.project || null, title: chat?.title || null }
    );
    setReplies((prev) => [...prev, reply]);
  };

  const openChat = useMemo(
    () => chats.find((c) => c.id === openId) || null,
    [chats, openId]
  );

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className={`status-dot ${connected ? "on" : ""}`} />
          Companion
        </div>
        <button
          className="btn-muted"
          style={{ padding: "8px 12px", width: "auto" }}
          onClick={() => {
            clearSession();
            onLogout();
          }}
        >
          Unpair
        </button>
      </div>

      <div className="tabs">
        <button
          className={tab === "approvals" ? "active" : ""}
          onClick={() => {
            setTab("approvals");
            setOpenId(null);
            setOpenProject(null);
          }}
        >
          Approvals
          {approvals.length ? ` (${approvals.length})` : ""}
        </button>
        <button
          className={tab === "chats" ? "active" : ""}
          onClick={() => {
            setTab("chats");
            setOpenId(null);
            setOpenProject(null);
          }}
        >
          Chats
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>

      {tab === "approvals" && (
        <>
          {!approvals.length ? (
            <div className="empty">No pending shell commands.</div>
          ) : (
            <>
              <p className="hint" style={{ marginBottom: 10 }}>
                Approve/Deny here while Cursor is waiting. If you already ran it
                on the PC, tap Refresh in Settings to clear stale cards.
              </p>
              {approvals.map((a) => (
                <ApprovalCard
                  key={a.id}
                  item={a}
                  onDecide={onDecide}
                  onDismiss={dismissApproval}
                />
              ))}
            </>
          )}
        </>
      )}

      {tab === "chats" &&
        (openChat ? (
          <ChatView
            chat={openChat}
            replies={replies}
            onBack={() => setOpenId(null)}
            onReply={onReply}
          />
        ) : openProject ? (
          <ChatList
            chats={chats}
            project={openProject}
            onOpen={setOpenId}
            onBack={() => setOpenProject(null)}
          />
        ) : (
          <ProjectList chats={chats} onOpenProject={setOpenProject} />
        ))}

      {tab === "settings" && (
        <div className="card">
          <h2>Device</h2>
          <div className="meta">
            {session.name} · {session.deviceId.slice(0, 8)}…
          </div>
          <p className="hint">Relay: {session.relayUrl}</p>
          <p className="hint">
            PC must stay awake for live sync, approvals, and reply delivery.
            Sleep pauses everything until wake + daemon backfill.
          </p>

          <h2 style={{ marginTop: 16 }}>Shell approvals</h2>
          <p className="hint">
            Off (default): Cursor prompts on the PC. On: phone gets Approve/Deny
            only while this app is open and healthy.
          </p>
          <button
            className={phoneApprovals ? "btn-ok" : "btn-muted"}
            style={{ marginTop: 10, width: "100%", border: 0, borderRadius: 12, padding: "12px 16px", fontWeight: 600 }}
            disabled={approvalsBusy}
            type="button"
            onClick={async () => {
              setApprovalsBusy(true);
              try {
                const next = !phoneApprovals;
                const s = await setPhoneApprovals(
                  session.relayUrl,
                  session.token,
                  next
                );
                setPhoneApprovalsState(s.phoneApprovals === true);
              } catch (e) {
                setPushMsg(e.message || String(e));
              } finally {
                setApprovalsBusy(false);
              }
            }}
          >
            {approvalsBusy
              ? "Saving…"
              : phoneApprovals
                ? "Phone approvals: ON — tap to turn off"
                : "Phone approvals: OFF — tap to turn on"}
          </button>
          <p className="hint" style={{ marginTop: 8 }}>
            PC escape:{" "}
            <code>companion set phoneApprovals false</code>
          </p>

          <button
            className="btn-accent"
            style={{ marginTop: 14 }}
            onClick={async () => {
              const r = await enablePush(session.relayUrl, session.token);
              setPushMsg(r.ok ? "Push enabled" : r.reason);
              if (r.ok) setPushSubscribed(true);
            }}
          >
            {pushSubscribed
              ? "Push notifications: ON (tap to refresh)"
              : "Enable push notifications"}
          </button>
          {pushSubscribed === false ? (
            <p className="hint" style={{ color: "var(--warn)" }}>
              No push subscription — approvals only appear while the PWA is open.
              Tap Enable (and Allow) for lock-screen alerts.
            </p>
          ) : null}
          {pushMsg ? <p className="hint">{pushMsg}</p> : null}
          <button
            className="btn-muted"
            style={{ marginTop: 10 }}
            onClick={() => refresh()}
          >
            Refresh snapshot
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => loadSession());

  if (!session?.token) {
    return <PairScreen onPaired={setSession} />;
  }
  return (
    <MainApp
      session={session}
      onLogout={() => setSession(null)}
    />
  );
}
