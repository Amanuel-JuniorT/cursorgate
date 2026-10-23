# Cursor Companion (Full B)

Phone **PWA** (Android Chrome) + **PC daemon** that:

1. Replaces public ntfy for shell **Approve / Deny / Pass**
2. Mirrors local Cursor **agent transcripts** to the phone
3. Pushes **command request** and **agent finished** notifications
4. Accepts **replies from phone** into a PC inbox (honest queue — no stable Cursor inject API yet)

PC must stay **awake** for live sync, approvals, and reply delivery. On wake, the daemon backfills chats.

## Packages

```
companion/
  packages/shared/   protocol helpers
  packages/relay/    WebSocket + HTTP + Web Push hub
  packages/daemon/   CLI, gate runtime, chat watcher, reply inbox
  packages/pwa/      Android-first installable web app
```

## Quick start (Windows)

```powershell
cd companion
npm install
npm run build -w @companion/shared

# Terminal 1 — relay (reachable from phone via LAN IP)
npm run start:relay

# Terminal 2 — install gate + sync token from relay state
npx companion install
npx companion init .
npx companion pair

# Terminal 3 — chat sync + reply worker
npx companion daemon

# Terminal 4 — PWA (optional on PC; on phone use the LAN URL)
npm run dev:pwa
```

On Android Chrome open the **PWA**, not the relay:

| What | URL |
|---|---|
| Phone app (PWA) | `http://<PC-LAN-IP>:5173/` |
| Relay API (pair field only) | `http://<PC-LAN-IP>:8787` |

Example if Wi-Fi is `192.168.3.28`: open `http://192.168.3.28:5173/`, then on Pair set Relay URL to `http://192.168.3.28:8787`.

Opening `:8787` in the browser alone is wrong — that is the API. Use **Add to Home screen** on the `:5173` page after pairing.

Wire shell gate:

```powershell
npx companion on
npx companion doctor
```

Project hook points at `%USERPROFILE%\.companion\runtime\gate.js`.

## Commands

| Command | Purpose |
|---|---|
| `companion install` | Copy gate, migrate `~/.companion.json`, sync daemon token |
| `companion init [path]` | Merge `.cursor/hooks.json` |
| `companion pair` | Show 6-digit phone pairing code |
| `companion devices` / `revoke <id>` | List / revoke phones |
| `companion on` / `off` | Gate kill switch |
| `companion set timeout 120` | Approval (0 = wait forever; warns) |
| `companion set relay http://IP:8787` | Relay URL |
| `companion daemon` | Chat mirror + reply inbox |
| `companion doctor` | Health checks |
| `companion inbox` | Where phone replies land on PC |

## Security

- Approvals no longer use public ntfy topics.
- Pairing codes expire; devices use bearer tokens; `revoke` kills a phone.
- Relay state is stored under `~/.companion/relay/state.json` (mode 0600 when OS allows).
- Never log `user_email`; chat sync redacts emails/tokens best-effort.
- Gate failures always return Cursor `ask` — never accidental auto-allow.
- Expose the relay only on trusted LAN or behind TLS / a tunnel. Do not put it on the open internet without auth hardening.

## Reply-from-phone

Cursor has **no public API** to inject into a local IDE chat ([IDE and CLI sessions are separate](https://forum.cursor.com/t/local-ide-agent-chats-and-the-agent-cli-still-use-separate-session-stores/165486)). On Windows we approximate “send directly”:

1. Phone sends → relay queues
2. `companion daemon` focuses the Cursor window, pastes (`Ctrl+V`), presses `Enter`
3. Status on phone: `delivered_to_cursor` (or clipboard/inbox fallback)

```powershell
npx companion set replyMode paste      # default on Windows — inject into Cursor
npx companion set replyMode clipboard  # copy only; you press Ctrl+V
npx companion set replyMode inbox      # file only (legacy)
```

Keep Cursor open with the **correct chat focused**. If another window is focused, paste may go there — use `clipboard` mode if that happens.

If status stays `queued`, restart `npx companion daemon`.

## If the agent seems frozen

```powershell
npx companion off
npx companion doctor
```

Then fix relay/daemon and `companion on` again.

## Sleep / wake

While the PC sleeps: no approvals, no sync, no reply delivery. After wake, `companion daemon` detects a time gap and **backfills** chats.
