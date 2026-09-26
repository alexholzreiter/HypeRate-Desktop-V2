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
- **Two ways to get your heart rate** — through the HypeRate cloud, or straight from a Bluetooth chest strap
- **Native drag & drop** — reposition the overlay anywhere on your screen; position is saved across restarts
- **Fully customizable** — heart animation, style, color, size, glow, font, layout, background
- **Heart Rate Zones** — color-coded zone indicators with configurable thresholds
- **System tray / menu bar** — HypeRate Desktop lives in the tray; on macOS the live BPM is shown in the menu bar
- **Auto-start** — optional launch at login
- **Global hotkey** — `Ctrl+Shift+H` (or `Cmd+Shift+H`) toggles overlay visibility
- **Update checker** — notifies you when a new release is available
- **Multi-language** — English & German UI
- **FTUE** — guided first-run setup
- **Integrations** — Discord, VRChat (OSC), World of Warcraft, League of Legends and Home Assistant — see [Integrations](#integrations)

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

## Integrations

Every integration is optional and lives in its own card in the settings.

| Integration | What it does | Setup |
|---|---|---|
| **Discord Rich Presence** | Shows your live BPM and zone on your Discord profile | Switch it on |
| **VRChat / OSC** | Sends BPM to `/avatar/parameters/<name>` plus `onesHR`, `tensHR`, `hundredsHR`, and optionally to the chatbox | Set host and port (default `127.0.0.1:9000`) |
| **World of Warcraft** | Reads your combat log and shows cards after a fight: Boss Defeated, Close Call, You Died, Most Intense Enemy, plus session insights | Pick your WoW folder and enable advanced combat logging — [full guide](https://blog.hyperate.io/post/world-of-warcraft-heart-rate-overlay/) |
| **League of Legends** | Deaths, close calls, multikills, First Blood, objectives, steals, Ace and the match result | Nothing. Riot's Live Client Data API is there while a match runs |
| **Home Assistant** | Publishes heart rate, zone and game moments over MQTT | See below |

Each game's cards can be switched on and off individually. Cards you switch off still count towards your session statistics.

### Home Assistant (MQTT)

The app publishes to any MQTT broker and announces itself through [MQTT discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery), so **nothing has to be configured on the Home Assistant side**. A device called *HypeRate Desktop* appears on its own with these entities:

| Entity | Type | Value |
|---|---|---|
| `sensor.hyperate_desktop_heart_rate` | sensor, `bpm`, measurement | Your live heart rate, at most one message per second |
| `sensor.hyperate_desktop_heart_rate_zone` | sensor | The zone name, with `zone_color` and `source` as attributes |
| `event.hyperate_desktop_game_event` | event | Every WoW and League moment. Optional |

Topics, with the base topic from the settings (`hyperate` by default):

```
hyperate/desktop/state          {"bpm":142,"zone":"High","zone_color":"#ef4444","source":"bluetooth"}
hyperate/desktop/event          {"event_type":"death","game":"wow","title":"You Died","detail":"vs. Grimspire Warlord","bpm":161}
hyperate/desktop/availability   online | offline   (retained, with a last will)
```

Event types you can trigger on: `death` · `close_call` · `closest_call` · `boss_defeated` · `intense_enemy` · `nemesis` · `kill_streak` · `peak_heart_rate` · `kill` · `multikill` · `pentakill` · `first_blood` · `objective` · `objective_stolen` · `ace` · `victory` · `defeat`

The broker password is encrypted with the operating system's keychain (Electron `safeStorage`) and is never written to `settings.json` in the clear.

#### Connecting to your broker

**With the official Mosquitto broker add-on** — the usual case. It authenticates against Home Assistant's own user accounts and does not allow anonymous connections, so you need a user:

1. In Home Assistant: **Settings → People → Users → Add user**, for example `hyperate`. It does not need administrator rights
2. In the app: the **IP address of your Home Assistant machine**, port `1883`, that user and its password

Use the IP address, not `core-mosquitto` — that name only resolves inside Home Assistant's own network, not from your gaming PC.

**With your own Mosquitto**, two things commonly trip people up:

- Mosquitto 2.x refuses anonymous connections out of the box. Create a user with `mosquitto_passwd -c /mosquitto/config/passwd hyperate` and point `password_file` at it
- If your setup uses the **dynamic security plugin**, the `admin` user that `mosquitto_ctrl dynsec init` creates may only use the `$CONTROL/dynamic-security/#` topics. It connects fine and then silently publishes nothing. Create a **role** with four *allow* ACLs on topic `#` — `publishClientSend`, `publishClientReceive`, `subscribePattern`, `unsubscribePattern` — and a **client** carrying that role. Use `subscribePattern`, not `subscribeLiteral`: `#` is a wildcard, and Home Assistant subscribes with wildcards. Mosquitto only ever evaluates ACLs through roles, never directly on a client

Whichever broker you use, the app and Home Assistant can share one account or use one each.

#### An automation to start with

The zone colour travels along as an attribute, so one automation covers every zone instead of one per colour:

```yaml
alias: Heart rate colours the light
triggers:
  - trigger: state
    entity_id: sensor.hyperate_desktop_heart_rate_zone
actions:
  - action: light.turn_on
    target: { entity_id: light.office }
    data:
      rgb_color: >-
        {% set c = state_attr('sensor.hyperate_desktop_heart_rate_zone', 'zone_color') or '#ffffff' %}
        [{{ c[1:3]|int(base=16) }}, {{ c[3:5]|int(base=16) }}, {{ c[5:7]|int(base=16) }}]
```

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
│   ├── ble.js                   # Bluetooth heart rate straps
│   ├── discord.js               # Discord Rich Presence
│   ├── mqtt.js                  # Home Assistant / MQTT output
│   ├── moments.js               # Heart rate statistics for a game moment
│   ├── games/
│   │   ├── wow/                 # Combat log parser, fight tracker, session insights
│   │   └── lol/                 # Riot Live Client Data API, match tracker
│   └── windows/
│       ├── settings/index.html  # Settings & customization UI
│       ├── overlay/index.html   # Floating BPM overlay + game cards
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
