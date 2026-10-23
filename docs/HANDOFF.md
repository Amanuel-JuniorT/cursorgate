# Handoff: Cursor Phone Approval Gate → cursorgate CLI

> Paste this folder into the dedicated project workspace and open `HANDOFF.md` +
> `CURSORGATE_CLI_SPEC.md` for the implementing agent.
> Chat context does **not** continue across Cursor workspaces.

## Goal for the next chat

Build the `cursorgate` CLI git repo per:

`03-project-prototype/.cursor/CURSORGATE_CLI_SPEC.md`

**Refactor** the working `gate.js` into that tool. **Do not rewrite behavior.**
Ask before anything not in the spec. Migrate existing `out`/`in` topics so the phone
does not need to re-subscribe.

## Original locations on the test machine

| Role | Original path |
|---|---|
| Config | `C:\Users\Home\.companion.json` |
| Debug log | `C:\Users\Home\gate-debug.log` |
| Portable kit | `C:\Users\Home\.cursor\companion\` |
| Test project | `C:\Users\Home\Documents\TAC\Project\Shifts\CRM\` |
| Project hooks | `CRM\.cursor\hooks.json` + `CRM\.cursor\hooks\gate.js` |
| Spec | `CRM\.cursor\CURSORGATE_CLI_SPEC.md` |
| CRM `.gitignore` | contains `.cursor/*` (hooks not committed there) |

## Environment verified

- OS: Windows 10/11
- Cursor: 3.5.17
- Node: v22 (fetch available)
- Phone: ntfy app subscribed to `out` topic; battery Unrestricted

## Current config snapshot (`01-machine-config/companion.json`)

```json
{
  "out": "cc-out-9794e7dfa730f39a513c4adf",
  "in": "cc-in-4cf0b22e20051c37127d5e4b",
  "enabled": false,
  "waitMs": 0
}
```

- **`enabled` is currently `false`** (gate returns Cursor `ask` immediately).
- Topics are secrets. Anyone with `in` can Approve. Do not commit this file to a public repo.
- Spec migrates to a richer schema (`version`, `timeoutSeconds`, `server`, `token`, etc.)
  while **keeping these `out`/`in` values**.

## Folder structure in this pack

See `TREE.txt`. Summary:

```
cursorgate-handoff/
  HANDOFF.md
  TREE.txt
  01-machine-config/companion.json
  02-companion-kit/{init.js,gate.js,hooks.json}
  03-project-prototype/.cursor/{CURSORGATE_CLI_SPEC.md,hooks.json,hooks/gate.js}
```

`02-companion-kit/gate.js` and `03-project-prototype/.cursor/hooks/gate.js` should be
identical working copies. Prefer the project copy as behavior source of truth if they drift.

## How the prototype works

1. Cursor fires `beforeShellExecution` with JSON on stdin.
2. `gate.js` prints `{"permission":"allow"|"deny"|"ask"}` on stdout.
3. On Windows, stdin is often **UTF-8 with BOM** (`ef bb bf`). Must strip or `JSON.parse` fails → silent `ask`.
4. Never log or forward `user_email` or the full payload.
5. Flow:
   - `enabled: false` → `ask` (no network)
   - allowlist match + no chaining → `allow`
   - empty / cmd > 3500 chars → `ask`
   - else ntfy notify with Approve / Deny / Pass to Cursor
   - poll `in` topic for `approve|deny|pass:<id>`
   - `waitMs: 0` = wait forever for a button; `>0` = then `ask`
6. On settle: **update** same `sequence_id` to a read-only history notification (keep command text), then `/clear` heads-up. Do **not** DELETE (user wants history).
7. Failures always → `ask`. Never accidental auto-allow.
8. Chaining chars always block allowlist: `; & | \` $ < >` and newline.

## Buttons

| Button | Body posted to `in` | Hook result |
|---|---|---|
| Approve | `approve:<id>` | `allow` |
| Deny | `deny:<id>` | `deny` |
| Pass to Cursor | `pass:<id>` | `ask` |

## Portable init (already built)

```powershell
node $env:USERPROFILE\.cursor\companion\init.js
```

```bash
node ~/.cursor/companion/init.js
```

Creates `~/.companion.json` if missing; writes `./.cursor/hooks.json` + `./.cursor/hooks/gate.js`.
Templates live in `02-companion-kit/`. Spec replaces this with `cursorgate install` + `cursorgate init`.

## Critical findings (verified in testing)

1. **UTF-8 BOM on stdin** from Cursor on Windows — fixed in `decodeStdin`.
2. **Hook `allow` does not always skip Cursor’s own prompt** — Cursor auto-run/allowlist is a second layer. Phone Approve can still be followed by a desktop prompt for “scary” commands.
3. **Cannot run ntfy Approve and Cursor’s Approve UI in parallel** for one command: returning `ask` ends the hook; later phone taps are ignored for that request. Dual control = phone ntfy **or** Pass to Cursor.
4. Observed Cursor default hook timeout ~60s earlier; project `hooks.json` sets `"timeout": 86400`.
5. Observed payloads had `sandbox: false`, empty `cwd`, `workspace_roots[0]` like `/c:/Users/...`.
6. User-level hooks file exists at `~/.cursor/hooks.json` (for future `cursorgate init --global` — still verify against current Cursor docs per spec).

## Example Cursor hook stdin (redacted)

```json
{
  "conversation_id": "...",
  "generation_id": "...",
  "command": "git branch --show-current",
  "cwd": "",
  "sandbox": false,
  "session_id": "...",
  "hook_event_name": "beforeShellExecution",
  "cursor_version": "3.5.17",
  "workspace_roots": ["/c:/Users/Home/Documents/TAC/Project/Shifts/CRM"],
  "user_email": "<REDACTED — present in real payloads; never log or send>",
  "transcript_path": null
}
```

## Smoke tests that already passed

- Manual: `echo '{"command":"echo hi","workspace_roots":["/c:/x/y"]}' | node .cursor/hooks/gate.js` → notify + timeout/`ask`
- Phone Approve / Deny / Pass to Cursor on real agent shell commands
- History finalize after action (command still visible; buttons gone)
- `enabled: false` skips ntfy

## What to implement next

Follow `03-project-prototype/.cursor/CURSORGATE_CLI_SPEC.md` exactly:

- Zero runtime deps, Node 18+, Windows first
- `cursorgate` bin → install/init/on/off/set/allow/test/doctor/…
- Copy standalone gate to `~/.cursorgate/gate.js`
- Absolute path in project `.cursor/hooks.json`
- Migrate `~/.companion.json` in place
- Tests with `node:test`

## Suggested first prompt for the new chat

```
Implement cursorgate from this handoff pack.

Read:
1. HANDOFF.md
2. 03-project-prototype/.cursor/CURSORGATE_CLI_SPEC.md
3. 03-project-prototype/.cursor/hooks/gate.js  (working behavior — refactor, don't rewrite)

Migrate topics from 01-machine-config/companion.json.
Windows first, zero runtime deps.
Ask before anything not in the spec.
```

## Security

- Do not commit `01-machine-config/companion.json` to a public remote.
- Do not include `user_email` in logs, tests, or README examples.
- Notifications contain full shell commands — treat as sensitive.
