# HypeRate Desktop addon: guide for AI assistants (and people)

This folder is an addon for **HypeRate Desktop**. You (Claude, Codex, …) may change the files in
this folder to build what the user asks for. Read this whole file first: **the user's task is at
the very end, under "Your task".** `example.js.txt` is a small working addon to learn from.

## What an addon is

Two files, in this folder:

- `addon.json` – name, version and what the addon is allowed to do
- `main.js` – the code. Plain JavaScript as in a web page: no build step, no Node.js, no
  `require`, no `import` and no npm packages. Everything goes into this one file.

The app runs `main.js` in a hidden, sandboxed window. It has **no access** to files, other apps,
the rest of HypeRate Desktop, the camera, the microphone or the network, except for what is
listed below and allowed in `addon.json`.

## addon.json

```json
{
  "id": "my-first-addon",
  "name": "My first addon",
  "version": "1.0.0",
  "description": "One sentence about what it does.",
  "author": "",
  "permissions": ["heartRate", "storage", "notifications"],
  "network": [],
  "settings": [
    { "key": "limit", "type": "number", "label": "Limit (BPM)", "default": 120, "min": 40, "max": 220 }
  ]
}
```

- `id`: lower case letters, digits and dashes, 2–40 characters, unique among the user's addons.
- `version`: raise it when you change the addon.
- `permissions`: only what the addon really needs. Possible values:
  - `heartRate` – the live heart rate
  - `zones` – the user's heart rate zones and the current one
  - `gameMoments` – moments from games (World of Warcraft, League of Legends)
  - `storage` – a small storage of its own (1 MB) that survives restarts
  - `notifications` – system notifications (at most one every 10 seconds)
- `network`: host names (no `https://`, no paths) the addon may call with `fetch`, for example
  `["api.example.com"]`. Only `https` works. Every other request is blocked. Leave it empty
  unless the addon must talk to a web service.

- `settings`: values the user can change in the app without touching the code, shown there as a
  form. Use them for anything a user might want to adjust (limits, colours, texts, modes) instead
  of constants in the code. Each entry: `key` (a simple name), `type` (`number`, `text`, `toggle`,
  `color` as `#rrggbb`, or `select` with `"options": ["a", "b"]`), `label`, `default`, and for
  numbers optionally `min` and `max`; `help` adds a short explanation. Changing a value does not
  need a new approval; changing code does.

**Every change to any file of the addon makes the app ask the user again** before it runs, and
it shows the permissions and hosts, new ones highlighted. So ask for as little as possible: the
user decides.

## The API: `window.hyperate`

```js
hyperate.on('heartRate', ({ bpm }) => { … });          // needs "heartRate"; about once a second
hyperate.on('zone', (zone) => { … });                   // needs "zones"; zone = { name, color, min, max } or null
hyperate.on('gameMoment', ({ game, type, title, detail, bpm }) => { … });  // needs "gameMoments"
                                                         // game: "wow" | "lol"; title like "Boss Defeated"
await hyperate.storage.get('key');                      // needs "storage"; undefined if not set
await hyperate.storage.set('key', value);               // needs "storage"; value must be JSON-able
await hyperate.notify('Title', 'Text');                 // needs "notifications"; false if too soon
await hyperate.settings.get();                          // { limit: 120, … }: the "settings" values
hyperate.on('settings', (values) => { … });             // the user changed a value in the app
hyperate.log('anything');                                // shows in the addon's log in the app
fetch('https://api.example.com/…')                       // only hosts listed in "network"
```

`console.log`, `console.warn` and `console.error` also go to the addon's log, and errors thrown
by the addon show up there too. The user finds the log on the addon's own page in HypeRate
Desktop (Integrations › the addon's tile), together with a restart button.

## Rules

- Never ask the user for passwords or keys inside the addon, and never send the heart rate
  anywhere the user did not ask for.
- Do not add permissions or hosts "just in case".
- Keep the code readable: the user may want to understand what it does before approving it.
- Keep `addon.json`'s `id` as it is; it names the folder. Raise `version` with every change.
- There is no page to draw on; the addon works in the background. Showing things in the
  overlay is not possible yet.

## When you are done

Tell the user, in their language:
1. what the addon does and which permissions and hosts it asks for, and why,
2. that it is in HypeRate Desktop under **Integrations**, as its own tile; switch it on there and
   confirm the permissions,
3. which settings they can change there.

The app notices every change by itself. Errors show on the addon's page with a button that copies
them for you, so the user may come back with an error message: fix it in this folder.
