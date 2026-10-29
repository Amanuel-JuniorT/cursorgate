# Deploy Companion relay on Fly.io

Stable HTTPS URL for the phone PWA + cloud relay. PC daemon connects outbound (no Cloudflare Tunnel).

## Prerequisites

- `fly auth login` (done)
- Payment method on Fly (required to create apps)

## Deploy (first time)

```powershell
cd C:\Users\Home\Documents\TAC\Project\Swiss-knife\companion

# Create volume in the same region as fly.toml (fra)
fly volumes create companion_data --region fra --size 1

fly deploy
```

If the app name `companion-relay-aman` is taken, edit `fly.toml` → `app = "…"`.

After deploy:

```powershell
fly status
fly logs
curl https://companion-relay-aman.fly.dev/health
```

Open the same URL on your phone — that is the PWA.

## Get the daemon token

On first boot the relay creates a daemon token in the volume.

```powershell
fly ssh console -C "node -e \"const s=require('fs').readFileSync('/data/state.json','utf8'); console.log(JSON.parse(s).daemonToken)\""
```

Put that into PC `~/.companion.json`:

```json
{
  "relayUrl": "https://companion-relay-aman.fly.dev",
  "daemonToken": "<paste>"
}
```

Restart Companion Desktop / daemon.

## Pair phone

1. On PC: start pairing (`companion pair` or Desktop → Pair)
2. Phone: open `https://<your-app>.fly.dev` → enter code  
3. Install PWA + enable push

## Useful commands

```powershell
fly deploy          # ship code changes
fly logs            # live logs
fly ssh console     # shell on the VM
fly scale count 1   # keep one machine (needed for WS)
```

Do **not** enable `auto_stop_machines` — WebSockets need a warm process.
