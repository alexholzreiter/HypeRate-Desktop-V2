# HypeRate Overlay – Overwolf Electron App

Ein In-Game Herzraten-Overlay für Streamer, das sich mit HypeRate verbindet und
die Herzrate als anpassbares Overlay über dem Spiel anzeigt.

## 🚀 Setup

### Voraussetzungen
- Node.js 18+
- npm oder yarn
- Overwolf Electron SDK (für Production-Builds)

### Installation

```bash
# Dependencies installieren
npm install

# App starten (Development)
npm start
```

### Für Overwolf Electron Production
Ersetze `electron` in `package.json` mit dem Overwolf Electron Paket:
```bash
npm install @overwolf/ow-electron
```

Und in `main.js` die Imports entsprechend anpassen (OW-spezifische Overlay-API
nutzen statt Standard-Electron BrowserWindow).

---

## 📁 Projektstruktur

```
hyperate-overlay/
├── src/
│   ├── main.js                 # Electron Main Process
│   ├── preload.js              # Secure IPC Bridge
│   └── windows/
│       ├── settings/
│       │   └── index.html      # Settings & Konfiguration UI
│       └── overlay/
│           └── index.html      # In-Game Overlay
├── assets/                     # Icons & Assets
└── package.json
```

---

## ✨ Features

### HypeRate Integration
- WebSocket-Verbindung zu `wss://app.hyperate.io/socket/websocket`
- Phoenix Channel-Protokoll: Topic `hr:<deine-id>`
- Automatischer Heartbeat alle 25 Sekunden
- **Demo-Modus** bei Verbindungsproblemen (simuliert BPM-Daten)

### Herz-Anpassungen
| Option | Beschreibung |
|---|---|
| Animation | Pulse, Beat, Bounce, Shake, Glow, Keine |
| Style | Emoji ❤️, Outline 🫀, Filled ♥, Minimal ● |
| Farbe | Voller Color Picker + Hex-Eingabe |
| Größe | 24px – 80px |
| Glow | On/Off |

### Schrift-Anpassungen
| Option | Beschreibung |
|---|---|
| Font | Space Mono, DM Sans, Playfair Display, Bebas Neue, VT323 |
| BPM-Farbe | Color Picker |
| Label-Farbe | Color Picker |
| BPM-Größe | 20px – 72px |
| Zahlen-Animation | Flip, Fade, Pop, Keine |
| Text-Glow | On/Off |

### Layout-Anpassungen
| Option | Beschreibung |
|---|---|
| Hintergrund | Transparent, Dark Pill, Glassmorphism, Solid, Gradient |
| BG-Transparenz | 0% – 100% |
| Layout | Horizontal, Vertikal, Kompakt |
| Abrundung | 0px – 50px |
| Label anzeigen | On/Off |
| Rand anzeigen | On/Off |

---

## 🔧 Overwolf Electron – Nächste Schritte

Für den echten In-Game Overlay-Betrieb:

1. **Overwolf Developer Account** erstellen: https://dev.overwolf.com
2. **App registrieren** im Developer Console
3. `@overwolf/ow-electron` installieren
4. In `main.js` die `overwolf.windows` API für Overlays nutzen:
   ```js
   const { overwolf } = require('@overwolf/ow-electron');
   overwolf.windows.obtainDeclaredWindow('overlay', callback);
   ```
5. `manifest.json` für Overwolf App-Manifest erstellen

---

## 🎯 HypeRate API Hinweise

Die App verwendet das Phoenix WebSocket-Protokoll:
```json
// Join Message
{
  "topic": "hr:DEINE_SESSION_ID",
  "event": "phx_join",
  "payload": {},
  "ref": 1
}

// Heart Rate Update (empfangen)
{
  "topic": "hr:DEINE_SESSION_ID",
  "event": "hr_feed",
  "payload": { "hr": 72 }
}
```

Deine Session-ID findest du in der **HypeRate App** → Settings → Deine ID.
