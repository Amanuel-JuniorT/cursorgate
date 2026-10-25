# Companion Desktop (v0.5)

Windows tray app that runs **relay + daemon** in the background and provides a local ops UI (pair, devices, settings, projects).

## Dev

Stop any manual `npm run start:relay` / `daemon` first (port 8787).

```powershell
cd companion
npm run dev:desktop
```

Or:

```powershell
npm run start -w @companion/desktop
```

- Close the window → stays in **system tray**
- Tray → **Quit Companion** to stop services

## Later

`npm run dist -w @companion/desktop` builds a Windows installer (electron-builder). Still WIP for a polished ship.
