# cursorgate: CLI for the Cursor Phone Approval Gate

> Instructions for the Cursor agent. Read all of it, then implement.
> Start from the existing, working `.cursor/hooks/gate.js` and `~/.companion.json` in this
> project (they already work). **Refactor them into this tool. Do not rewrite the behavior.**
> Ask me before adding anything not described here.

## Goal

Turn the working prototype into a small git repo that I can install once on any PC and then
enable per project with one command:

```
cursorgate install        # one-time per machine
cursorgate init .         # per project
cursorgate on | off       # kill switch
cursorgate set timeout 120
```

`cursorgate` is a working name. Keep the command name in exactly one place (`package.json`
`bin`) so it is easy to rename.

## Constraints

- Node 18+ (built-in `fetch`). **Zero runtime dependencies.** Parse args by hand or with
  `node:util` `parseArgs`.
- Must work on Windows first (my machine), and not break on macOS/Linux.
- Distribute via git: `npm install -g github:<me>/cursorgate` and `npm link` for development.
- Never log or send `user_email`, full hook payloads, or the config's topic names.
- Every failure inside the hook ends in `ask`. Nothing may auto-allow by accident.

## Repo layout

```
cursorgate/
  package.json            # "bin": { "cursorgate": "bin/cli.js" }, "type": "commonjs"
  bin/cli.js              # command dispatcher
  src/
    commands/             # one file per command
    config.js             # load/save/validate ~/.companion.json (atomic write)
    hooksFile.js          # safe read/merge/write of hooks.json
    gate.js               # the hook runtime (the current working gate.js, refactored)
    ntfy.js               # publish + poll helpers
    paths.js              # home dir, config path, install dir, log path
  test/                   # node:test, no extra deps
  README.md
```

## Where things live

| Thing | Location |
|---|---|
| Config | `~/.companion.json` (keep the current name) |
| Installed hook runtime | `~/.cursorgate/gate.js` (copied on `install`, updated on re-run) |
| Debug log | `~/gate-debug.log` (keep) |
| Project hook registration | `<project>/.cursor/hooks.json` |

**Why copy gate.js to `~/.cursorgate/`:** `hooks.json` then points at one stable absolute path,
and an `npm update` of the CLI doesn't change what Cursor runs until I re-run `install`.

## Config schema (`~/.companion.json`)

```json
{
  "version": 1,
  "enabled": true,
  "server": "https://ntfy.sh",
  "token": null,
  "out": "cc-out-<random>",
  "in": "cc-in-<random>",
  "timeoutSeconds": 120,
  "onTimeout": "ask",
  "allowlist": ["^git (status|branch( --show-current)?|diff|log( -\\d+)?)$"],
  "sendNotifications": true
}
```

- Migrate the existing file in place: keep my current `out`/`in` values and any settings it
  already has. Add missing keys with defaults. Never regenerate topics unless I ask.
- `timeoutSeconds`: `0` means wait indefinitely, but the **default is 120**. When `0` is set,
  `status` and `set timeout 0` must print a warning that the agent will hang if the phone is
  unreachable.
- `onTimeout`: only `"ask"` is allowed (hand back to Cursor). Reject other values.
- `token`: optional bearer token for a self-hosted or protected ntfy server. Send as
  `Authorization: Bearer <token>` when present.
- `enabled: false` makes the hook answer `ask` **immediately**, without any network call.
- Write the config atomically (temp file + rename). On POSIX set mode `0600`.
- Validate on load. If invalid, the hook answers `ask` and logs the reason. The CLI prints
  the exact problem.

## Commands

### `cursorgate install`
1. Create `~/.cursorgate/` and copy `src/gate.js` there (with any local requires bundled or
   inlined, since it runs standalone).
2. Create `~/.companion.json` if missing (random 24-hex topics via `crypto.randomBytes`).
   If it exists, migrate it as above. Idempotent.
3. Print the `out` topic and these phone steps: install ntfy, subscribe to that topic,
   set battery to Unrestricted.
4. Run a quick self-test (see `test`) and print the result.

### `cursorgate init [path]`  (default `.`)
1. Resolve the project root (given path, or nearest parent containing `.git`).
2. Run `install` steps if config or runtime is missing.
3. Create or **merge** `<root>/.cursor/hooks.json`:
   - Preserve every existing hook and key. Only add or update our own entry in
     `hooks.beforeShellExecution`, identified by a command string containing `.cursorgate`.
   - Command: `node "<absolute path to ~/.cursorgate/gate.js>"`. On Windows use forward
     slashes or properly quoted paths, and verify it actually runs when Cursor launches it.
   - Back up an existing file to `hooks.json.bak` once before the first modification.
   - Idempotent: running twice changes nothing.
4. Because this file contains a machine-specific absolute path, offer to add
   `.cursor/hooks.json` to the project's `.gitignore` (ask y/n; `--yes` accepts).
