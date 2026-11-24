# HypeRate Desktop addon: guide for AI assistants (and people)

<!-- HypeRate Desktop keeps this guide current; only the part under "## Your task" is yours. -->

This folder is an addon for **HypeRate Desktop**. You (Claude, Codex, …) may change the files in
this folder to build what the user asks for. Read this whole file first: **the user's task is at
the very end, under "Your task".** `example.js.txt` is a small working addon to learn from.

## What an addon is

Files in this folder:

- `addon.json` – name, version and what the addon is allowed to do
- `main.js` – the code. Plain JavaScript as in a web page: no build step, no Node.js, no
  `require`, no `import` and no npm packages. Everything goes into this one file.
- `overlay.html` (optional, with the `overlay` permission) – what the addon shows in the
  overlay, see "Showing something in the overlay" below.

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
  - `overlay` – show `overlay.html` in the overlay (needs that file and the `overlay` entry below)
  - `sound` – play sounds (Web Audio, or `new Audio('alarm.mp3')` with a file from this folder)
- `network`: host names (no `https://`, no paths) the addon may call with `fetch`, for example
  `["api.example.com"]`. Only `https` works. Every other request is blocked. Leave it empty
  unless the addon must talk to a web service.

- `settings`: values the user can change in the app without touching the code, shown there as a
  form. Use them for anything a user might want to adjust (limits, colours, texts, modes) instead
  of constants in the code. Each entry: `key` (a simple name), `type` (`number`, `text`, `toggle`,
  `color` as `#rrggbb`, or `select` with `"options": ["a", "b"]`), `label`, `default`, and for
  numbers optionally `min` and `max`; `help` adds a short explanation. Changing a value does not
  need a new approval; changing code does.

- `overlay` (with the `overlay` permission), one of:
  - `{ "width": 300, "height": 120 }`: a window of that size in pixels (width 40–1200, height
    30–800), which the user drags where they want it and can scale in the app. A window
    takes the mouse while the pointer is over it (so it can be dragged), which is why the app
    shrinks windows that would cover more than a third of the screen;
  - `{ "mode": "screen" }`: the whole screen the overlay is on, for effects over everything
    (a glowing edge, a flash, a vignette). Clicks always go through it to the apps underneath,
    so the user can keep working; it cannot be moved or scaled and needs no size.

**Every change to any file of the addon makes the app ask the user again** before it runs, and
it shows the permissions and hosts, new ones highlighted. So ask for as little as possible: the
user decides.

## The API: `window.hyperate`

```js
hyperate.on('heartRate', ({ bpm }) => { … });          // needs "heartRate"; about once a second
hyperate.on('zone', (zone) => { … });                   // needs "zones"; zone = { name, color, min, max } or null
hyperate.on('gameMoment', ({ game, type, title, detail, bpm }) => { … });  // needs "gameMoments"
                                                         // game: "wow" | "lol"; title like "Boss Defeated";
                                                         // bpm: the peak heart rate of that moment (or null)
// gameMoment types: boss_defeated, close_call, closest_call, death, intense_enemy, nemesis,
// peak_heart_rate, kill_streak (WoW); kill, multikill, pentakill, first_blood, ace, objective,
// objective_stolen, victory, defeat (League of Legends). Compare "type", not "title".
await hyperate.storage.get('key');                      // needs "storage"; undefined if not set
await hyperate.storage.set('key', value);               // needs "storage"; value must be JSON-able
await hyperate.notify('Title', 'Text');                 // needs "notifications"; false if too soon
await hyperate.settings.get();                          // { limit: 120, … }: the "settings" values
hyperate.on('settings', (values) => { … });             // the user changed a value in the app
hyperate.send({ any: 'data' });                          // to the other part: main.js → overlay.html or back
hyperate.on('message', (data) => { … });                // what the other part sent
hyperate.log('anything');                                // shows in the addon's log in the app
fetch('https://api.example.com/…')                       // only hosts listed in "network"
```

