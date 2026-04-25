# HypeRate Desktop

**A cross-platform desktop app that displays your live heart rate as a floating, always-on-top overlay — for streamers, gamers, and athletes.**

Powered by [HypeRate](https://hyperate.io) · Free & Open Source · macOS · Windows · Linux

---

## Download

Get the latest release from the [GitHub Releases](https://github.com/alexholzreiter/HypeRate-Desktop-V2/releases/latest) page:

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `HypeRate-Desktop-*-arm64.dmg` |
| macOS (Intel) | `HypeRate-Desktop-*-x64.dmg` |
| Windows | `HypeRate-Desktop-*-Setup.exe` |
| Linux | `HypeRate-Desktop-*.AppImage` / `.deb` |

> **macOS:** If Gatekeeper blocks the app, right-click → Open, or go to System Settings → Privacy & Security → Open Anyway.  
> **Windows:** If SmartScreen appears, click "More info" → "Run anyway". The app is unsigned but safe.  
> **Linux:** `chmod +x HypeRate-Desktop-*.AppImage` then run it.

---

## Features

- **Live BPM Overlay** — floating, always-on-top widget that stays above every app, game, or browser
- **Native drag & drop** — reposition the overlay anywhere on your screen; position is saved across restarts
- **Fully customizable** — heart animation, style, color, size, glow, font, layout, background
- **Heart Rate Zones** — color-coded zone indicators with configurable thresholds
- **System tray / menu bar** — HypeRate Desktop lives in the tray; on macOS the live BPM is shown in the menu bar
- **Auto-start** — optional launch at login
- **Global hotkey** — `Ctrl+Shift+H` (or `Cmd+Shift+H`) toggles overlay visibility
- **Update checker** — notifies you when a new release is available
- **Multi-language** — English & German UI
- **FTUE** — guided first-run setup

### Overlay customization options

| Category | Options |
|---|---|
| Animation | Pulse · Beat · Bounce · Shake · Glow · None |
| Heart style | Filled · Outline · Emoji · Minimal |
| Heart color | Full color picker + hex input |
| Heart size | 24 px – 80 px |
| Font | Space Mono · DM Sans · Playfair Display · Bebas Neue · VT323 · any system font |
| Number animation | Flip · Fade · Pop · None |
| Background | Transparent · Dark Pill · Glassmorphism · Solid · Gradient |
| Layout | Horizontal · Vertical · Compact |
| Border radius | 0 – 50 px |
| Zones | On/Off · custom colors |

---

## ⚠️ Forking this project? Read this first

The HypeRate API key hardcoded in `src/main.js` is private and belongs to this project.  
**Do not use it in your own fork or build** — requests will be rejected or rate-limited.

Get your own free API key here: **https://hyperate.io/api.html**  
Then replace the `HYPERATE_API_KEY` constant at the top of `src/main.js` with your own key.

---

## Requirements

- A free [HypeRate](https://hyperate.io) account
- A compatible heart rate device (Apple Watch, Wear OS, Garmin, Polar, Fitbit, Amazfit, …)
- The HypeRate mobile app running and broadcasting your heart rate

---

## Project Structure

```
HypeRate-Desktop-V2/
├── src/
│   ├── main.js                  # Electron main process
│   ├── preload.js               # Secure IPC bridge (contextBridge)
│   └── windows/
│       ├── settings/index.html  # Settings & customization UI
│       ├── overlay/index.html   # Floating BPM overlay
│       └── ftue/index.html      # First-run setup wizard
├── assets/                      # App icons (icns, ico, png)
├── landing/                     # Marketing landing page
├── dist/                        # Build output (gitignored)
└── package.json
```

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Run locally

```bash
npm install
npm start
```

### Build installers

```bash
# All platforms (requires macOS for universal builds)
npm run build

# Platform-specific
npm run build:mac
npm run build:win
npm run build:linux
```

Build output lands in `dist/`. See [electron-builder docs](https://www.electron.build) for code signing and notarization.

---

## HypeRate WebSocket Protocol

The app connects to `wss://app.hyperate.io/socket/websocket` using the Phoenix channel protocol:

```json
// Join
{ "topic": "hr:<YOUR_SESSION_ID>", "event": "phx_join", "payload": {}, "ref": "join" }

// Heartbeat (every 25 s)
{ "topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": "hb" }

// Incoming BPM update
{ "topic": "hr:<YOUR_SESSION_ID>", "event": "hr_feed", "payload": { "hr": 72 } }
```

Your Session ID is shown in the HypeRate app under **Settings → Session ID**.

---

## Releasing a New Version

1. Bump the version in `package.json`
2. Build all platforms: `npm run build:mac && npm run build:win && npm run build:linux`
3. Create a GitHub Release tagged `v<version>` (e.g. `v1.1.0`)
4. Upload the files from `dist/` as release assets
5. The in-app update checker compares against the latest GitHub Release tag automatically

---

## License

MIT — see [LICENSE](LICENSE)

---

*Built with [Electron](https://electronjs.org) · Powered by [HypeRate](https://hyperate.io)*