5. Print what changed.

### `cursorgate init --global`
Register the hook in the user-level Cursor hooks file instead of a project, so every project
is covered. **First verify in Cursor's current docs that a user-level hooks file exists and
where it lives.** If it does not, say so and exit with a clear message. Do not guess.

### `cursorgate remove [path]`
Remove only our entry from that project's `hooks.json`. Delete the file only if we created it
and it is now empty. Never touch other hooks.

### `cursorgate on` / `cursorgate off`
Set `enabled` true/false. `off` must take effect on the very next hook call (the hook reads
the config on every run). Print the new state.

### `cursorgate status`
Print: enabled, server, timeout (with the hang warning if 0), allowlist count, whether the
runtime is installed and up to date, config valid, and whether the current project has the hook
registered. **Never print the topic names or token**; show only `out: cc-out-****abcd`.

### `cursorgate set <key> <value>`
Supported keys: `timeout` (seconds, integer ≥ 0), `server` (URL), `token` (string, or `none`).
Validate input and print the resulting value. Reject unknown keys.

### `cursorgate allow add "<regex>"` / `allow remove <index>` / `allow list`
Manage the allowlist. `add` must compile the regex to validate it, and **warn** if it does not
start with `^` and end with `$`. The gate still rejects any command containing
`; & | ` $ < >` or a newline, regardless of the allowlist.

### `cursorgate test`
Send a test notification to the phone and wait for a tap (Approve/Deny/Pass) or the
configured timeout. Print which button was pressed. This is the fastest way to verify setup.

### `cursorgate topic show` / `topic rotate`
`show` prints the full `out` topic (explicit command, since it is a secret). `rotate`
generates new random topics and warns that the phone must re-subscribe.

### `cursorgate logs [-n 50]` / `cursorgate doctor`
- `logs`: tail `~/gate-debug.log`.
- `doctor`: check Node version, config validity, runtime installed, `hooks.json` registered
  for the current project, ntfy server reachable, and run the stdin smoke test
  (`echo {"command":"echo hi","workspace_roots":["/c:/x/y"]} | node ~/.cursorgate/gate.js`).
  Print pass/fail per check with a fix hint.

### `cursorgate uninstall`
Remove `~/.cursorgate/`. Ask before deleting `~/.companion.json`. Do not touch any project's
`hooks.json` (tell me to run `remove` per project).

## Hook runtime requirements (`gate.js`)

Keep everything the current version does, and:

- Read config on every call (so `on/off/set` apply instantly).
- If `enabled` is false or `sendNotifications` is false: answer `ask` immediately.
- Allowlist match plus no chaining characters: answer `allow` with no notification.
- Otherwise publish the notification with three buttons: **Approve**, **Deny**, **Pass to
  Cursor** (answers `ask`). Every button body carries the per-request id so stale taps do
  nothing.
- Wait up to `timeoutSeconds` (or forever if 0) polling the `in` topic, then answer `ask`.
- If the process receives SIGTERM/SIGINT/stdin close while waiting, stop polling and exit
  cleanly. **No orphaned background node processes.**
- Commands longer than 3500 chars: answer `ask` without notifying.
- Log with timestamps to `~/gate-debug.log`. Rotate or truncate at ~1 MB.
- No file or output ever contains `user_email`.

## Tests (`node --test`, no extra dependencies)

- Config migration keeps my existing topics and adds defaults.
- `hooks.json` merge: existing hooks preserved, idempotent, backup created once, malformed
  JSON handled with a clear error and no overwrite.
- Allowlist: `git status` allowed, `git status; rm -rf x` not, `git statusx` not.
- Gate with a mocked ntfy server: approve, deny, pass, timeout, stale id ignored,
  network failure, bad stdin, config missing/invalid. Every error case prints `ask`.
- `enabled: false` makes no network call.
- No test output or log contains an email address.

## README must include

Install from git, phone setup, the command list, the security notes below, and a short
"if the agent seems frozen" section: run `cursorgate off`, then `cursorgate doctor`.

## Security notes

- Public ntfy.sh topics are secrets by obscurity. Anyone who learns the `in` topic can
  approve commands. Document self-hosting and the `token` option, and recommend it for
  anything beyond personal experiments.
- Notifications contain full commands. Do not add env vars or file contents.
- Do not add anything that bypasses Cursor's account, device, or usage limits.

## Out of scope

MCP/file-edit gating, any mobile app, multi-user support, reading Cursor's databases, chat
sync. These are later phases of the larger companion project.

## Definition of done

- `npm link` gives me the command; `install`, `init .`, `on`, `off`, `set timeout`, `status`,
  `test` and `doctor` all work on Windows.
- Running `init .` on a project that already has other hooks leaves them untouched.
- All tests pass, and `doctor` is green on my machine.
- My current working setup keeps working after migration without me re-subscribing the phone.