`console.log`, `console.warn` and `console.error` also go to the addon's log, and errors thrown
by the addon show up there too. The user finds the log on the addon's own page in HypeRate
Desktop (Integrations › the addon's tile), together with a restart button.

## Showing something in the overlay

With the `overlay` permission, `overlay.html` is shown in a small window of its own next to the
HypeRate overlay. It comes and goes with the overlay (and its hotkey); the user drags it where
they want it, like the heart rate widget, and sets its size in the app. Clicks inside it are
not for the addon (pointing at it means "move it"): it only shows things.

- With `"mode": "screen"` the page is as big as the screen: use `100vw`/`100vh` or `vmin`,
  never fixed pixel sizes, and keep the middle free unless the effect is meant to cover it.
- The page background is transparent. Draw only what should be seen; keep it readable over
  any game (for example light text with a dark shadow, or a dark rounded box).
- Scripts and styles must be separate files in this folder: `<script src="overlay.js"></script>`
  and `<link rel="stylesheet" href="overlay.css">`. Inline `<script>` and `onclick="…"` are
  blocked; inline `style` attributes and `<style>` work. Fonts and images from this folder work.
- `window.hyperate` works there too, with the same permissions, so the overlay can listen to
  `heartRate` itself. For anything `main.js` works out (counters, timers, data from the web),
  send it over with `hyperate.send(…)` and listen with `hyperate.on('message', …)`.
  Both parts start on their own; do not rely on which one is first, and send the current
  state again when it changes.
- Keep it light: it runs during games. Animate with CSS rather than timers where possible.
  An addon that keeps using a lot of processor time is stopped by the app.
- **No fast flashing.** Large areas must not blink or change brightness more than three times
  a second: that can trigger seizures in people with photosensitive epilepsy. Fade or pulse
  slowly instead (one cycle per second or slower).

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="overlay.css">
<div id="count">0</div>
<script src="overlay.js"></script>
```

```js
// overlay.js
hyperate.on('message', ({ deaths }) => { document.getElementById('count').textContent = deaths; });
```

## Rules

- Never ask the user for passwords or keys inside the addon, and never send the heart rate
  anywhere the user did not ask for.
- Do not add permissions or hosts "just in case".
- Keep the code readable: the user may want to understand what it does before approving it.
- Keep `addon.json`'s `id` as it is; it names the folder. Raise `version` with every change.
- `main.js` has no page to draw on; anything visible goes into `overlay.html`.

## What is not possible (yet)

- Clicking things in the overlay: a window can only be dragged, a screen overlay lets clicks
  through. There are no buttons for the user to press there.
- Keyboard shortcuts, reading or writing files outside this folder, other apps or windows,
  the microphone, the camera, the clipboard, starting programs.
- Running while HypeRate Desktop is closed. More than 1 MB of storage.
- One overlay over several monitors at once: a screen overlay covers the screen the HypeRate
  overlay is on.
- Showing anything over games in **exclusive full screen** (some Windows games): nothing can be
  drawn over those, not even the heart rate widget. In the game, "borderless window" works.
- Any network access not listed in `"network"`, and plain `http://`.

## When something the user wants is not possible

Do not try to get around the limits: the app blocks it, and the user would only see an error.
Instead:
1. build the closest thing that works, and say clearly what is missing and why,
2. write each missing piece into a file `WISHES.md` in this folder: one `## ` heading per
   wish, with two or three sentences on what the addon would need from HypeRate Desktop and
   what for. The app shows these wishes on the addon's page, where the user can send them to
   HypeRate. Remove a wish when it is no longer needed.

## When you are done

Tell the user, in their language:
1. what the addon does and which permissions and hosts it asks for, and why,
2. that it is in HypeRate Desktop under **Integrations**, as its own tile; switch it on there and
   confirm the permissions,
3. which settings they can change there,
4. if it shows something in the overlay: that it appears while the overlay is on, and that they
   move it by dragging it, like the heart rate widget (a `"mode": "screen"` addon covers the
   screen and lets every click through instead).

The app notices every change by itself. Errors show on the addon's page with a button that copies
them for you, so the user may come back with an error message: fix it in this folder.
